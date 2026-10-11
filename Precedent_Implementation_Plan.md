# Precedent — Hackathon Implementation Plan

**Company memory for every AI decision**

**Date:** October 8, 2026  
**Purpose:** Final working hackathon demo  
**Status:** Implementation plan; existing HTML pages are mock references.

## Project objective

Build the final demo around one complete story:

> An agent learns a company restriction, finds a permitted alternative, and saves the outcome. A fresh agent retrieves that experience. An administrator changes policy, and a later incident blocks the affected tool across connected agents.

Make **memory, enforcement, and adaptation** work end to end. Use synthetic data and harmless tools throughout.

## 1. Final deliverables

| Deliverable | What must work |
|---|---|
| Employee workspace | Submit a task and watch the agent plan and act |
| Before/after comparison | Run the same task with and without Precedent in isolated demo environments |
| Memory retrieval | Retrieve relevant policies and earlier outcomes from MongoDB |
| Execution gate | Actually prevent disallowed tool calls |
| Approval console | Approve or deny scoped requests |
| Temporary exceptions | Allow access until a server-enforced expiration time |
| Live policy updates | Update active agents without restarting sessions |
| Cross-session memory | Agent B retrieves an experience saved by Agent A |
| Incident response | Compute known exposure and block future connector calls |
| Policy history | Explain decisions using the policy version applied |
| Learning proposal | Propose a policy improvement supported by stored evidence |
| Evaluation dashboard | Show measured test results |

Keep the existing HTML pages as mock references. Build the working application separately.

## 2. Architecture and stack

Keep the architecture small enough to finish during the hackathon.

| Layer | Implementation |
|---|---|
| Frontend | React + TypeScript |
| Application backend | Modelence, retaining its application and MongoDB integration role |
| Agent runtime | Separate TypeScript worker with a narrow Precedent execution adapter |
| Database | MongoDB Atlas |
| Retrieval | Atlas search plus Voyage embeddings and reranking |
| Authorization | Deterministic TypeScript policy engine |
| Live browser updates | Server-sent events |
| Policy notifications | MongoDB Change Streams |
| Agent evaluation | Raindrop |
| Optional voice | ElevenLabs |
| Model | One configurable provider/model for both comparison runs |

Choose and pin the agent runtime during setup. The earlier plan proposed eve; keep framework-specific code inside the worker so it does not spread through the policy engine.

Use **one backend instance for the demo**. Avoid adding queues, multiple services, or distributed coordination unless a concrete requirement demands them. AWS is not required.

Verify current SDK compatibility, hosting support, and final event sponsor eligibility before implementation.

## 3. Project structure

```text
precedent/
  apps/
    web/
    agent-worker/

  packages/
    contracts/
    policy-engine/
    retrieval/
    execution/
    memory/
    demo-tools/
    observability/

  fixtures/
    policies/
    synthetic-logs/
    historical-episodes/
    evaluation-cases/

  scripts/
    seed-demo
    reset-demo
    run-evaluations
```

Define shared schemas first:

- `ActionRequest`
- `PolicyRule`
- `PolicyDecision`
- `Approval`
- `RunEvent`
- `Episode`
- `Incident`
- `PolicyProposal`

Frontend and backend work should proceed against the same contracts.

## 4. Fictional company and demo tools

Use **Acme Engineering**, with employee and administrator roles.

| Tool | Function | Policy demonstration |
|---|---|---|
| `internal_logs.search` | Searches synthetic customer logs | Permitted alternative |
| `example_connector.analyze` | Sends synthetic logs to a demo connector | External-tool restriction |
| `staging_db.read` | Reads synthetic staging records | Temporary access |
| `demo_export.send` | Sends synthetic records to a controlled endpoint | Same restriction across another route |

Implement at least one connector as an MCP server.

Give the downstream connector a **receipt log**. When Precedent blocks a call, its receipt count must not increase. This proves enforcement happened.

Keep resource classifications and destination metadata server-controlled. An agent cannot change `restricted` to `synthetic` to gain permission.

