# Precedent test playbook

A manual test of the five demo features on https://precedent.vikhas.com: learned playbooks, self-writing guardrails, kill switch, MCP block and agent memory. Each case lists its steps, what you should see, and when it passes. Run the sections in order: later sections depend on the history created earlier.

Scenario details for agent memory live in `DEMO_RUNBOOK.md`. This file covers everything else and refers to that file where needed.


## 0. Before you start

| # | Do | Expect |
|---|---|---|
| 0.1 | On the host: `systemctl --user is-active precedent-api precedent-worker precedent-tunnel` | `active` three times |
| 0.2 | On the host: `npm run demo:prepare -- --reset` | A fresh demo namespace, then the steps it runs (Agent A first-day run, sandbox usage, Docs Preview MCP approval 1/2/3 of 3), then three `✓` readiness lines. Any `✗` line: stop and fix it first. |
| 0.3 | Open separate browser profiles or private windows | One each for **manager**, **engineer2**, **sales** (and **finance** for 5.7). All accounts use the shared demo password, given privately. |

**Accounts:** `manager` (admin, engineering), `engineer1` / `engineer2` (employee, engineering), `sales` (employee, sales), `finance` (employee, finance).

**Chats:** **Without Precedent** (left) has no governance and no memory. **With Precedent** (right) has policy checks, playbooks and agent memory. Each message is a fresh run.


## 1. Feature 2: learned playbooks (agents learn from each other)

Prepared history: **Agent A** (a first-day agent with no company memory) investigated a Globex checkout failure the hard way.

| ID | Steps | Expected | Pass when |
|---|---|---|---|
| 1.1 | `manager` → **Mission Control → Learned playbooks** | A playbook from Agent A's run: "Investigate … Globex", with its steps (e.g. Internal log search → Deploy history → Service metrics) and the actions to avoid; "Stored in MongoDB Atlas" | Playbook visible, with steps and findings |
| 1.2 | In **With Precedent**, send `Initech says payments fail at checkout. Find the root cause.` | Run steps show Context → Plan → Act; the context lists the matched playbook (**Matched by Voyage rerank**, or keyword fallback); the agent follows the playbook's tools and cites the playbook ID | Run **FINISHED** in ~20 s |
| 1.3 | Back to **Mission Control → Learned playbooks** | **Agent A vs Agent B**: "Agent B followed the playbook". Agent B has fewer steps and **0 blocked calls**; Agent A had blocked attempts. Last live measurement: A 5 steps / 2 blocked, B 3 steps / 0 blocked. | B is better than A on steps and blocked calls. Numbers are measured, so they can vary slightly between runs. |
| 1.4 | Send the same Initech task in **Without Precedent** | No playbook in context; the agent works it out from scratch | Shows the difference without memory |


## 2. Feature 1: self-writing guardrails

Prepared history: an employee asked to connect **Docs Preview MCP** three times, and an admin approved it each time, across two sessions.

| ID | Steps | Expected | Pass when |
|---|---|---|---|
| 2.1 | `manager` → **Mission Control → Self-writing guardrails** | **Suggested rule** drafted from the 3 approvals, with evidence links | Draft visible |
| 2.2 | Read **Before you publish: impact on recorded history** | "Replaying recorded decisions…", then "**N of M past decisions would change**"; **Still protected** has 3 green checks (e.g. "No allowed action becomes blocked", Tenable stays blocked) | Exactly 3 passing checks |
| 2.3 | Click **Publish rule** | "**Precedent rewrote its own guardrail**"; rule status **PUBLISHED**; policy version goes up by 1 (Admin → policy history) | Published once; a second click is not offered |
| 2.4 | `engineer2`, **With Precedent**: `Connect with Docs Preview MCP` | Connects under the new rule, **without** an approval request | Status CONNECTED, no approval needed |
| 2.5 | `engineer2`, **With Precedent**: `Connect Tenable MCP to read its developer documentation.` | Still **BLOCKED**: the new rule is narrow | Tenable unaffected |


## 3. Feature 3: kill switch with blast radius

Prepared history: the sandbox analysis ran through **LogLens connector MCP v2.4**.

