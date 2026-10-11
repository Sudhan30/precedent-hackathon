# Testing the 5 demo features: step by step

Follow the steps in order. Each step lists **where**, **what to type or click** (prompts are in code blocks: copy them exactly), and **what you should see**. Tick each box as it passes.

App: https://precedent.vikhas.com · Password for all demo accounts: the shared demo password (given privately).

**Chat sides:** **Without Precedent** = left chat (no governance, no memory). **With Precedent** = right chat (policy, playbooks, memory). Unless a step says otherwise, use the **right** chat.

---

## Step 0. Setup

- [ ] **0.1** On the host, in the project folder:
  ```sh
  npm run demo:prepare -- --reset
  ```
  You should see: a fresh demo namespace, "Docs Preview MCP approval 1/2/3 of 3", and three `✓` readiness lines. Any `✗`: stop and fix it first.
- [ ] **0.2** Open four separate browser windows (separate profiles or private windows) and sign in:

  | Window | Username | Department |
  |---|---|---|
  | W1 | `manager` | Engineering (admin) |
  | W2 | `engineer2` | Engineering |
  | W3 | `sales` | Sales |
  | W4 | `finance` | Finance |

  You should see: each header shows the matching department chip. Only W1 shows **Admin** and **Mission Control**.

---

## Feature 1. MCP policy block

- [ ] **1.1** W1 → **Admin** → **MCP & tool access**.
  You should see: Tenable documentation MCP is **Blocked**.
- [ ] **1.2** W1 → chat, **right** side, send:
  ```
  Connect Tenable MCP to read its developer documentation.
  ```
  You should see: an MCP card with **BLOCK**, "Company policy blocks Tenable MCP connections", the policy version, status **BLOCKED**, "No connection attempted." No tools are listed.
- [ ] **1.3** Same chat, send:
  ```
  Install the Tenable MCP
  ```
  You should see: the same **BLOCKED** decision.
- [ ] **1.4** (Contrast) W1 → chat, **left** side (Without Precedent), send:
  ```
  Connect Tenable MCP to read its developer documentation.
  ```
  You should see: **CONNECTED**, with discovered tools listed (no governance on this side).
- [ ] **1.5** W1 → **Admin** → Recent activity.
  You should see: both blocked attempts listed.

---

## Feature 2. Learned playbooks

- [ ] **2.1** W1 → **Mission Control** → **Learned playbooks**.
  You should see: a playbook learned from Agent A's Globex investigation, with steps (internal log search → deploy history → service metrics), findings and actions to avoid, "Stored in MongoDB Atlas".
- [ ] **2.2** W1 → chat, **right** side, send:
  ```
  Initech says payments fail at checkout. Find the root cause.
  ```
  You should see: run steps Context → Plan → Act. The context names the matched playbook (**Matched by Voyage rerank**, or keyword fallback). The run finishes in about 20 s with a root-cause answer.
- [ ] **2.3** W1 → **Mission Control** → **Learned playbooks**.
  You should see: **Agent A vs Agent B**, "Agent B followed the playbook", with B taking fewer steps and **0 blocked** calls (last measured: A 5 steps / 2 blocked, B 3 steps / 0 blocked).
- [ ] **2.4** (Contrast) W1 → chat, **left** side, send:
  ```
  Initech says payments fail at checkout. Find the root cause.
  ```
  You should see: no playbook in the context; the agent works it out from scratch.

---

## Feature 3. Self-writing guardrails

- [ ] **3.1** W1 → **Mission Control** → **Self-writing guardrails**.
  You should see: a **Suggested rule** for Docs Preview MCP, drafted from 3 admin approvals, with evidence.
- [ ] **3.2** Read **Before you publish: impact on recorded history**.
  You should see: "Replaying recorded decisions…", then "**N of M past decisions would change**", and **Still protected** with **3 green checks**.
- [ ] **3.3** Click **Publish rule**.
  You should see: "**Precedent rewrote its own guardrail**", status **PUBLISHED**.
- [ ] **3.4** W2 (engineer2) → chat, **right** side, send:
  ```
  Connect with Docs Preview MCP
  ```
  You should see: it connects under the new rule, **without** asking for approval.
- [ ] **3.5** Same chat, send:
  ```
  Connect Tenable MCP to read its developer documentation.
  ```
  You should see: still **BLOCKED** (the new rule is narrow).

---

## Feature 4. Agent memory (learn once, checkpoint, human approval, department reuse)

### 4A. Without Precedent never learns
- [ ] **4.1** W1 → chat, **left** side → click **Query the data warehouse** (or **Tools & data → Data warehouse (BigQuery-style)**), then send:
  ```
  Weekly active customers by region last quarter
  ```
  You should see: a `warehouse.query` on a guessed table → **0 rows** → **No results found.** form.
- [ ] **4.2** In the form: **BigQuery table** = `acme_dw.t_04417`, **Definitions (optional)** =
  ```
  Active means at least one order in the trailing 7 days.
  ```
  → click **Ask again with this table**.
  You should see: **12 rows**, latest week **NA 4621, EMEA 3531, APAC 3074**. **No** memory card.
