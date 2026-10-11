# Precedent: 2-minute demo script

Four features, in this order. Prompts in `code` are typed exactly. All warehouse data is synthetic and says so.

## Before you go on stage (10 minutes before)

1. On the host: `npm run demo:prepare -- --reset` and wait for three `✓` lines. This must be the **last** change before the demo: it clears agent memory, the published guardrail, quarantines and any tool-access changes.
2. Open three browser windows (separate profiles or private windows) at https://precedent.vikhas.com:

   | Window | User | Team colour | Open on |
   |---|---|---|---|
   | **W1** (projector) | `manager` (department: Engineering, already saved) | purple (admin) | Tab 1: User workspace · Tab 2: Mission Control |
   | **W2** | `engineer2` | blue (engineering) | User workspace |
   | **W3** | `sales` | amber (sales) | User workspace |

3. In W2 and W3, right chat (**With Precedent**): click **Query the data warehouse** (fills the question, selects the warehouse). **Do not send.**
4. Warm up: send `hello` once in W1, then reload W1.
5. Keep one or two tabs per person and do not run automated tests against the live site (the free Atlas tier throttles heavy traffic).

---

## On stage

### 0:00 Opening
> "Agents fail in companies for two reasons: they do things they shouldn't, and they forget what they learned. Precedent is the harness that fixes both, built on MongoDB Atlas and Voyage AI."

### 0:08 Feature 1: MCP block
- W1, right chat **With Precedent**, send: `Connect Tenable MCP to read its developer documentation.`
- Card: **BLOCKED**, "No connection attempted."
> "Company policy blocks this MCP. The agent never touched the network."

### 0:18 Feature 2: agent memory with a human checkpoint (hero)
- W1, right chat: click the **Query the data warehouse** chip above the message box, then send.
- Result: **0 rows** and **No results found.**
> "Real warehouses are undocumented. The agent guessed the obvious table, and it's a dead one."
- In the form: **BigQuery table** `acme_dw.t_04417`, **Definitions** `Active means at least one order in the trailing 7 days.` → **Ask again with this table**.
- Answer: **12 rows**, NA 4621, EMEA 3531, APAC 3074. Card **Add this to agent memory?** with `CHECKPOINT-OK`.
> "It doesn't silently remember. A policy checkpoint runs, and a human approves, for one department."
- Click **Add to agent memory (engineering department)** → **Saved to agent memory**.

### 1:05 Reuse, and no leakage
- W2 (engineer2): press **Enter** → queries `acme_dw.t_04417` **on the first try**, 12 rows.
- W3 (sales): press **Enter** → **0 rows**, no memory.
> "Engineering learned it once; every engineer gets it right first try. Sales never sees it."

### 1:25 Feature 3: self-writing guardrails
- W1 → **Mission Control** → **Self-writing guardrails**.
> "Admins approved Docs Preview MCP three times. Precedent drafted a narrow rule and replayed history first: N of M past decisions change, and everything sensitive stays protected."
- Click **Publish rule** → "**Precedent rewrote its own guardrail**."

### 1:45 Feature 4: kill switch with blast radius
- Mission Control → **Kill switch** → **1 · Report incident** → point at **Blast radius**.
- **2 · Quarantine v2.4** → **3 · Send test call** → "**Test call: BLOCKED**", receipt count unchanged.
> "One click, every agent stopped, and the connector's own counter proves nothing got through."

### 2:05 Close
> "Block what's unsafe, learn once with a human, reuse it safely, and stop everything in one click. Every decision is traced in Raindrop. That's Precedent."

---

## If asked
- **Models:** Claude Haiku 5.5 for chat, Sonnet 5.5 for plans, Opus 5.5 on retries; the model only proposes, the policy engine decides.
- **Playbooks:** agents also turn successful runs into reusable playbooks (Mission Control → Learned playbooks).
- **Observability:** every run is an event in Raindrop with each tool's verdict and rule; the Claude call and its cost are in the same trace.

## Backup lines
- Slow model: "Every step is checked by policy before it runs; planning takes a few seconds."
- A run fails: send the same prompt again. The governance result is still recorded.
- The warehouse question finds the right table first try: "This time it guessed right; the point is what happens when it doesn't." Then show W2/W3.

## After each rehearsal
`npm run demo:prepare -- --reset`