| ID | Steps | Expected | Pass when |
|---|---|---|---|
| 3.1 | `manager` → **Mission Control → Kill switch** | "Report an incident against LogLens connector MCP v2.4" and buttons 1–3 | Panel loads |
| 3.2 | Click **1 · Report incident** | **Blast radius**, with exposure grouped as Exposed / Blocked attempt / Access, never used, plus "**Restricted customer data: not exposed**" | All numbers come from recorded calls |
| 3.3 | Note **Connector's own receipt count** | A number, e.g. N | Write it down |
| 3.4 | Click **2 · Quarantine v2.4** | Connector shows **QUARANTINED** | Quarantined |
| 3.5 | Click **3 · Send test call** | "**Test call: BLOCKED**"; the connector's receipt count is **unchanged** (still N) | The call never reached the connector |
| 3.6 | `engineer2`, **With Precedent**, sandbox scope under **Tools & data**: `Analyze the synthetic sandbox logs with example_connector.analyze.` | Blocked for every agent (quarantine), and recorded in Admin → Recent activity | No connector call goes out |


## 4. MCP policy enforcement

| ID | Steps | Expected | Pass when |
|---|---|---|---|
| 4.1 | `manager` → **Admin → MCP & tool access** | Tenable documentation MCP shows **Blocked** | Policy visible |
| 4.2 | **With Precedent**: `Connect Tenable MCP to read its developer documentation.` | MCP card: **BLOCK**, "Company policy blocks Tenable MCP connections", policy version, **BLOCKED**, "No connection attempted." | No tools discovered |
| 4.3 | **With Precedent**: `Install the Tenable MCP` | Same BLOCK decision | Blocked again |
| 4.4 | **Without Precedent**: the same message as 4.2 | Real handshake: **CONNECTED** with discovered tools | Shows what governance prevents |
| 4.5 | Admin → Recent activity / Advanced → MCP connection audit | Each blocked attempt is listed with the policy version | Audit trail complete |


## 5. Agent memory (learn once, reuse per department)

Run `DEMO_RUNBOOK.md` Scenarios 1, 2, 2b, 3a and 3b (same flow, more detail). In short:

| ID | Who / where | Steps | Expected | Pass when |
|---|---|---|---|---|
| 5.1 | manager, **Without Precedent**, Data warehouse | `Weekly active customers by region last quarter` → enter table `acme_dw.t_04417` and the definition → ask again → repeat the question | Guessed table gives `0 rows`; the hint gives 12 rows (latest week **NA 4621, EMEA 3531, APAC 3074**); no memory card; the repeat gives 0 rows again | Plane A never learns |
| 5.2 | manager, **With Precedent**, Data warehouse | Same question → 0 rows → hint → answer | Card **Add this to agent memory?** with `CHECKPOINT-OK` | Proposed, not yet stored |
| 5.3 | manager | Click **Add to agent memory (engineering department)** | **Saved to agent memory**; Mission Control → Agent memory lists `acme_dw.t_04417` with an ENGINEERING badge | Stored only after approval |
| 5.4 | manager, With Precedent | Hint table `finance.rev_by_cust` → held for approval (**DATA-31**) → Admin approve → **Resume after approval** | Query succeeds; memory card: **Checkpoint: not saved**, `CHECKPOINT-FIN-01` | Restricted data never enters memory |
| 5.5 | engineer2, With Precedent, Data warehouse | Same question | Queries `acme_dw.t_04417` **first try**, 12 rows, no hint form | Same-department reuse |
| 5.6 | sales, With Precedent, Data warehouse | Same question | Context: "No approved agent memory"; 0 rows; hint form appears | No leak across departments |
| 5.7 | finance, With Precedent, Data warehouse | Hint `finance.rev_by_cust` | Runs without an approval hold (finance owns the table) | Department rule respected |
| 5.8 | manager → Mission Control → Agent memory | — | **Learning once vs reusing**: learning took 2 queries, 1 empty result, 1 correction; reuse took 1 query, no help | Comparison measured |


## Reset between test rounds

`npm run demo:prepare -- --reset`. This clears agent memory, playbooks, the published guardrail and the quarantine, and rebuilds the prepared history. Audit history and accounts (with departments) are kept.

## If something fails

Send the same message again (model-provider hiccups are the usual cause). If runs show "Live planning is unavailable", run `systemctl --user restart precedent-worker` on the host. More in `DEMO_RUNBOOK.md` section 7.
