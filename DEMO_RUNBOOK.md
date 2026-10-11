# Precedent demo runbook: MCP policy enforcement and governed recursive learning

Executable, step-by-step guide for testing both use cases in `DEMO_PLAN.md` end to end. Follow the steps in order and run the check after each one.

## 1. Build status

| Capability | Status |
|---|---|
| MCP connect/install requests blocked by policy before network contact (in-app agent) | Built and tested |
| Claude Code or other external wrapper routed through Precedent | Not built. An integration path, not shown live |
| Synthetic BigQuery-style warehouse (`warehouse.query`, catalogued tables) | Built and tested |
| User table hint → answer → memory proposal → checkpoint → user approval | Built and tested |
| Department-scoped agent memory: same department reuses, other departments never see it | Built and tested |
| Finance-restricted table: one-time approval to query, checkpoint denies memory outside finance | Built and tested |
| Department: self-declared once per account, admin-only change afterwards | Built and tested |

All warehouse data is synthetic and labelled synthetic. No real BigQuery connection exists.

## 2. Planes and routing

| Plane | Where in the UI | Behavior |
|---|---|---|
| **Plane A: without MCP governance or persistence** | **Without Precedent** chat (left) | No policy checks, no company context, no agent memory. Every run starts cold. |
| **Plane B: with persistence** | **With Precedent** chat (right) | Policy checks on every call, policy checks/checkpoints before memory writes, department-scoped agent memory. |

**Routing rule:** type into the left chat for Plane A and the right chat for Plane B. For warehouse questions, set **Tools & data → Data warehouse (BigQuery-style)** on that chat, or click the **Query the data warehouse** shortcut. Each message is a fresh run with no shared conversation.

**Catalog** (synthetic):

| Table | What it is | Classification |
|---|---|---|
| `acme_dw.customers` | Legacy snapshot; returns 0 rows for last quarter | internal |
| `acme_dw.weekly_active_customers` | Deprecated frozen copy; the obvious name, 0 rows (the classic trap) | internal |
| `acme_dw.t_04417` | Weekly active customers by region (the right answer; opaque name, no description shown to agents) | internal |
| `acme_dw.evt_raw_2026` | Raw events; 0 rows for this question | internal |
| `finance.restricted_revenue_by_customer` | Revenue by customer | finance-restricted |

## 3. Prerequisites checklist

**Services**
- [ ] Services active on the host: `systemctl --user is-active precedent-api precedent-worker precedent-tunnel` prints `active` three times.
- [ ] Public app reachable: `curl -s -o /dev/null -w '%{http_code}\n' https://precedent.vikhas.com/login` prints `200`.
- [ ] Anonymous API rejected: `curl -s -o /dev/null -w '%{http_code}\n' https://precedent.vikhas.com/api/state` prints `401`.

**Accounts** (created, departments assigned by an admin; sign in with the username, one browser profile or private window per user)

| Username | Role | Department | Used in |
|---|---|---|---|
| `manager` | admin | engineering | User 1: Scenarios 0, 1, 2, 2b; approvals; Mission Control |
| `engineer1` | employee | engineering | Alternative User 1 for an employee-only run |
| `engineer2` | employee | engineering | User 2: Scenario 3a (same department) |
| `sales` | employee | sales | User 3: Scenario 3b (other department) |
| `finance` | employee | finance | Optional: finance queries its own table without approval |

All five use the shared demo password (given to presenters privately). The original `admin` account keeps its separate strong password. Because departments are already assigned, no department picker appears for these accounts.

**Credential rules**
- Secrets live only in the git-ignored `.env.local` and `.data/` files on the host. Never in chat, screenshots, git or the runbook.
- The admin password is in `.data/local-login.env`. Share it with the presenter privately.
- Each tester signs in as their own account. A department is chosen once and only an administrator can change it, so choose carefully.

**Expected access:** all three users can use both chats. Only User 1 (admin) sees the Admin console and Mission Control and can approve held actions.

## 4. Setup (before the session)

