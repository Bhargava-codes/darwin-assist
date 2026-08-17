# Install Agent 2 System Prompt (v1)

Replace the interim policy-agent prompt with the supplied v1 prompt verbatim, and upgrade the input/output contract around it so every field the prompt promises actually flows.

## What changes for the user

- The policy agent now answers in two clearly separated modes: quoting policy (`policy_qa`) and passing a verdict on a concrete request (`rule_check`).
- Verdicts gain two new outcomes: **BLOCKED** (a needed fact is missing, so it is collected upstream instead of guessed) and **ESCALATE** (policy routes the matter to HR, so the assistant hands over instead of judging).
- The employee now hears the decisive clause word for word when a request fails, and sees a complete fix list instead of only the first problem.
- When the assistant lists which leave types are allowed, every option is one policy actually names — no constructed suggestions.

## Technical plan

### 1. `src/lib/engine/prompts/a2.ts`
- Replace `A2_SYSTEM` with the v1 text verbatim (sections 1–11, no edits).
- Rewrite `A2Request` to the §6.2 variables: `mode`, `question?`, `args?` (`object, operation, start_date, end_date, working_days, leave_type?, entry_type?, reason?`), `employee_context` (`doj, employment_type, gender, grade, location`), `account_state?`, `chunks`.
- `buildA2Input` emits labelled blocks and **omits absent variables entirely** (absence is meaningful per §1.4) — never emits `(none)` for `account_state`.

### 2. `src/lib/engine/orchestrator.server.ts`
- `A2_SCHEMA` → the §10 object, strict-compatible (all properties in `required`, `additionalProperties: false`, optional values nullable): `mode`, `verdict` (enum + `BLOCKED`, `ESCALATE`, null), `policy_text`, `clause`, `failing_clause`, `eligible_types`, `shortfall {requested, available, dimension}`, `alternatives`, `violated`, `missing`, `account_state_checked`, `not_in_policy`, `chunk_ids`.
- Extend `VERDICT_ENUM` for A2 with `BLOCKED` and `ESCALATE` (A1's verdict enum stays as-is).
- Extend A1's `policy_request` schema so it can pass `args` for `rule_check` (structured JSON string, as `pending_action.args_json` already does) alongside the existing `question`/`object`/`leave_type`; keep `facts` for `policy_qa`.
- Build `employee_context` and `account_state` in code from the mock HRMS (employee record + the balance/usage read already fetched this turn) rather than from A1 — A2 must never receive an agent-authored fact. `account_state` is passed only for CREATE/UPDATE rule checks.
- Validation: keep citation gating (`chunk_ids` must intersect retrieved chunks) but allow empty `chunk_ids` only when `not_in_policy: true`; treat a verdict with no evidence as UNKNOWN as today.
- Findings text for A1 gains the new fields: verbatim `failing_clause`, full `violated` list, `shortfall`, `eligible_types`, `missing` (BLOCKED → A1 probes for those fields), `ESCALATE` → A1 off-ramp, and `account_state_checked` so A1 qualifies balance claims honestly.
- Trace payload records `mode`, `verdict`, `violated`, `not_in_policy`, `account_state_checked` for the ops/trace views.

### 3. Verification
Run smoke tests through `/engine`: a policy quote question (verbatim excerpt + clause), a valid leave request (FULL), an over-cap request (PARTIAL with shortfall + alternatives), a tenure-gated request (NONE with failing clause), an unsupported topic (NOT_IN_POLICY → UNKNOWN), and a helpdesk-routed matter (ESCALATE).
