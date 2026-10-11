# Precedent: hackathon build plan (3 demo features + Mission Control)

> **Status (Oct 11):** Steps 1–5 are implemented and tested locally (see PROGRESS.md). Step 0: SDK installed and adapter written; Agent Engine credentials not yet configured. Feature 2 reworked (first-day Agent A, multi-step procedure): live A 5 steps/2 blocked vs B 3 steps/0 blocked. Deployed to precedent.vikhas.com. **Decision: Agent Engine skipped** (hosted memory needs a paid Flex cluster); pitch says **"built on MongoDB Atlas + Voyage AI"**. Playbooks are stored in Atlas and matched with Voyage rerank. Step 6 not started.

## Context
Precedent is entered in the MongoDB "Harness Engineering & Model Wrangling" hackathon (SF, Oct 11, 9 AM–10 PM). Each team gets a **2-minute demo**. A grilling session settled these decisions:

- **Pitch:** lead with Statement 1 (Recursive Harnessing), with Statement 2 (Long Horizon) as support. Tagline: *"Precedent is the governance layer for every MCP tool your agents touch."*
- **Features (demo order 2 → 1 → 3; build order 1 → 2 → 3):**
  1. **Self-writing guardrails:** repeated human approvals of the same MCP connection lead to an automatically drafted, narrowly scoped rule. Before publishing it shows an impact preview ("N of M past decisions would change", plus what stays blocked). One admin click publishes it.
  2. **Learned playbooks:** a successful governed run is distilled into a procedure stored in Atlas Agent Engine procedural memory. A fresh agent retrieves it and does better, shown in a measured A-vs-B chart.
  3. **Kill switch with blast radius:** report an incident against the connector MCP v2.4. The UI previews exposed, blocked, never-used and baseline usage, then one-click quarantine. A retry is blocked and the connector's own receipt count doesn't change.
- **UI:** a new **Mission Control** admin page with **three tabs** (Playbooks · Guardrails · Kill switch). Existing dashboards stay under "Advanced".
- **Demo history** is created by a **prepare-demo script** that drives the real API. Every number on screen comes from stored records; nothing is prefilled.
- **Stretch only:** a fleet ripple of real agent tiles, if features 1 and 2 are done by about 5 PM.

## Existing code to reuse (from exploration)
- **Pure policy decisions:** `evaluate(action, policy, grants, now)` in `packages/policy-engine/index.ts:3`. Its precedence already keeps the restricted-data block (`DATA-18`), the quarantine block (`INCIDENT-01`) and the default deny ahead of any learned allowance.
- **Proposals:** `analyzeProposals` / `publishProposal` / `eligible` in `packages/proposals/index.ts`. They group by tool (at least 2 records from at least 2 sessions), give each draft a stable sha256 id, and publish with a version check.
- **Single-decision replay:** `Precedent.replay` (`apps/server/service.ts:64`). It only works against stored policy versions, so it can't preview a draft.
- **MCP approvals:** `packages/mcp/requests.ts` (`reviewRequest` with scope `once`/`company`) and `apps/server/mcp-routes.ts`. The connection decision is currently written inline at L84-87.
- **Publishing:** `Precedent.publish(changes, inTx, reason)` (`service.ts:34`). Versions are immutable. It emits `policy.published`, calls `refreshWorkers()`, and the Change Stream watcher picks it up (`policy-watch.ts`).
- **Memory:** `saveRunOutcome` (`packages/memory/index.ts:8`) produces `outcomes[]` with status and receipt ids. The hook point is after `apps/server/api.ts:120`.
- **Retrieval:** `retrieveContext` (`packages/retrieval/index.ts:9`) uses Voyage embeddings and reranking. `retrieveForRuntime` (`apps/server/context.ts:56`) handles the transaction snapshot and merge-back. Atlas search builders are in `packages/retrieval/atlas.ts`.
- **Planner:** `planWithEve` (`apps/agent-worker/planner.ts:27`) and `verifyReferences` (L13). eve's `MessageResult.events` carries token usage per step and per turn (`step.completed.usage`, `turn.completed.usage`), but the planner doesn't record it yet.
- **Incidents:** `incidentGraph` / `usageEdge` (`packages/incidents/index.ts`). `Precedent.incident(toolId)` quarantines and records the incident in one step.
- **Receipts and adding collections:** connector receipts come from `gateway.receipts()` and `GET /api/downstream`. A new record kind needs an entry in `runtime.ts collectionNames` (L15) and the vector-field lists (L27, L78).
- **UI:** `IncidentGraph.tsx` is hand-built SVG. Routing is the `page` state in `apps/web/main.tsx` (L27-29). The event stream reader is at main.tsx:48-52. Styles are `design.css` tokens.
- **Scripts and tests:** `scripts/reset-demo.ts` drives the real API over loopback. Test harnesses: `tests/proposals.test.ts`, `tests/mcp-requests.test.ts` (`harness()` with a fake discover and controllable clock), and `tests/dashboard.spec.ts`.

