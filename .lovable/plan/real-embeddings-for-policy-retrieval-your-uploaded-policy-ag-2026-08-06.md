# Real embeddings for policy retrieval + your uploaded policy & agent prompts

Four changes, all server-side. No UI restructuring.

## 1. Retrieval moves to real embeddings

Today retrieval is keyword/token scoring with a 0.75 threshold. Replace the scoring stage with true semantic similarity from the Lovable AI embeddings endpoint using `openai/text-embedding-3-large` (3072 dims).

- On the first policy question after a server start, every corpus clause is embedded in one batched request and cached in memory for the life of the server process. Subsequent turns embed only the user's query (1 request per turn).
- Each clause is embedded as `heading + verbatim text` so the vector carries the subsection context.
- Scoring = cosine similarity between query vector and clause vectors.
- The two hard gates stay: a similarity threshold and the entity/subject match check. Anything failing either gate is never handed to Agent 2 as evidence — it still shows in Trace, struck through, with its reject reason.
- The threshold is recalibrated for cosine on this model (raw cosine for relevant text on `text-embedding-3-large` typically sits well below 0.75, so keeping 0.75 would make the assistant abstain on everything). Approach: normalise the raw cosine into a calibrated 0–1 relevance score against a floor, keep the demo-facing gate at 0.75 on that calibrated score, and show both raw cosine and calibrated score in Trace so the gate is auditable. Tuned against the real corpus so the five demo flows (including the sabbatical abstention returning NOT_IN_POLICY) behave correctly.
- Keyword scoring is kept only as a fallback if the embeddings call fails, so a gateway hiccup degrades instead of breaking the demo, and Trace labels which mode produced the scores.

## 2. Your policy manual replaces the seeded corpus

`src/data/policy-corpus.ts` is rebuilt from `darwinbox_hr_policy.md.pdf`, verbatim, chunked one chunk per subsection: 1.1–1.8, 2.1–2.5, 3.1–3.4, 4.1–4.3. The 1.1 entitlement table becomes one chunk carrying the full table content plus the contract-employee note. Clause IDs match the manual's numbering.

Facts that change from the current seeded corpus and ripple into behaviour: CL/SL lapse on 31 March (not 31 December), EL carry-forward cap 30 days with encashment, EL needs 3 months' tenure, regularization cap 3 per calendar month within a 5-working-day filing window, WFH 8 days per calendar month with a 1-month tenure gate. The existing eligibility fallback table is re-derived from these clauses.

## 3. Agent 2 gets your policy-lookup prompt

`agent2_policy_prompt.md.pdf` is installed as Agent 2's system prompt (task definition, prime directive "extract, never generate", the parametric-override rule, evidence rules E1–E8, the silence rule, status decision table D1–D4, and the per-field logic).

The JSON schema Agent 2 is constrained to is rewritten to match that prompt's output contract exactly: `status` / `policy[]` / `not_found[]`, and per subject `subject`, `policy_area`, `entitlement`, `limits[] {value, unit, basis}`, `requires_reason`, `conditions[]`, `text_verbatim`, `clause_id`. Nullable fields stay nullable — `null` and `[]` mean "policy is silent" and are treated as such downstream, never as `false`. The subject enum is aligned to the prompt's list.

## 4. Agent 1 and Agent 3 get your prompts

`agent1_prompt_cached.md.pdf` and `agent3_tool_prompt.md.pdf` are installed as the system prompts for the orchestrator/composer and the tool executor. Where a prompt's output contract differs from the current code's schema, the schema is updated to follow the prompt, and the deterministic guardrails in code (verdict judging, verbatim passthrough, confirmation-token requirement for MEDIUM/HIGH risk tools, MISSING_PARAMETERS instead of defaults) are kept and reconciled with it.

## Verification

Run the demo flows end to end in the browser after the change: a cited carry-forward answer (now §1.4, 30-day cap), the policy-filtered leave probe, PARTIAL on an over-balance request, the sabbatical abstention, and INSUFFICIENT_BALANCE with `attempts: 1`. Confirm Trace shows embedding scores per clause and the embedding call's own latency/cost line.

## Technical notes

- Embeddings call: `POST https://ai.gateway.lovable.dev/v1/embeddings`, `model: "openai/text-embedding-3-large"`, `Lovable-API-Key` header, called only from server code (`src/lib/hr/retrieval.ts` becomes server-only and moves behind the existing `/api/agent` route; the fallback keyword scorer stays pure).
- Corpus embedding is lazy and memoised at module scope in the server runtime — no database, nothing persisted, consistent with the in-memory design.
- Prompts move into dedicated files (`src/lib/ai/prompts/agent1.ts`, `agent2.ts`, `agent3.ts`) so they stay editable without touching orchestration code.