The baseline may bypass Precedent only inside this controlled demonstration environment. It must not receive real customer data or unrestricted external access.

## 5. Policy enforcement before AI integration

Start with explicit rules:

| Rule | Behavior |
|---|---|
| Restricted logs cannot leave through unapproved external tools | Block |
| Authorized engineers can search logs internally | Allow |
| Staging database access requires an active grant | Approval required |
| Connector v2.4 may run in an approved sandbox scope | Allow within scope |
| Quarantined versions cannot execute | Block, overriding ordinary approvals |

Evaluate normalized actions:

```json
{
  "actorId": "engineer-1",
  "agentId": "agent-a",
  "toolId": "example_connector.analyze",
  "toolVersion": "2.4",
  "resourceId": "customer-logs",
  "environment": "production",
  "action": "export_and_analyze"
}
```

Return structured decisions:

```json
{
  "decision": "BLOCK",
  "policyVersion": 21,
  "ruleIds": ["DATA-18"],
  "reasonCode": "RESTRICTED_EXTERNAL_EXPORT",
  "approvalEligible": false,
  "alternativeToolIds": ["internal_logs.search"]
}
```

**The LLM must never be the final authorization authority.** It can interpret tasks and explain decisions; code evaluates permissions.

### Precedence

1. Missing trusted identity or unverifiable policy: hold or deny.
2. Quarantine or non-overridable restriction: block.
3. Matching exception: allow only if the rule permits exceptions.
4. Matching allow rule: allow.
5. Approval-required rule: hold.
6. Otherwise: deny.

## 6. Execution gateway

Every governed call follows this path:

```text
Proposed action
→ validate arguments
→ resolve trusted metadata
→ load current rules and grants
→ evaluate permission
→ persist decision
→ execute only if allowed
→ save outcome
```

Requirements:

- Keep credentials behind the backend.
- Expose no unrestricted shell or generic internet tool.
- Recheck queued actions at dispatch.
- Use unique execution IDs to prevent duplicate side effects.
- Atomically consume single-use approvals.
- Record execution intent before dispatch.
- Mark ambiguous timeouts as `UNKNOWN`; do not automatically repeat them.

Serialize policy activation and final dispatch authorization in the single-instance demo. An action authorized after quarantine activation must use the new rule. Already dispatched work may complete.

**First milestone:** one real allowed call and one real blocked call, with matching database records and downstream receipts.

## 7. Persistent storage

| Collection | Stores |
|---|---|
| `policy_versions` | Immutable rules, versions, authors, reasons |
| `policy_heads` | Active version per tenant |
| `sessions` | Agent identity, mode, status, acknowledged version |
| `runs` | Requests, plans, context references, execution state |
| `events` | Ordered decisions, approvals, dispatches, outcomes |
| `approvals` | Scope, reviewer, expiry, revocation, consumption |
| `episodes` | Summarized experiences linked to actual events |
| `incidents` | Reports and quarantine references |
| `usage_edges` | Tool/version relationships with agents and environments |
| `proposals` | Suggested changes and supporting evidence |

Every decision references a policy version. Every execution references its decision. Every learning proposal references supporting evidence.

Use a new `demoRunId` when resetting. Preserve previous audit history.

## 8. Retrieval and pre-plan context

For each task:

1. Resolve employee, environment, and resources.
2. Fetch mandatory applicable rules using structured queries.
3. Search policy descriptions and historical episodes.
4. Combine lexical and vector results.
5. Rerank with Voyage.
6. Construct a short context packet.
7. Ask the assistant to propose a plan.

Separate the packet into:

- Current authoritative rules.
- Historical decisions and outcomes.
- Possible permitted alternatives.
- Expired or superseded information.

A previous approval is context, not a reusable permission grant.

If semantic retrieval fails, mark context as degraded while retaining the deterministic gate. If authoritative policy cannot be verified, stop sensitive execution.

## 9. Real agent and visible plan

Generate an explicit structured plan:

