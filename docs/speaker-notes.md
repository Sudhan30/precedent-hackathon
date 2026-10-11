# Precedent: speaker notes

## Elevator pitch (about 20 seconds, say before or over the opening)

> "Company AI agents fail in two ways: they do things they shouldn't, and they forget what people taught them. **Precedent** is the harness that fixes both. Every action an agent proposes passes a policy gate. What it learns is checked, approved by a human, and stored in **MongoDB Atlas**, so the next agent gets it right the first time. **Voyage AI** finds the right memory for every request, and **Raindrop** traces every decision and double-checks every rule Precedent writes for itself."

## Voice-over for the 1:37 video

Left pane: the same agent **without** Precedent. Right pane: **with** Precedent. Times match `precedent-scenarios-v3-cut.mp4`.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:11 | Both agents asked to install a web-search MCP | "Same prompt, two agents. Asked to install a web-search MCP, the agent on the left just connects. On the right, Claude flags it as web search and policy blocks it, before any network contact." |
| 0:11–0:23 | DeepWiki install command; "already waiting for InfoSec" | "Other MCPs become governed requests. Two colleagues already asked for DeepWiki, so this request raises its priority. Demand is counted in MongoDB, one per person." |
| 0:23–0:32 | Admin console: High priority, Raindrop evidence, approve | "InfoSec sees the demand, plus Raindrop evidence and a recommendation, and approves it once, company-wide." |
| 0:32–0:36 | Retry: right side allowed and connected | "Now it just works, through policy." |
| 0:36–0:57 | Warehouse: 0 rows, hint, 12 rows, checkpoint, saved | "Real warehouses are undocumented. Both agents guess the wrong table. The user points them to the right one. Only Precedent learns: a policy checkpoint runs, a human approves, and the pointer is saved to MongoDB Atlas for engineering. Never the rows." |
| 0:57–1:08 | Next engineer, same question | "Next engineer, same question. The left agent is lost again. The right one reads that memory from MongoDB, ranked by Voyage, and gets it on the first try." |
| 1:08–1:15 | Self-writing guardrail, verified in Raindrop | "Precedent also writes its own guardrails, and Raindrop verifies the runs behind them before they ship." |
| 1:15–1:35 | Quarantine; test call blocked; side by side | "And when a connector is compromised: one click quarantines it. Governed agents are blocked, and the connector's own counter proves nothing got through. The agent without Precedent keeps sending it data." |
| 1:35–end | Closing caption | "Block what's unsafe, learn once in MongoDB, reuse safely, stop in one click. That's Precedent." |

## Sponsor call-outs (if you have 10 more seconds)

- **MongoDB Atlas:** "the system of record and the memory: transactions for every decision, Change Streams for live policy, Vector Search for playbooks. The learning loop runs through Atlas."
- **Voyage AI:** "embeddings and reranking pick the right lesson for each request."
- **Raindrop:** "every run is traced, and Raindrop is an independent second opinion that can hold a rule change."

## If asked

- **Is the model making the decisions?** "No. Claude only proposes steps; a deterministic policy engine decides, and decisions are committed to MongoDB before any tool is contacted."
- **What exactly is stored?** "Only a pointer, the table name and definition, scoped to one department. Never the rows. The data is synthetic."
- **Why Raindrop?** "Independent evidence. It can hold a self-written rule or flag an MCP request, but it can never approve anything on its own."
- **Are the numbers real?** "Yes. Every count is read from recorded decisions and receipts in MongoDB; the setup approvals are seeded by our Reset demo script."