---

## Step 0: Agent Engine test (30 min, first thing)
- `npm i @mongodb-js/agent-engine-sdk-memory` using `.tools/node` (Node 24). Sign in at agentengine.mongodb.com, create a project and a service-account token, and point it at the existing Atlas cluster.
- Write a throwaway script that runs `saveProcedure`, then `discoverProcedures`, from Node and records how long each takes.
- **Decision gate:** if it works, implement the `AgentEngineProcedureStore`. If not, use the `AtlasProcedureStore` fallback below and drop Agent Engine from the pitch.
- **Also in this window:** run 3 live governed runs of the playbook task, to see whether the real model actually takes more steps without a playbook. If it doesn't, pick a task where the order of steps matters (for example internal search → staging read, which needs approval) before building #2. **No forced mistakes.**

## Step 1: Self-writing guardrails (build first)
**Backend**
1. **Extract a pure MCP decision function.** Add `mcpConnectionDecision(policy, name, endpoint)` to `packages/mcp/index.ts`, returning `ALLOW | BLOCK | REQUIRE_APPROVAL` plus the rule id. Replace the inline logic in `mcp-routes.ts` L84-87, L64-65 and L18-19 with calls to it. Behaviour stays the same, and the existing MCP tests must still pass.
2. **Proposals from MCP approvals** in `packages/proposals/index.ts`:
   - Add `analyzeMcpProposals(service)`.
   - Evidence is MCP requests with `scope:'once'`, status `CONSUMED`, `reviewedBy` set, and a linked run whose `mcpResult.status==='CONNECTED'`. Exclude anything DENIED, EXPIRED or CANCELLED.
   - Group by `(mcpKey(name), endpoint)`. Require at least 3 approvals from at least 2 sessions or requesters.
   - The draft is `{kind:'mcp', key, name, endpoint, allowed:true}`.
   - Widen `policyProposalSchema.scope` in `packages/contracts/index.ts:30` to a union on `kind`: `'sandbox'` (existing, for legacy records with no kind) and `'mcp'`.
   - In `publishProposal`, the `mcp` branch publishes `mcpConnections:[...,entry]`. It keeps the same version check and re-validates the evidence.
3. **Bulk impact preview** in the new file `packages/proposals/impact.ts`:
   - `impactPreview(service, proposal)` re-evaluates all non-baseline tool executions with `evaluate(e.action, draftPolicy, e.grants, e.at)`.
   - It also re-evaluates all recorded MCP runs with `mcpConnectionDecision(draftPolicy, …)`.
   - Returns `{total, changed:[{id, from, to}], stillBlocked:{restrictedData, quarantined, otherMcpEndpoints, deniedMcp}, newlyBlocked:0-check}`.
   - Nothing is executed, and no tool is called.
4. **Automatic trigger.** After an MCP request is consumed or resumed, and after a tool approval resume, call both analyzers inside the same transaction. They emit `proposal.created`. The existing ids are deterministic, so this is safe to repeat. Keep `POST /api/proposals/analyze` as a manual fallback.
5. **Routes:** add `GET /api/proposals/:id/impact` (admin). The existing `POST /api/proposals/:id/publish` handles the MCP kind.

