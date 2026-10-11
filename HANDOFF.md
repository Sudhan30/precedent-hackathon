# Precedent — development handoff

## User's current instruction
Continue developing this project on the user's server inside Zellij. Follow
`Precedent_Implementation_Plan.md` and carry implementation through a working,
tested hackathon demo. This handoff is a context summary, not an imported chat
session. Read `AGENTS.md` before editing.

## Product and decisions
Precedent (formerly Sentinel): company memory for every AI decision. Agents
retrieve current organizational rules and relevant past outcomes before planning;
a deterministic server gate authorizes every actual tool invocation. Humans can
approve tightly scoped temporary access. Policy updates and incident quarantine
affect later actions. A fresh session retrieves persisted experience.

Build a separate working application; existing explanatory HTML sites are mocks:
- https://sentinel-memory-story.vsgiri.chatgpt.site/
- https://sentinel-side-by-side-demo.vsgiri.chatgpt.site/

Use harmless synthetic data and controlled tools. The final UI divides the screen
into with/without Precedent. Never imply fixture behavior is real model behavior.

Planned stack: React/TypeScript, Modelence backend, MongoDB Atlas, Voyage retrieval,
isolated eve worker, SSE, MongoDB Change Streams, Raindrop evaluation. ElevenLabs
optional, AWS unnecessary. Preserve these targets; do not silently substitute the
local prototype for the agreed architecture. One backend instance is adequate.

## Exact checkpoint — incomplete, untested source
An eve project was initialized with eve 0.74.0. Dependencies installed successfully.
The generated agent model/configuration has been preserved. No live agent
integration or external service configuration has been completed.

New files:
- `packages/contracts/index.ts`: action, policy, grant, decision types, tool registry.
- `packages/policy-engine/index.ts`: deterministic deny, quarantine, restricted
  external export, one-use scoped staging approval, internal and sandbox rules.
- `apps/server/store.ts`: local SQLite prototype store using Node 24 node:sqlite.
- `apps/server/service.ts`: prototype sessions, decisions, synthetic receipts,
  approval/grant records, policy versions, historical memory, incident summaries,
  counterfactual replay, evidence-linked draft proposals.

These files have NOT been typechecked or tested. They are not a runnable app.
There is no HTTP server, authentication, React UI, MCP server, SSE implementation,
live planner, MongoDB adapter, sponsor telemetry, or evaluation suite yet.
The npm scripts still refer to the generated eve scaffold. The current tsconfig
includes only agent/evals, so its typecheck does not cover the new packages.
The SQLite path is a temporary credential-free development option, not the final
MongoDB implementation. No deployment has been performed for this source.

## Immediate work
1. Inspect the files, add new source paths to TypeScript checks, and fix errors.
   Object.groupBy may need an ES2024 lib target; use the installed TS version.
2. Add meaningful policy and service tests before connecting the UI. Cover denied
   calls producing zero receipts, exactly one receipt for duplicate execution IDs,
   expiry, all grant scope dimensions, quarantine overriding grants, stale grants,
   fresh-session memory, persistence across restart, and replay without execution.
3. Implement authenticated backend endpoints and a trusted execution adapter.
   Do not expose the prototype baseline flag or approve/publish methods to agents.
   Validate runtime payloads; TypeScript types do not validate HTTP input.
4. Build the split-screen React UI and actual event stream. Label deterministic
   fixture planning, SQLite mode, synthetic receipts, and live integrations plainly.
5. Complete Modelence/MongoDB, authoritative policy loading, Voyage retrieval,
   isolated eve worker, MCP connector, approvals/resume, policy notifications,
   incident graph, replay/evaluation, and Raindrop wiring per the full plan.
6. Verify the complete browser → API → persistence → tool receipt flow. Update
   README with exact working commands, configuration requirements and limitations.

## Prototype caveats requiring work
- Baseline bypass is currently only an internal method flag. Keep it isolated to
  synthetic comparison runs and inaccessible to normal agent tool calls.
- The service has no role enforcement; do not expose it until routes authenticate
  employees/admins and derive trusted actor/session/resource scope server-side.
- Service execution records and local receipts commit together atomically. This
  is fine for local synthetic effects, but is not proof of durable pre-dispatch
  authorization for external calls. Real dispatch needs a committed intent,
  idempotency, UNKNOWN outcome on ambiguous timeout, and no blind retry.
- Incident publication and incident-record creation are separate operations;
  harden transaction/event semantics before live use.
- Memory currently filters on resource and excludes the current session. No
  tenant controls, semantic ranking or pre-plan injection exists yet.
- Replay explicitly uses no grants and is labeled counterfactual. It does not yet
  reconstruct historical approval state as required by the final plan.
- Session identity is a fixed synthetic engineer, not authenticated identity.
- Unknown runtime inputs can still throw; add strict schemas and fail-closed errors.
- Validate finite bounded approval TTLs at server and domain boundaries.

## Runtime guidance
Node 24.x is declared; use `npm ci` to reproduce dependencies. Read the installed
`node_modules/eve/docs/README.md` and relevant topic before editing eve artifacts.
Search eve registry for named services before authoring integrations, per AGENTS.
A prior registry search started but yielded no usable integration result; rerun.
No credentials are included. Ask only for credentials/configuration that actually
block the next step; implement independent work first. Do not print secrets.

## Working style and continuity
Continue through complete milestones, testing meaningful boundaries. Keep a
`PROGRESS.md` with implemented features, test evidence, open issues and exact next
commands, and checkpoint local git commits as appropriate. Never claim untested
or stubbed features work. Do not automatically publish or send external messages.
Zellij preserves a running terminal across SSH disconnects; it does not eliminate
approval prompts, task completion, rate limits, or server reboots. Do not invent
an infinite retry loop or disable approval controls to simulate continuous work.