```json
{
  "goal": "Investigate the customer error",
  "steps": [
    {
      "toolId": "internal_logs.search",
      "purpose": "Find matching failures",
      "policyReferences": ["DATA-18"],
      "memoryReferences": ["episode-104"]
    }
  ]
}
```

Display that artifact. It explains intended actions without exposing hidden chain-of-thought.

For the split-screen comparison:

- Use the same model, task, and fixture data.
- Give each run isolated tool state.
- Supply company context and enforcement only to the governed run.
- Label the baseline’s missing controls clearly.
- Do not force the baseline to make a mistake.

The comparison should demonstrate behavior, not manufacture failure.

## 10. Approval workflow

1. Persist the held action when approval is required.
2. Show scope, purpose, tool, data, environment, and duration.
3. Authenticate the reviewer and check administrator permissions.
4. Save approval or rejection.
5. Resume the run.
6. Recheck current policy before execution.

Persist waiting state instead of keeping a request open.

### Temporary access demo

Use a **30-second grant**:

- A matching call succeeds during the window.
- The countdown expires.
- The next call is blocked.
- The grant remains visible in history.

Enforce expiry using server time and `expiresAt`, not database TTL deletion.

## 11. Live policy updates

1. Review the diff.
2. Verify the expected base version.
3. Create an immutable version.
4. Atomically activate it.
5. Receive the Change Stream notification.
6. Refresh connected workers.
7. Record acknowledgments.
8. Recheck subsequent calls against current policy.

| UI indicator | Meaning |
|---|---|
| Published version | Latest active policy |
| Agent-acknowledged version | Latest update received by the worker |
| Decision version | Policy actually used for a call |

Persist Change Stream resume tokens. On reconnect, refresh authoritative state before dispatching new work. Provision an appropriate replica-set or sharded deployment for Change Streams.

## 12. Cross-session memory

After Agent A finishes, save an episode:

> External analysis of restricted logs was blocked. Internal log search completed the investigation successfully.

Include:

- Task summary.
- Attempted action.
- Applicable rule and version.
- Permitted alternative.
- Observed outcome.
- Supporting event references.

Embed the episode and make it searchable with access filters.

Start **Agent B with empty conversation history**. It should retrieve the episode and use it in its plan. Prove persistence by restarting the worker before running Agent B. Sharing Agent A’s transcript is not sufficient.

## 13. Learning proposals

1. Group comparable approval records.
2. Calculate counts and outcomes in code.
3. Exclude incident-linked or unsuitable evidence.
4. Generate a constrained policy proposal.
5. Validate its scope.
6. Show the administrator its diff and evidence.
7. Publish only after approval.

Example:

> Repeated successful approvals support allowing connector v2.4 for Engineering sandboxes using synthetic data.

Use an **Analyze recent decisions** button. Label preloaded records as seeded history. Repeated approvals do not automatically grant future permission.

## 14. Incident response

An administrator injects a clearly labeled incident against the demo connector version.

Precedent:

1. Stores the report.
2. Queries recorded usage.
3. Computes known exposure.
4. Applies an authorized quarantine.
5. Publishes the policy.
6. Shows worker acknowledgments.
7. Blocks the next matching call.

Distinguish graph edges for:

- Configured access.
- Actual execution.
- Blocked attempts.
- Active exceptions.
- Connected and offline agents.

A blocked attempt does not prove exposure. Seeded graph nodes must not pretend to acknowledge live updates. Quarantine does not reverse completed actions.

## 15. Policy history and non-executing replay

Support:

- **Inspect original decision:** historical policy, context, approval, and outcome.
- **Compare against another version:** evaluate a recorded action without running it.

Preserve original evaluation time and approval state.

```text
Recorded outcome under v22: ALLOW
Comparison under v23: BLOCK
Reason: connector version quarantined
```

If the evaluator changed, label the result as a comparison rather than exact historical reproduction.

## 16. Event-driven UI