| # | Action | Check / done when |
|---|---|---|
| 1 | On the host: `npm run demo:prepare -- --reset` | Prints a fresh demo namespace and three ✓ readiness lines. Policy and audit history are retained. |
| 2 | User 1 opens `/admin` → **MCP & tool access** | Tenable documentation MCP shows **Blocked**. This is the policy shown in the picture. |
| 3 | Each user signs in with their username | The header shows their department chip, e.g. "Engineering". New self-registered accounts instead see a one-time **Your department** picker. |
| 4 | User 1 opens **Mission Control → Agent memory** | "Nothing learned yet." No approved entries. |

## 5. Scenarios

### Scenario 0: Policy enforcement (MCP install blocked)

| Step | Action | Expected output | Done when |
|---|---|---|---|
| 0.1 | In **With Precedent**, send `Connect Tenable MCP to read its developer documentation.` | MCP card: **BLOCK**, "Company policy blocks Tenable MCP connections", policy version, status **BLOCKED**, "No connection attempted." | No discovered tools listed |
| 0.2 | Send `Install the Tenable MCP` | Same BLOCK decision; each attempt recorded | Second attempt also BLOCKED |
| 0.3 | Optional contrast: send 0.1 in **Without Precedent** | Real handshake; **CONNECTED** with discovered tools | Shows what governance prevented |

**Evidence:** Admin console → Recent activity lists each blocked attempt; Advanced → MCP connection audit shows the decisions with the policy version.

### Scenario 1: Plane A, a user queries a table without Precedent

| Step | Action | Expected output | Done when |
|---|---|---|---|
| 1.1 | User 1, **Without Precedent**, scope Data warehouse, send `Weekly active customers by region last quarter` | Tool message `warehouse.query` on a guessed table, e.g. `acme_dw.customers`; result `0 rows…` | **No results found** form appears |
| 1.2 | In the form, enter table `acme_dw.t_04417`, definitions `Active means at least one order in the trailing 7 days.` → **Ask again with this table** | `warehouse.query` on `acme_dw.t_04417`; result `12 rows … NA 4621, EMEA 3531, APAC 3074 weekly active customers` | Answer shown; **no memory proposal** (Plane A never learns) |
| 1.3 | Send the same question again | Guesses again, `0 rows` again | Proves no persistence on Plane A |

### Scenario 2: Plane B, learning with checkpoints and user approval

| Step | Action | Expected output | Done when |
|---|---|---|---|
| 2.1 | User 1, **With Precedent**, scope Data warehouse, send `Weekly active customers by region last quarter` | `warehouse.query` on a guessed table; `0 rows…`. Inspect context shows "Agent memory · engineering: No approved agent memory…" | **No results found** form appears; nothing proposed |
| 2.2 | Enter `acme_dw.t_04417` and the definitions → **Ask again with this table** | `12 rows…` answer. Card **Add this to agent memory?** with `CHECKPOINT-OK · Classification internal; scope limited to the engineering department.` | Proposal shown; nothing stored yet (agent learning ≠ storage) |
| 2.3 | Click **Add to agent memory (engineering department)** | Card changes to **Saved to agent memory**, "Shared only with the engineering department." | Mission Control → Agent memory lists `acme_dw.t_04417` with an ENGINEERING badge |

**Events** (Admin console → Advanced governance → event stream): `context.retrieved`, `plan.created`, `decision.recorded` (INTERNAL-02), `execution.completed`, `memory.candidate.proposed`, `knowledge.saved`.

### Scenario 2b: Finance-restricted data is denied at the checkpoint

| Step | Action | Expected output | Done when |
|---|---|---|---|
| 2b.1 | User 1, **With Precedent**, Data warehouse: ask a question; in the No-results form enter table `finance.restricted_revenue_by_customer` | `warehouse.query` **PENDING**, rule **DATA-31** "Finance-restricted tables need the finance department or a one-time approval" | Held for approval |
| 2b.2 | Admin console → Approval requests → approve 30 seconds; back in the chat → **Resume after approval** | Query **SUCCEEDED** (one-time approved access) | Answer shown |
| 2b.3 | Read the memory card | **Checkpoint: not saved to agent memory**, `CHECKPOINT-FIN-01 · This table is finance-restricted…`; no approve button | Mission Control → Agent memory shows it under **Blocked at the checkpoint**; event `memory.checkpoint.denied` |