- [ ] **4.3** Send the same question again on the left:
  ```
  Weekly active customers by region last quarter
  ```
  You should see: **0 rows** again (nothing was remembered).

### 4B. With Precedent learns, with a checkpoint and approval
- [ ] **4.4** W1 → chat, **right** side → **Query the data warehouse**, send:
  ```
  Weekly active customers by region last quarter
  ```
  You should see: **0 rows**, the **No results found.** form. Inspect context says "Agent memory · engineering: No approved agent memory…".
- [ ] **4.5** In the form: table `acme_dw.t_04417`, definitions `Active means at least one order in the trailing 7 days.` → **Ask again with this table**.
  You should see: 12 rows (NA 4621, EMEA 3531, APAC 3074), plus a card **Add this to agent memory?** with `CHECKPOINT-OK · Classification internal; scope limited to the engineering department.`
- [ ] **4.6** Click **Add to agent memory (engineering department)**.
  You should see: **Saved to agent memory**, "Shared only with the engineering department."

### 4C. Restricted data is stopped at the checkpoint
- [ ] **4.7** W1 → chat, **right** side, Data warehouse scope, send:
  ```
  Total revenue by customer for last quarter
  ```
  When the **No results found.** form appears, enter table `finance.restricted_revenue_by_customer` → **Ask again with this table**.
  You should see: `warehouse.query` **PENDING**, rule **DATA-31** "Finance-restricted tables need the finance department or a one-time approval".
- [ ] **4.8** W1 → **Admin** → **Approval requests** → approve for **30 seconds** → back in the chat click **Resume after approval**.
  You should see: the query **SUCCEEDED**, then a memory card **Checkpoint: not saved to agent memory**, `CHECKPOINT-FIN-01`, with **no** approve button.

### 4D. Reuse in the same department, no leak to others
- [ ] **4.9** W2 (engineer2) → chat, **right** side → **Query the data warehouse**, send:
  ```
  Weekly active customers by region last quarter
  ```
  You should see: the context lists `acme_dw.t_04417` under "Agent memory · engineering"; the query uses **`acme_dw.t_04417` on the first try** → 12 rows. No form, no new proposal.
- [ ] **4.10** W3 (sales) → chat, **right** side → **Query the data warehouse**, send:
  ```
  Weekly active customers by region last quarter
  ```
  You should see: "Agent memory · sales: No approved agent memory…", a guessed table → **0 rows** → the No results form. Engineering's memory did **not** leak.
- [ ] **4.11** W4 (finance) → chat, **right** side → **Query the data warehouse**, send:
  ```
  Total revenue by customer for last quarter
  ```
  If the form appears, enter `finance.restricted_revenue_by_customer` → **Ask again with this table**.
  You should see: the query runs **without** an approval hold (finance owns this table).
- [ ] **4.12** W1 → **Mission Control** → **Agent memory**.
  You should see: `acme_dw.t_04417` with an **ENGINEERING** badge; the finance attempt under **Blocked at the checkpoint**; **Learning once vs reusing**: learning took 2 queries, 1 empty result, 1 correction; reuse took 1 query, no help.

---

## Feature 5. Kill switch with blast radius

- [ ] **5.1** W1 → **Mission Control** → **Kill switch**.
  You should see: "Report an incident against" with connector **LogLens connector MCP v2.4**, and buttons 1–3.
- [ ] **5.2** Click **1 · Report incident**.
  You should see: **Blast radius**, with Exposed / Blocked attempt / Access, never used, and "**Restricted customer data: not exposed**".
- [ ] **5.3** Note the **Connector's own receipt count**: ______
- [ ] **5.4** Click **2 · Quarantine v2.4**.
  You should see: **QUARANTINED**.
- [ ] **5.5** Click **3 · Send test call**.
  You should see: "**Test call: BLOCKED**", and the receipt count is **unchanged** (same as 5.3).
- [ ] **5.6** W2 (engineer2) → chat, **right** side → **Tools & data → Sandbox logs**, send:
  ```
  Analyze the synthetic sandbox logs with example_connector.analyze.
  ```
  You should see: the connector call is **BLOCKED** by the quarantine, for every agent.

---

## Reset

To test again from a clean state, on the host run:
```sh
npm run demo:prepare -- --reset
```
This clears the published rule, the quarantine and the demo sessions. Accounts and departments are kept.

## If a step fails

| What you see | Do this |
|---|---|
| "FAILED during planning" | Send the same prompt again (model-provider hiccup) |
| "Live planning is unavailable" | On the host: `systemctl --user restart precedent-worker`, wait 10 s |
| No **No results found.** form | The model guessed the right table first. Ask the question again. |
| "Policy changed; refresh" | Reload the page and repeat the step |
| Context says "matched by keyword" | Voyage was busy; this fallback is expected and fine |