| Screen or panel | Purpose |
|---|---|
| Split-screen workspace | Main demonstration |
| Memory drawer | Retrieved policies and experiences |
| Plan comparison | How context changes the proposed route |
| Execution timeline | Decisions and actual outcomes |
| Approval inbox | Human review and temporary grants |
| Policy editor | Review and publish changes |
| Agent panel | Session status and version acknowledgment |
| Incident graph | Known affected usage |
| Policy Time Machine | Historical explanations |
| Evaluation panel | Measured results |

Events:

```text
context.retrieved
plan.created
action.proposed
decision.recorded
approval.requested
approval.granted
execution.started
execution.completed
execution.failed
episode.saved
policy.published
policy.acknowledged
incident.recorded
proposal.created
```

Animate from backend events. Show success only when a real tool result arrives. Include run/session IDs, timestamps, and sequence numbers for recovery and trace correlation.

## 17. Monitoring and optional voice

Instrument retrieval, planning, policy evaluation, dispatch, and outcomes with shared run IDs.

Use Raindrop for:

- Repeated denied calls.
- Failed tool calls.
- Successful permitted alternatives.
- Behavior following policy updates.

Use Modelence monitoring for application failures and request performance.

Add ElevenLabs last. Speech creates a reviewable administrator proposal and cannot directly authorize a policy change.

## 18. Verification checklist

Build approximately 50 labeled cases, plus these integration tests:

- [ ] Blocked call produces zero downstream receipts.
- [ ] Allowed call executes once and records its result.
- [ ] Duplicate submission does not repeat a side effect.
- [ ] Sandbox approval cannot authorize production.
- [ ] Version-specific approval cannot authorize another version.
- [ ] Expired grants fail even while database records remain.
- [ ] Quarantine overrides earlier approvals.
- [ ] Policy updates work without restarting sessions.
- [ ] Reconnected workers refresh before dispatch.
- [ ] Agent B retrieves Agent A’s experience after restart.
- [ ] Historical replay never executes tools.
- [ ] Memory retrieval respects tenant and role boundaries.

Show measured counts and denominators. Do not prefill evaluation percentages. Zero false allows on a finite test set is not a universal security guarantee.

## 19. Team allocation and schedule

| Owner | Responsibility |
|---|---|
| Vikhas | Policy engine, execution gateway, approvals, propagation |
| Teammate 2 | Agent, retrieval, episodes, consolidation |
| Teammate 3 | Frontend, graph, timelines, plan comparison |
| Teammate 4 | Tools, fixtures, tests, monitoring, deployment |

Vikhas’s integration and ingestion experience fits backend enforcement and persistence.

| Build window | Milestone |
|---|---|
| Hours 0–1 | Shared contracts, setup, capability checks |
| Hours 1–3 | Working allow/block execution path |
| Hours 3–5 | Retrieval, agent plans, saved episodes |
| Hours 5–6.5 | Fresh-agent memory demonstration |
| Hours 6.5–8 | Approvals, expiry, policy propagation |
| Hours 8–9 | Incident graph, quarantine, history |
| Hours 9–10 | Policy proposal and telemetry |
| Hours 10–11 | Tests, deployment, recovery |
| Hours 11–12 | Rehearsal, recording, submission |

Adjust to the event’s actual deadline. Pre-event preparation and code reuse must follow event rules.

## 20. Final presentation and recovery

Use a five-minute sequence:

1. **Same request, different plan:** baseline and governed runs.
2. **Real enforcement:** show the blocked connector received no call.
3. **Useful alternative:** execute internal log search.
4. **Persistent memory:** fresh Agent B retrieves Agent A’s experience.
5. **Live control:** approve scoped access and demonstrate expiration.
6. **Incident:** show known exposure and block future use.
7. **Learning:** show a proposal supported by recorded outcomes.
8. **Evidence:** finish with policy history and measured tests.

Prepare a recording and retain the HTML mock as a labeled fallback. Reset into a new namespace without deleting history. Never silently replace a claimed live run with scripted playback.

## Priority if time becomes tight

Protect:

- The real execution gate.
- Persistent outcomes.
- Fresh-agent retrieval.
- Live policy changes.
- One complete incident flow.

Cut voice, document import, elaborate graph styling, and broad integrations first.
