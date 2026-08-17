# Multi-Agent HR Workflow Engine

A new standalone desktop screen at `/engine`: chat + quick-reply chips on the left, a live trace drawer with a cost-comparison card on the right. A code-only orchestrator coordinates three LLM agents (A1 customer-facing, A2 policy/RAG, A3 HRMS execution) over a mock HR system, with per-step observability.

Built onto what already exists in this project. The current mobile assistant, Requests screen and `/ops` console stay exactly as they are.

## What gets reused vs built new

Reused: the AI gateway client, the policy manual corpus, the semantic-retrieval plumbing, the existing HR tables (`employees`, `leave_requests`, `wfh_requests`, `attendance_records`, `attendance_regularizations`, `leave_balances`) as the mock HRMS backing store, and the existing agent prompt files as a reference for where the new prompts land.

New: `sessions` + `messages` + `trace_events` (the spec's turn/observability model, separate from today's `conversations`/`turn_traces`), a 1536-dim `policy_chunks_small` corpus, the mock-HRMS layer with idempotency keys and the exact error-code map, the pure-code orchestrator with mode-filtered tool exposure, baseline mode, and the `/engine` UI.

## Build order

**1. Schema + seed.** One migration adds `sessions` (with `pending_action`, `baseline_mode`), `messages`, `trace_events`, `policy_chunks_small` (`vector(1536)`, `object_tags text[]`, ivfflat cosine index), `payslips`, and idempotency-key columns where the spec requires them. Employees EMP001 (Priya Sharma, DOJ 2025-11-15, full_time, female, L3, Noida) and EMP002 (DOJ 30 days ago) plus balances CL 8 / SL 10 / EL 12.5, one approved next-month leave for the OVERLAP demo, one missed-clock-out attendance day, 6 WFH days and 2 regularizations used this month, and 3 payslips are seeded as literal rows in the migration.

**2. Policy chunking + embeddings.** The HR manual is split one chunk per numbered clause (`chunk_id` = clause number, so citations are auditable against the source), the 1.1 leave table split per leave type plus the contract-employee note, ~35 chunks, each tagged `{leave, CL...}` / `{attendance}` / `{wfh}` / `{general}`. A seed endpoint embeds them once with `text-embedding-3-small` (1536 dims).

**3. Mock HRMS.** Deterministic read and write functions over the tables. Every write takes `idempotency_key = sha256(session_id + payload)`; a unique-violation returns the existing receipt with `duplicate: true`. Writes validate data only, never policy, and return exactly `NOT_FOUND`, `INVALID_DATE_RANGE`, `INSUFFICIENT_BALANCE`, `CAP_EXCEEDED`, `OVERLAP`, `ALREADY_APPROVED`, `PAST_DATED`. Any call whose params include `start_date = '2026-12-31'` fails once with a 500 and succeeds on retry, so the transient-retry path is demoable live.

**4. Orchestrator.** The turn loop, chip handling, tool dispatch (max 4 per turn then A1's off-ramp), both retrieval paths, `pending_action` custody, and tracing — all code, zero LLM calls of its own. Boundaries enforced in code, not by prompt: A1 sees only the transcript plus tool messages; A2 and A3 get scoped payloads and never the transcript; A3's tools are mode-filtered (read mode exposes reads only, execute mode exposes exactly one write); Confirm calls A3 directly with the stored `pending_action` and A1 is not re-invoked; `pending_action` is accepted only when A1's verdict is `FULL`; an A2 output with a non-null verdict and empty `chunk_ids` is rejected and re-traced as `status: invalid`.

Two retrieval paths as specced: `policy_qa` embeds the question and does a top-6 vector search; `rule_check` makes zero embedding calls and does a deterministic tag fetch over `object_tags ∩ {args.object, args.leave_type, 'general'}`.

**5. Prompts.** A1/A2/A3 system prompts stored verbatim from your three uploaded files, with runtime context tokens injected by the orchestrator (`{{today}}` with weekday, employee name, `HR Helpdesk`, manager name, `warm, concise` tone, holiday list and working-day calendar). This step waits for the files — everything above and below is unblocked.

**6. Tracing, cost, baseline mode.** One `trace_events` row per step with actor, action, model, tokens from the API response, latency, status, payload and result. Cost is computed from a config price map at the real per-1M rates of the models actually used, so the trace reports true spend. Baseline mode runs the whole turn as one call to the big model with the entire policy document inline and all HRMS data pre-fetched, logged through the same table, so the comparison card's agentic-vs-baseline % saving is measured, not modelled.

**7. UI.** Single desktop page at `/engine`, outside the 430px mobile shell. Chat with user/assistant bubbles, chips as tappable buttons with `[Confirm] [Change] [Cancel]` styled distinctly as the commit gate, a receipt chip carrying `request_id` under A3 execute bubbles, a collapsible right-hand trace drawer with the per-turn step timeline and running session total, and the cost-comparison card with the −20% target line and a tooltip naming the three structural savings. Top bar: EMP001/EMP002 switcher, baseline toggle, session reset.

**8. Smoke tests.** Run all eight in a browser: maternity policy Q&A cited; CL balance read; "4 days CL next week" returning PARTIAL with alternatives and no balance read; the full apply chain through Confirm to a receipt; the repeat producing OVERLAP; the 2026-12-31 retry; the "hi" → "leave" probe path; and baseline on/off cost comparison.

## Technical notes

Two platform substitutions, both agreed:

- Server logic runs as TanStack server routes (`/api/engine/*`) rather than new Supabase Edge Functions — this stack cannot add Edge Functions. Same code, same boundaries, same tracing.
- Models run on the built-in AI gateway with its managed key; there is no `OPENAI_API_KEY`. A1 uses the flagship reasoning model (`openai/gpt-5.6-sol`); A2 and A3 use the fast low-cost model (`openai/gpt-5.6-luna`), preserving the "big model orchestrates, cheap models do the scoped work" cost structure. Embeddings are `text-embedding-3-small` at 1536 dims, exactly as specced. The price map lists the real rates for these models, so trace cost is actual spend.

The new tables are additive; nothing in the existing schema is dropped or altered in a way today's screens depend on. New tables get GRANTs and row-level policies scoped to the calling employee in the same migration.