**Tests** (new `tests/self-writing.test.ts`, following the `mcp-requests` harness pattern):
- 2 approvals produce no draft; 3 approvals across sessions produce one draft.
- A denied or expired request isn't counted as evidence.
- The impact preview counts the changed decisions correctly, and restricted data and quarantine stay blocked.
- Publishing with a stale version returns 409.
- After publishing, a new governed request connects with no approval, while a different endpoint is still held.
- The extracted decision function gives the same results as the old inline code, checked against the existing MCP tests.

## Step 2: Learned playbooks
**Backend**
1. **Store interface** in the new folder `packages/playbooks/`:
   - `ProcedureStore { save(p), discover(task, scope, k) }`.
   - `AgentEngineProcedureStore` wraps the SDK's `saveProcedure` / `discoverProcedures`.
   - `AtlasProcedureStore` is the fallback: a new `procedure` kind added to `runtime.ts collectionNames`, plus a 1024-dimension Voyage embedding using the existing retrieval embedding path. Ranking is local cosine similarity, so no 4th Atlas search index is needed (the free tier allows 3).
2. **Distill** with `distillPlaybook(run, outcome)`:
   - Keep the steps with `SUCCEEDED && receiptId`. Record the blocked tools as `avoid[]` with their rule ids.
   - Also store `{title, taskSummary, steps[], avoid[], policyVersion, sourceRunId, evidenceIds, status:'VALID'}`.
   - Call it after api.ts:120 when `outcomeStatus==='FINISHED'`, and emit `playbook.saved`.
3. **Retrieve.** In `retrieveContext`, add a `procedures` section (top 1–2, scoped by tenant and role, `status==='VALID'` only).
   - Include it in the packet sent to `planWithEve`.
   - Extend `verifyReferences` so playbook ids count as valid memory references.
   - Add one line to `agent/instructions.md`: playbooks are advice and every step is still checked.
4. **Measured metrics.** In `planWithEve`, add up `turn.completed.usage` from `result.events` and store `run.metrics = {inputTokens, outputTokens, planningMs}`.
   - Steps and blocked counts come from the run's executions. Total time comes from `run.durationMs`.
   - Add `GET /api/playbooks/:id/comparison`, returning the metrics for the source run and the latest run that used the playbook.
5. **Re-validation.** In `Precedent.publish`, re-evaluate each `VALID` playbook's steps under the new policy using `evaluate`. Any step that isn't `ALLOW` sets `NEEDS_REVALIDATION` and emits `playbook.invalidated`. This also connects to Feature 3.

**Tests:** distilling drops blocked steps; a fresh session retrieves the playbook (different session, same tenant); a playbook from a different tenant or role is excluded; quarantine marks the playbook `NEEDS_REVALIDATION`; token metrics are recorded from mocked eve events; the store fallback works when Agent Engine isn't configured.

## Step 3: Kill switch with blast radius
**Backend**
1. **Read-only preview** with `blastRadius(service, toolId)` in `packages/incidents/index.ts`. It builds on `incidentGraph` and adds:
   - `neverUsed` (configured minus used)
   - counts per category
   - whether `customer-logs` was exposed
   - the connector receipt count from `gateway.receipts()`

   Route: `GET /api/incidents/preview?toolId=` (admin). Nothing is written.
2. **Quarantine** uses the existing `POST /api/incidents`. Its response gains `receiptCountBefore` and `receiptCountAfter`.
3. **Test call:** add a `POST /api/incidents/test-call` (admin) that creates an admin-owned session and runs one governed call with a new execution id through the existing gateway. It should come back BLOCKED with rule `INCIDENT-01`, and the receipt count should not change.
4. **Display label:** show `example_connector` as **"LogLens MCP v2.4"**, the stdio MCP server that already exists. The underlying tool id stays the same.

**Tests:** the preview writes nothing; never-used = configured minus used; after quarantine the test call is blocked and the receipt count is the same; baseline edges are reported separately; a playbook that uses the tool is invalidated.

