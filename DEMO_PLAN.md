# Precedent Demo Plan: MCP Policy Enforcement and Governed Recursive Learning

## Section 1: Policy enforcement (demo)

**Goal.** Show that an agent cannot install or connect to an MCP that company policy blocks.

**Policy.** The demo uses the MCP access policy shown in the picture (Admin console → MCP & tool access, MCP set to **Blocked**). The policy applies at the agent level. Every MCP query, connect or install request an agent makes passes through Precedent's policy checks before any network contact. This holds regardless of which user, prompt or code wrapper (Claude Code or a similar wrapper) issued the request.

**Flow.**
1. The administrator sets the target MCP to **Blocked** and publishes the policy. The published version (for example v11) becomes the active policy for every agent.
2. A user asks the agent to query or install the MCP. In the demo this happens in Precedent's agent chat. A Claude Code or similar code wrapper is covered the same way once it routes its tool calls through Precedent; that integration is described, not shown live.
3. The policy check runs before any connection. Decision: **BLOCK**, rule **MCP-01**, recorded with the active policy version.
4. The agent stops immediately: no handshake, no package download, no tool discovery. Every further install attempt in the same session or any other session is blocked the same way, and each attempt is recorded.
5. Contrast: the same request to an agent without Precedent connects, because nothing checks it.

**Evidence shown on screen.** The BLOCKED decision and its reason, the policy version that made it, zero connection attempts to the MCP endpoint, and the audit record of each attempt.

## Section 2: Recursive learning with policy checks/checkpoints and human-in-the-loop

**Problem.** Enterprise data is fragmented across many BigQuery tables with little or no documentation. An agent cannot know which table holds the answer, so its first attempt can return no results.

**Flow.**
1. **First attempt fails.** The user asks a business question, for example "weekly active customers by region last quarter". The agent queries the tables it can discover and finds no matching data. It reports that no result was found. Nothing is written to agent memory.
2. **User provides the source.** The user names the correct BigQuery table, for example `acme_analytics.customer_activity_v3`. Optionally the user adds documentation or definitions, for example "active means at least one order in the trailing 7 days".
3. **Successful retrieval.** The agent queries that table with the supplied definitions and returns the result. The query itself still passes policy checks for table access.
4. **Learning proposal.** The agent asks the user whether to add this to agent memory. The proposed memory entry contains the question pattern, the table, the definitions, the successful query shape and the user's department. This is agent learning: the agent produces a candidate memory entry. Nothing is stored yet.
5. **Checkpoint before memory.** Before any memory write, Precedent runs policy checks on the candidate entry:
   - **Data classification:** is the table or any referenced column finance-restricted, or restricted in a similar way (for example PII or legal)?
   - **Scope rules:** is the requested scope permitted for that classification?
   - **Entitlement:** is the user entitled to share within the requested scope?

   If the entry violates scope rules, the checkpoint denies the memory write and records the reason. For example, an engineer who was given one-time approval to query a finance-restricted table cannot save it to engineering's agent memory. The answer the user already received is unaffected.
6. **User approval and scope.** If the checkpoint passes, the user approves the memory entry for their department. The department is self-declared once per account, and afterwards only an administrator can change it. User approval and agent learning are separate:
   - The agent cannot store a memory entry without user approval.
   - User approval cannot override a checkpoint denial.
7. **Scoped reuse.** On later queries:
   - **Same department:** the agent retrieves the approved memory entry and goes to the correct table on the first attempt.
   - **Other departments:** the entry is never retrieved, so there is no company-wide leakage.

   Agent memory is guidance, not permission. Every reused query still passes policy checks when it runs.

**Rationale: learn once, reuse safely.** The first run pays the cost of discovery: failed queries, the user's time to supply the table and definitions, and model tokens spent searching. After one approved memory entry, every later query from the same department skips discovery. That means fewer warehouse queries, fewer model tokens and faster answers. Policy checks/checkpoints and department scope make that reuse safe, so the savings do not come at the cost of data leakage.

## Expected outcome

- Any agent request to query, connect or install a blocked MCP is denied before network contact, recorded with its policy version, and repeated attempts stay blocked.
- A first query against undocumented data fails visibly, and nothing is learned from the failure.
- After the user supplies the correct BigQuery table, the agent answers and proposes an agent memory entry.
- Policy checks/checkpoints deny memory entries that would expose finance-restricted or similarly restricted data beyond their permitted scope.
- Approved memory entries are scoped to the approving user's department, reused by that department on the first attempt, and never served to other departments.
- Repeat questions cost fewer queries, tokens and minutes than the first run.