### Scenario 3a (edge case): a second user in the same department

User 2 is a different account in a fresh session, with no access to User 1's conversation and no training of their own.

| Step | Action | Expected output | Done when |
|---|---|---|---|
| 3a.1 | User 2 (engineering), **With Precedent**, Data warehouse, send the same question | Inspect context: "Agent memory · engineering" lists `acme_dw.t_04417`. Tool message `warehouse.query` on **`acme_dw.t_04417`** on the first try; `12 rows…` | No No-results form, no new proposal (no re-learning) |
| 3a.2 | User 1 → Mission Control → Agent memory | "A colleague in engineering got the answer with 1 query and no help; learning it took 2 queries, 1 empty result and 1 user correction." | Measured comparison shown |

### Scenario 3b (edge case): a user in another department

| Step | Action | Expected output | Done when |
|---|---|---|---|
| 3b.1 | User 3 (sales), **With Precedent**, Data warehouse, same question | Inspect context: "Agent memory · sales: No approved agent memory…"; guessed table, `0 rows…` | No-results form appears: engineering memory did not leak |
| 3b.2 | User 3 checks for the entry anywhere in their UI | No engineering entry is visible (state is filtered by department) | Confirms no company-wide leakage |

## 6. Live demo script (about 3 minutes; 2-minute cut marked ★)

1. ★ **(0:00) Policy.** Admin console, Tenable MCP **Blocked** (the picture). In With Precedent, send "Connect Tenable MCP…": **BLOCKED**, no connection.
2. ★ **(0:25) Fragmented data.** With Precedent, Data warehouse, "Weekly active customers by region last quarter" returns **0 rows**.
3. ★ **(0:45) Human-in-the-loop.** Point it to `acme_dw.t_04417` with the definition, and it answers. "Add this to agent memory?" shows CHECKPOINT-OK.
4. ★ **(1:05) User approval.** Click **Add to agent memory (engineering)**: saved, engineering only.
5. **(1:20) Checkpoint denial.** A finance table answered with one-time approval is denied at the checkpoint (prepared beforehand to save time).
6. ★ **(1:40) Reuse.** Switch to the User 2 window (engineering) and ask the same question: correct table first try, 12 rows.
7. ★ **(2:00) No leakage.** User 3 window (sales): 0 rows, no memory.
8. **(2:20) Proof.** Mission Control → Agent memory: learning took 2 queries, 1 empty result and 1 correction; reuse took 1 query and no help.

Close: "Learn once with a human, check it against policy, reuse it safely within the department."

## 7. Troubleshooting

| Symptom | Likely cause | Try first |
|---|---|---|
| Run shows **FAILED during planning** | Intermittent model-provider error or rate limit | Send the same message again; check `journalctl --user -u precedent-api --since "5 min ago"` |
| "Live planning is unavailable" | Worker down | `systemctl --user restart precedent-worker`, then wait ~10 s |
| No department picker and no chip | `/api/me` failed or the session expired | Reload; sign out and back in |
| Department picker says it is already set | Department is chosen once | An admin can change it: `POST /api/admin/members/<userId>/department` |
| No **No results found** form | The model picked the right table first, or the run is not finished | Check the tool message table; ask a fresh question |
| Memory card missing after the hinted run | Plane A (no learning), or an entry for this table already exists for the department | Use **With Precedent**; check Mission Control → Agent memory |
| Approve returns "already approved/denied" | A proposal is decided once | Ask again to create a new proposal |
| "Policy changed; refresh" (409) | Someone published a policy mid-flow | Reload and repeat the step |
| Context shows "matched by keyword" | Voyage unavailable or rate-limited (429) | Expected fallback; the demo still works |
| Sign-in fails | Autofilled old password or extra space | Type username `admin` and the password manually |

## 8. Reset and re-run

`npm run demo:prepare -- --reset` starts a fresh demo namespace: new sessions, empty agent memory, policy reset to demo defaults. Audit history and immutable policy versions are retained. Departments are kept, since they belong to accounts.
