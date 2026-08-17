# Closing the review gaps — sized by points per hour

I verified the three technical claims in the review before planning:

- **Similarity floor: genuinely absent.** `match_policy_small(query_embedding, match_count)` in `supabase/migrations/20260809105211_*.sql` orders by distance and limits — there is no threshold anywhere in SQL or in `semanticSearch`. README and brief both claim one. Correct deduction.
- **`.env` is tracked in git** (`git ls-files` lists it) with the project ID and publishable key, contradicting the README's "no provider keys in the repo" line.
- **Baseline is stacked.** `runBaseline` loops all `READ_TOOLS` every turn *and* inlines `fullPolicyText()`. Real, and worth pre-empting in writing.

Everything below is ordered by points per hour.

## Tier 1 — do these (≈2h, ≈ +9.5 points)

**1. Commit the cost numbers (+5, ~50 min).**
Add a repeatable benchmark script that replays a fixed set of 8–10 representative turns (slot-fill, pure policy question, balance read, write with gate, off-domain) through both `baselineMode: true` and the agentic path, reading token/cost straight from the `trace_events` rows already written. Output a markdown table committed to `docs/BENCHMARK.md` and summarised in the README: turns, baseline tokens in/out, baseline USD, agentic tokens/USD, % reduction.
Report **two baseline columns** — with and without the 12-read prefetch — and state in one line that the prefetch is part of the naive baseline by design, so the honest saving is the narrower number. Attribute the saving to its three actual sources: model tiering (sol only for A1), `rule_check` skipping embedding calls entirely, and never inlining the full policy.

**2. Fix the similarity floor for real (+3, ~25 min).**
New migration: `match_policy_small(query_embedding, match_count, match_threshold double precision default 0.28)` with `where 1 - (embedding <=> query_embedding) >= match_threshold`, plus the matching `REVOKE`/`GRANT` for the new signature. Pass the threshold from `semanticSearch`, and when zero chunks survive, return an empty set so the orchestrator's existing `NOT_IN_POLICY` path fires instead of citing a weak match. Quote the SQL `where` clause in the README's retrieval section so the claim is checkable without opening migrations. Calibrate the constant against a few real questions rather than guessing it.

**3. Secrets hygiene + honest README line (+1.5, ~15 min).**
Add `.env` to `.gitignore` and correct the README to say exactly what is in the file: backend URL, project ref and a **publishable** key — no provider or service keys, ever. The publishable key is safe by design, but the README sentence has to match reality. Note: untracking the file and rotating the key are actions you take on the repo/backend side, not something I do from here — I'll flag the exact commands in the closing note.

## Tier 2 — cheap credibility (≈45 min, ≈ +2)

**4. Chunking rationale (+2, ~15 min).** Three sentences in the README: boundary rule (one clause = one chunk, headings retained as retrieval context), measured average and max chunk size (computed from `policy-chunks.ts`, not estimated), and why clause-level beats fixed-window here — a fixed window splits a clause's condition from its entitlement, which is precisely the failure that produces a confident wrong answer.

**5. Build-provenance line (+1.5, ~20 min).** One short README paragraph: Lovable scaffolded the app shell and schema plumbing; the orchestrator, the three prompt contracts, the 12-tool layer, the trace schema and the ops console are hand-authored and reviewed. Disclosure beats silence, since the commit list is the first thing on the repo page.

## Tier 3 — only if you want the engineering-depth points (skip for the deadline)

- **Structured slot store (~1h).** A `session_slots`-style JSON column the orchestrator owns, so slot memory stops being re-derived by A1 from raw text. This is the one place the README currently over-claims about the orchestrator.
- **Zod validation on tool args (~30 min)** in `hrms.server.ts`, so schema enforcement exists on the server boundary and not only at the model boundary.
- **Retry hardening (~20 min).** One backoff step, and move `transientBurned` off an in-memory `Set` (it does not survive worker instances) onto the idempotency row.

## What I would not do

Rewriting 279 bot commits. It is hours of work, it risks the live sync, and item 5 defuses it for 20 minutes of writing.

## Expected outcome

Tier 1 + Tier 2 ≈ **+11.5 → roughly 96–99**, in about 2h45m, and it closes every gap the review said a reviewer hits in the first 60 seconds.

## Technical notes

- Benchmark harness runs as a script against the dev server's `/api/engine/turn` with a `baseline` flag, in a throwaway session per turn so traces stay attributable; costs come from the existing `pricing.ts` price map, so the table is measured spend, not modelled.
- The threshold change is additive — a new default argument plus grants — so existing callers keep working.
- No prompt or agent-behaviour changes in Tier 1 or 2; the verdict path is untouched apart from more `NOT_IN_POLICY` firing where it should have already.
