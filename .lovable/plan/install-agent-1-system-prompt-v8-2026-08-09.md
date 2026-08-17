# Install Agent 1 system prompt v8

Replace the interim A1 prompt with the v8 text verbatim and make the runtime honour its contract. The v8 text differs from the current wiring in five ways that need code changes, not prompt edits.

## What changes

### 1. Prompt file
`src/lib/engine/prompts/a1.ts` — `A1_SYSTEM` becomes the v8 text, stored word for word (sections 1–11). No rewriting, no summarising.

`buildA1Instructions` keeps appending runtime context, but only facts v8 does not own: today's date + weekday, working week, employment type/tenure, the write-action argument catalogue (tool names and ISO/HH:MM formats). Persona, tone rules, and escalation copy come from the prompt itself.

### 2. Placeholder handling (§1.4)
v8 requires A1 to emit `{{employee_name}}`, `{{hr_support_channel}}`, `{{manager_name}}`, `{{today}}`, `{{tone_profile}}` literally. So:
- Do not put those values into the prompt as resolved strings.
- After A1 replies, substitute the tokens in `reply` and in each chip before persisting/rendering, in `orchestrator.server.ts`. `{{tone_profile}}` resolves to empty (it must never print).
- Trace keeps the unsubstituted reply so the audit shows exactly what the model produced.

### 3. Output contract (§10)
A1's structured schema gains two required fields: `intent` (the §6.2 enum: policy_qa, eligibility_check, leave_apply, leave_read, leave_update, leave_cancel, wfh_apply, wfh_read, attendance_regularize, attendance_read, payslip_read, mixed, vague_hr, unmatched) and `offramp` (`9.1 | 9.2 | 9.3 | null`).
- Chips cap moves from 3 to 4.
- `pending_action` still accepted only on verdict FULL; the existing reject-and-log path stays.
- `intent` and `offramp` are written to the turn trace and to the message row so `/ops` and the trace drawer can show classification and escalation reason.

### 4. Tool ordering inversion (§7.0.1) — behavioural
Current A1 text says "policy before data". v8 says the opposite for CREATE/UPDATE: read HRMS state first, then policy, never in parallel; and for `eligibility_check`, policy only with no HRMS read. Since the orchestrator obeys whatever A1 asks for step by step, no loop rewrite is needed — but the interim ordering rule must be gone (it is, once the prompt is replaced), and the step budget must allow the sequence HRMS → policy → reply. Confirm the max-4-step budget covers that; raise it to 5 if a read-back turn ever gets truncated.

### 5. Naming
v8 speaks of `check_policy` and `query_hrms`. Keep the existing action names `ask_policy` / `ask_hrms` in the schema and add a short mapping line in the runtime-context block ("check_policy is action ask_policy; query_hrms is action ask_hrms"), so the verbatim prompt stays untouched and the model still emits valid JSON.

## Unchanged
A2 and A3 prompts, retrieval (tag fetch + `text-embedding-3-small`), HRMS mock, confirmation gate, cost/pricing, database schema, `/ops`, and the mobile assistant.

## Verification
Server-side smoke tests over `api/engine/turn`:
- Policy question → verbatim clause + citation, `intent=policy_qa`, `pending_action=null`.
- "Can I take 3 days CL next month?" → probe for dates (period, not a date), no proposed date.
- "Apply CL 12–13 Aug" → HRMS read before policy in the trace, read-back with absolute dates + weekday + working days, chips exactly Confirm/Change/Cancel.
- "ok" after a read-back → re-ask once, no write.
- "yes but 3 days" → treated as correction, fresh feasibility, read-back opens with "Updated —".
- Out-of-policy question → §9.1 copy, `offramp=9.1`, escalation chip present.
- Placeholders render as real names, and `{{tone_profile}}` never appears.
