# Cutting turn latency (13.2s avg → target ~5s)

## Measured today (from `trace_events`, 73 agentic turns)

| Step | Calls | Avg | P95 | Avg tokens in / out |
| --- | --- | --- | --- | --- |
| A2 policy verdict | 49 | 5.53s | 12.95s | 4186 / 516 |
| A1 reply | 63 | 4.24s | 8.42s | 6025 / 270 |
| A1 ask_policy | 49 | 2.90s | 4.42s | 5817 / 180 |
| A3 report | 32 | 2.48s | 4.05s | 3148 / 184 |
| A1 ask_hrms | 33 | 2.43s | 3.76s | 5759 / 137 |
| A3 select tool | 43 | ~2.0s | ~4.1s | ~2350 / 80 |
| HRMS + RAG (non-LLM) | — | 0.25–0.8s | — | — |

Whole turn: **avg 13.2s, P95 28.0s, 6.1 steps (max 12)**.

Root cause is structural, not slow models: every step is a separate, fully sequential LLM round-trip, A1 re-runs on each dispatch with a ~6k-token prompt, and two of the calls (A3 select + A3 report) are LLM work that code can do.

## Low-hanging fruit first

| Tier | Work | Effort | Seconds saved | Risk |
| --- | --- | --- | --- | --- |
| Do now | Step 1 — low reasoning effort on A2/A3 | ~15 min, one file | 3–4s | Verdict diff only |
| Do now | Step 4 — speculative balance prefetch | ~15 min | 0.4s + often one dispatch | None |
| Do now | Step 2b — drop the A3 `report` call, format facts in code | ~30 min | 2.5s | None (removes a paraphrase step) |
| Next | Step 2a — code-routed read tool map, A3 selector as fallback | half day | ~2s | Low, falls back to today's path |
| Next | Step 3 — parallel HRMS + policy dispatch | half day | 2.5–3s | None to accuracy, touches A1 contract |
| Later | Step 6 — stream the reply | UI work, independent | perceived, large | None |
| Measure first | Step 5 — trim A1 input; Step 7 — dispatch cap 4 → 3 | — | 0.5–1s + tail | Real, see quality table |

The three "do now" items alone take a typical turn from ~13.2s to roughly 7s with no expected change in answers.

## Plan of action, ordered by seconds saved per hour of work


### 1. Explicit low reasoning effort on A2 and A3 (~3–4s off a typical turn)

A2 emits 516 output tokens for a schema-shaped verdict and no reasoning effort is set on any gateway call, so the model reasons at its default budget. Set `reasoning: { effort: "low" }` for A2/A3 (schema-constrained, no open-ended judgment) and keep A1 at medium. Verify verdict quality on a fixed set of turns before/after.

### 2. Delete the two A3 LLM calls for reads (~4.5s off any turn that reads HRMS)

A3's read path today is: LLM picks a tool from 12, code runs it, LLM re-narrates the result. Replace with:

- deterministic intent → tool map in code for the read tools (balance, requests, attendance, payslip, profile), falling back to the A3 selector only on a miss;
- code-formatted facts instead of the `report` call — the tool result is already structured JSON.

Writes keep the A3 selector (argument extraction is genuine judgment).

### 3. Run HRMS read and policy retrieval concurrently (~2.5–3s)

The current loop lets A1 request one thing per dispatch, so a leave question costs two A1 round-trips before it can compose. Allow A1 to emit both `hrms_request` and `policy_request` in one dispatch and `Promise.all` them, so the common "check my balance + check the clause" turn drops one full A1 pass.

### 4. Speculative balance prefetch (~0.4s, plus removes a dispatch)

Kick off `get_leave_balance` in parallel with A1's first call at turn start. It is cheap, non-mutating, and needed by most leave turns; discard it when unused.

### 5. Shrink A1's per-dispatch input (~0.5–1s per A1 call)

A1 sends ~5.8–6.0k input tokens every dispatch. Trim by: splitting the static contract from the per-turn context, capping transcript at 6 turns, and compacting the verbose `findings` strings into short structured lines. Prefill time scales with these tokens on every dispatch.

### 6. Stream A1's final reply (perceived latency, big win, no accuracy risk)

The final compose is already a streaming gateway call consumed server-side. Pass its text deltas through the existing NDJSON stage stream so the employee sees the answer forming instead of waiting the full remaining ~4s. Time-to-first-token becomes the felt latency.

### 7. Guardrail: cap dispatches at 3 and record a per-turn budget

Turns hitting 12 steps are the P95 tail. Lower `MAX_DISPATCHES` to 3 and record a `budget_exceeded` trace event so the tail is visible in `/ops` instead of silent.

## Impact on response quality

Grounding is unaffected: every fact still comes from an A2 verdict or an A3 tool result in the same turn, the 0.32 similarity floor stays in SQL, and the confirmation gate is untouched. Risk sits in three of the seven steps.

| Step | Quality risk | Mitigation |
| --- | --- | --- |
| 1. Low reasoning on A2/A3 | Real. A2 does the hardest judgment in the system (tenure, notice, gender, balance → verdict). Low effort could flip a `PARTIAL` to `FULL` or miss a `violated` rule. | Run a fixed set of turns before/after and diff verdict, `violated`, and `chunk_ids`. If any verdict changes, keep A2 at medium and take low only on A3. A2 costs ~$0.0001/call, so keeping it at medium is nearly free — latency is the only reason to touch it. |
| 2. Code-routed read tools | Low but real: an intent the map doesn't recognise. | Fall back to the A3 selector on any miss, so behaviour degrades to today's path, never to a wrong tool. Code-formatted facts are strictly safer than an LLM re-narrating them — it removes a paraphrase step where a number could drift. |
| 5. Trimmed A1 input | Real. Shorter transcript (10 → 6 turns) can lose context in long multi-turn threads; compacted findings can drop nuance A1 was using. | Keep slot/pending state and all policy findings verbatim; compact only formatting. Trim the transcript last, and check multi-turn slot-filling turns specifically. |
| 7. Dispatch cap 4 → 3 | Real for the small number of turns that genuinely need three lookups — they will hand off to HR Helpdesk instead of answering. | Measure how many recorded turns actually used a 4th dispatch before changing it. If it is non-trivial, leave the cap at 4 and rely on steps 1–5 for the tail. |

Steps 3, 4 and 6 (parallel dispatch, prefetch, streaming) change only when work happens, not what any model sees, so they carry no accuracy risk.

Net: expect the same answers, faster — with step 1 and step 7 as the two places where we accept a measurement result rather than assume one. Both are one-line reverts if the diff shows drift.

## Expected outcome

Steps 1–4 are mechanical and should take the average turn from ~13.2s to roughly 5–6s with the same verdicts; step 6 makes the remainder feel near-instant. `/ops` already tracks avg turn latency and P95, so we re-measure there after each step rather than asserting the improvement.

## Files touched

- `src/lib/ai/gateway.server.ts` — reasoning effort option, expose text deltas.
- `src/lib/engine/orchestrator.server.ts` — parallel dispatch, code-side read tool routing and fact formatting, prefetch, dispatch cap, trimmed A1 input.
- `src/lib/engine/prompts/a1.ts` — allow a combined hrms+policy dispatch.
- `src/routes/api/engine/turn.ts` — forward reply token deltas on the stream.
- `src/routes/assistant.$sessionId.tsx` — render the streaming reply.
- `docs/ARCHITECTURE.md` — update the latency section with before/after numbers.

## Sequencing

Do 1 + 2 first and re-measure (biggest, lowest-risk). Then 3 + 4. Then 5 + 7. Step 6 last, since it is UI-facing and independent of the engine changes.