## Step 4: Mission Control UI (`/mission`, three tabs)
- New `apps/web/MissionControl.tsx` with tabs **Playbooks · Guardrails · Kill switch**, linked from admin navigation. The existing admin page stays as it is and remains available ("Advanced").
- **Playbooks tab:** playbook card (steps, avoid, policy version, status badge) and an A-vs-B bar chart in hand-written SVG (steps, blocked, tokens, time). No new dependency.
- **Guardrails tab:** draft rule card with evidence links, an animated "N of M past decisions would change" counter, the still-blocked checklist, and a **Publish rule** button that sends the version to check.
- **Kill switch tab:** **Report incident**, then a blast radius graph centred on the connector (adapted from the `IncidentGraph.tsx` SVG, using the 4 colour categories), a summary banner, **Quarantine**, a lock animation, **Send test call**, and the receipt counter shown before and after.
- **Live updates:** reuse the existing event stream, which refetches `/api/state` on any new event. Add `playbooks`, `mcpProposals` and `impact` to `snapshot()` (service.ts:69).
- Add status colour tokens to `design.css`. Respect reduced motion. Design for a 1440px projector; the screen must still work on mobile.

## Step 5: Prepare-demo script (`scripts/prepare-demo.ts`, `npm run demo:prepare`)
- Follows the `reset-demo.ts` pattern. Supports both demo auth and Modelence login (username and password from `.data/local-login.env`, cookie session).
- **Sequence:**
  1. Reset to a fresh demo run.
  2. **Feature 2:** run Agent A's governed task live and wait until it finishes.
  3. **Feature 1:** 3 sessions request the Docs Preview MCP, the admin approves each once, each resumes (real public discovery), and a draft appears.
  4. **Feature 3:** sandbox runs using v2.4, plus one blocked attempt and one baseline run.

  Agent B's live run and the publish and quarantine clicks are left for the stage.
- It is idempotent, and prints a checklist: playbook saved ✓, draft ready ✓, v2.4 usage recorded ✓.

## Step 6: Stretch (only if Steps 1–4 are done by about 5 PM)
Fleet ripple: create 12 real sessions through `POST /api/sessions` and keep heartbeats going, then measure the time from `policy.published` to each `policy.acknowledged` and show it as a tile grid on the Kill switch tab.

## Timeline (today)
| Time | Work |
|---|---|
| 9:00–9:45 | Check eligibility with organizers; Step 0 test plus the live Agent A behaviour check |
| 9:45–12:30 | Step 1 backend + tests |
| 12:30–15:00 | Step 2 backend + tests |
| 15:00–16:30 | Step 3 backend + tests |
| 16:30–19:00 | Step 4 Mission Control UI (+ Step 6 if ahead) |
| 19:00–19:45 | Step 5 prepare-demo script, deploy to precedent.vikhas.com |
| 20:00–22:00 | Rehearse until it runs in 1:50, record the fallback, update README/PROGRESS |

**If behind:** cut Step 6, then the Agent Engine store (use the Atlas fallback). Features #1 and #3 are never cut.

## Verification
- `npm test` (all existing tests plus the new suites), `npm run build` (typecheck plus Vite), `npm run evaluate` (50/50, no unexpected allows).
- New Playwright story in `tests/dashboard.spec.ts`: Mission Control tabs, publish draft, then the next request connects; report, then quarantine, then the test call is blocked and the receipt count is the same.
- Live check against the hosted app: `npm run demo:prepare`, then walk through the 2-minute script on https://precedent.vikhas.com and confirm every on-screen number matches `/api/state`. Restart the services with `systemctl --user restart precedent-api precedent-worker` after deploying.
- Record the fallback video with `npm run demo:record`, extended to cover Mission Control, and label it as a recording.

## Risks
- **The live model doesn't fumble without a playbook.** Checked in Step 0. Never force a mistake; change the task if needed.
- **The public Tenable or Docs MCP endpoint is down on stage.** The prepare script builds the history in advance; the live publish step needs no network.
- **Agent Engine is in preview.** The Atlas fallback sits behind the same interface.
- **Groq latency on stage.** Agent B's run is the only live model call. Pre-warm it and keep the recorded fallback ready.
