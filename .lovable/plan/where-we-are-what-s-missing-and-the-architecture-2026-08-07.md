# Where we are, what's missing, and the architecture

## 1. Status today (verified against the live backend)

Working end to end:
- Cloud schema is live: HR data, conversation memory, observability tables, `policy_chunks` with pgvector, ops views, RLS per employee + HR Ops.
- Auto sign-in links the demo user to employee E-4471; every read runs under real row-level security.
- Policy corpus is fully embedded: 20 of 20 clauses have 1536-dim vectors.
- One assistant turn persists correctly: 1 conversation, 2 messages, 1 turn trace, 3 agent steps, with token, latency and cost (optimised vs baseline) totals.
- Three employee tabs (Home, Assistant, Requests) plus a separate `/ops` console reading the four ops views.
- Tap-first CRUD in Requests goes through the same tool layer as the assistant, so eligibility rules can't diverge.

Two confirmed defects:
- **Audit gap:** `retrieval_logs` is empty (0 rows) even though a policy turn ran. The insert omits `threshold`, which the table requires and has no default, so the row is rejected — and the result of that insert is never error-checked, so it fails silently. `tool_calls` writes have the same no-error-check pattern.
- **Wrong verdict on a grounded question:** "Can I carry forward my leave?" recorded `UNKNOWN` instead of citing §1.4. Retrieval and Agent 2 both ran, so the likely cause is the calibration band (`COSINE_FLOOR 0.24` / `COSINE_CEILING 0.52`) mapping real cosine scores below the 0.75 gate. This is not yet measured — the fix starts by logging real raw scores for the demo questions, not by moving the constants blind.

## 2. What's missing before production

**Blocking correctness**
1. Fix the `retrieval_logs` insert and add error checks to every audit write, so grounding and coverage-gap reporting is trustworthy.
2. Calibrate the similarity gate against the real corpus: measure raw cosine for each demo question, set the threshold from data, keep both raw and calibrated numbers in the trace.
3. Re-run the five demo flows after the fix (probe, PARTIAL, cited carry-forward, sabbatical abstention, insufficient balance) and confirm each writes a complete trace.

**Blocking multi-user**
4. Real sign-in. Today the first authenticated user claims the first unlinked employee row — fine for a demo, unsafe with more than one person. Needs a proper auth screen and employee provisioning (invite or HR-managed mapping).
5. HR Ops gating is currently on the demo employee's `is_hr_ops = true` flag. Move role to a dedicated `user_roles` table with a security-definer check, so ops access can't ride on an employee record.
6. Approvals: requests are created but nothing approves them. Manager view + status transitions, or an explicit "approvals live in Darwinbox" boundary.

**Blocking operability**
7. Corpus seeding runs lazily on the first agent turn per server process. Move it to an explicit, admin-triggered seed/re-index path with a policy version switch, so a new policy release is a deliberate action.
8. Cost and rate-limit guardrails: per-employee turn budget, gateway retry/backoff, and a graceful message when the gateway is down (the keyword fallback exists but is never surfaced to the user).
9. Failure handling for partial turn writes: if an audit insert fails, the user still gets an answer, but ops silently loses the turn. Needs a retry or a dead-letter row.
10. Product surface gaps: no conversation history list (only "last active" restore), no HR ticket inbox even though `hr_tickets` is written on abstention, no attendance regularization limits enforced server-side.

**Nice before launch, not blocking**
- Prompt-level regression suite (fixed questions → expected verdict and clause), so prompt edits can't silently break grounding.
- Accessibility and empty/error-state pass on the three tabs.

## 3. Architecture flow

```text
CLIENT (mobile shell, 430px)
  Home /            Assistant /assistant       Requests /requests      HR Ops /ops
      \                    |                          |                     |
       \-------- store.tsx: auto sign-in, server sync -/                     |
                           |                          |                     |
SERVER ROUTES              v                          v                     v
  POST /api/session   POST /api/agent          POST /api/hr-action     GET /api/ops
   link auth user      one full turn            same tool layer         ops views only
   + initial state                                                      (HR Ops gate)

TURN PIPELINE (inside /api/agent -> agents.server.ts)
  1 read conversation + session_slots + HR state
  2 insert user message
  3 open turn_trace
  4 Agent 1 CLASSIFY            (gpt-5.6-sol)      -> intent, subjects, slots
  5 in parallel:
       retrieval: embed query -> match_policy_chunks (pgvector)
                  -> gate: similarity threshold + entity conflict
                  -> Agent 2 POLICY  (gpt-5.6-luna) -> verbatim clause or NOT_IN_POLICY
       Agent 3 TOOLS            (gpt-5.6-luna)      -> one tool + params
                  -> tools.ts (11 tools, LOW/MEDIUM/HIGH risk, confirmation gate)
  6 Agent 1 JUDGE + COMPOSE     (gpt-5.6-sol)      -> verdict FULL/PARTIAL/NONE/UNKNOWN,
                                                      reply, chips, citations, pending action
  7 write session_slots, assistant message, audit fan-out, conversation totals

DATA (Lovable Cloud: Postgres + pgvector)
  HR            employees, leave_balances, leave_requests,
                attendance_records, attendance_regularizations, wfh_requests
  Memory        conversations, messages, session_slots
  Observability turn_traces, agent_steps, retrieval_logs, tool_calls, hr_tickets
  Policy        policy_chunks (20 clauses, 1536-dim, FY26-v2)
  Ops views     ops_conversations, ops_coverage_gaps, ops_grounding, ops_cost_summary

EXTERNAL
  Lovable AI Gateway: chat completions + text-embedding-3-large (1536 dims)
  Never reached from the browser; API key stays server-side.

GROUNDING RULE
  Every number in a reply must come from Agent 2 (a clause) or Agent 3 (a tool result)
  in the same turn. No evidence above threshold -> UNKNOWN + [Ask HR] -> hr_tickets row.
```

## 4. Suggested next build step

Smallest change with the biggest payoff: fix the audit writes and calibrate the gate (items 1–3). That makes the trace honest, brings the carry-forward citation back, and gives real numbers for everything else on the list. Say the word and I'll take that on in build mode.
