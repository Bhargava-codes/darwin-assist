# The 15s is not RAG — it's the policy agent's own generation

## What the trace actually shows

From your turn, and confirmed against `trace_events` for the last two hours:

| Step | Latency | Tokens in / out |
| --- | --- | --- |
| RAG `rule_check` (retrieval itself) | **0.20s** | — |
| A2 `policy_lookup` (the LLM verdict) | **15.2s avg, 15.7s max** | 4,917 / **1,270** |
| A1 reply | 5.2s | 6,462 / 320 |
| A1 ask_policy / ask_hrms | 3.5s / 3.2s | ~6,300 / ~170 |
| A3 `select_read_tool` + `report` | 2.3s + 2.5s | ~3,000 / ~110 |

The row labelled RAG is the retrieval — tag fetch from the policy table, no embedding call — and it takes 200ms. Nothing to optimise there. The 15s sits in the next row: A2, the policy agent that reads the retrieved clauses and returns a verdict.

## Why A2 takes 15s

Two causes, both measurable:

1. **Output length dominates.** A2 emitted **1,270 output tokens** on these turns (it averaged 516 earlier). Generation is serial — every token costs wall-clock time — so output size, not input size, sets latency. The likely driver is `rule_check` verbatim-quoting from up to **12 chunks** returned by the tag fetch into `policy_text` / `failing_clause`, plus a 14-field verdict object.
2. **Reasoning still runs.** `effort: "low"` is set, but "low" is not "off"; on a 4.9k-token instruction set with a strict 14-field schema the model still spends a reasoning budget before its first visible token.

Also visible: A3's `report` call (2.5s) still fired on this leave-balance turn, so the code-formatted read path fell back to the LLM instead of skipping it.

## Fixes, in order of seconds-per-hour-of-work

### 1. Cut what A2 has to write (target: 15s → 4-5s)

- Cap `tagFetch` at **6 chunks** instead of 12, ranked by tag specificity. Twelve clauses is more than any single verdict needs and each extra one lengthens both prefill and the quoted excerpt.
- Constrain the quoted fields: `maxLength` on `policy_text` and `failing_clause` in the schema, and an explicit single-clause instruction in the A2 input builder (not the verbatim system prompt, which stays untouched).
- Make the array fields empty-by-default for `policy_qa`, where `shortfall`, `violated`, `eligible_types` and `alternatives` are never needed.

### 2. Try `effort: "minimal"`/none on A2 and measure (target: another 1-3s)

A2 does gated, schema-shaped reading, not open-ended judgment. Run the same fixed turn set at low vs. the lowest effort the model accepts and diff `verdict`, `violated`, `not_in_policy` and `chunk_ids`. Keep the change only if the diff is empty.

### 3. Stream A2's verdict so the turn overlaps (0s of A2, but ~3s off the turn)

A2 is already a streaming gateway call consumed server-side. Parse the verdict incrementally and let A1's compose start as soon as `verdict` + `chunk_ids` land, instead of waiting for the whole 14-field object.

### 4. Repair the A3 read short-circuit (2.5s on every read turn)

`get_leave_balance` went through the LLM `report` step. Find why `localReadReport` didn't claim this intent and cover it, so reads format in code as designed.

## Impact on response quality

Grounding stays intact: every fact still traces to a retrieved chunk in the same turn, the 0.32 similarity floor is unchanged, and the confirmation gate is untouched. The four fixes change *how much* the model writes or *when* the orchestrator proceeds, not what evidence is allowed.

| Fix | Quality risk | Mitigation |
| --- | --- | --- |
| Cap tagFetch at 6 chunks | Low. Could drop a relevant clause that only appears at rank 7-12. | Keep the highest-specificity matches first; fall back to 12 only when the first 6 produce `NOT_IN_POLICY` or low-confidence verdict. |
| `maxLength` on `policy_text` / `failing_clause` | Low. A long clause might be truncated mid-sentence. | Set a generous limit (≈500 chars) and instruct "one sentence, whole clause"; verify the off-domain and gender-scoped turns still cite fully. |
| Empty default arrays for `policy_qa` | None. Those fields are not consumed in `policy_qa` mode. | Confirmed by the orchestrator's A2 consumer — only `policy_text`, `clause`, `chunk_ids`, and `not_in_policy` are read for open questions. |
| Lower A2 reasoning effort | Real. A2 still makes the hardest judgment (tenure, notice, gender, balance → verdict). | Diff verdicts on a fixed set of 10 turns before/after; revert if `verdict`, `violated`, `not_in_policy`, or `chunk_ids` drift. |
| Stream A2's verdict | None. The orchestrator waits for `verdict` + `chunk_ids` before composing, so later fields cannot change the answer. | Gate compose on the same fields as today. |
| Repair A3 read short-circuit | None. Code-formatted facts are strictly safer than an LLM paraphrase. | Add a test turn for each read tool and assert no `A3 report` row appears. |

Net: the only change that can alter answers is lowering A2's reasoning effort, and that is measured and reverted if it drifts. The rest reduce token volume without changing the evidence A2 sees or the fields A1 consumes.

## Verification

Re-run the same three turns ("Can I take leave tomorrow", a balance question, and an off-domain question) after each step and read the new `trace_events` rows: A2 latency, A2 output tokens, and the verdict diff. Report before/after numbers rather than assert an improvement.

## Files touched

- `src/lib/engine/retrieval.server.ts` — chunk cap for `tagFetch`.
- `src/lib/engine/orchestrator.server.ts` — A2 schema limits, effort setting, incremental verdict, A3 read short-circuit.
- `src/lib/engine/prompts/a2.ts` — input builder note on excerpt length (system prompt unchanged).
- `docs/ARCHITECTURE.md` — refreshed latency table.
