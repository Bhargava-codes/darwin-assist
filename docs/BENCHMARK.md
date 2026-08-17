# Cost benchmark — agentic pipeline vs one-big-call baseline

Measured 2026-08-09 with `bun run scripts/benchmark.ts`. Every figure is read from the
`trace_events` rows the engine writes during the turn, priced with the live rate map in
`src/lib/ai/gateway.server.ts`. Everything in §1–§3 is measured; the prompt-caching projection in
§5 is explicitly labelled as modelled arithmetic on top of those measurements.

## Headline: the agentic pipeline is **more** expensive per turn, not less

At this corpus size it costs **4.04x** the lean baseline
($0.017272 vs $0.004277 per turn). We are publishing that rather than a
flattering number, because the reason is structural and worth stating plainly:

- The policy manual is only **~2109 tokens**. Inlining the *entire* corpus on every turn is
  cheap. Retrieval saves nothing you can measure until the corpus is large.
- The agentic path pays a fixed overhead the baseline never pays: A1's system contract (slot rules,
  grounding rules, tool routing) is re-sent on **every dispatch**, up to 3 dispatches per turn, on
  `openai/gpt-5.6-sol`. That prompt — not the policy clauses — is the dominant line item.
- Model tiering does work: A2 and A3 together are a rounding error. The cost is A1.

So the honest claim for this build is **grounding and auditability**, not cost. The cost win arrives
with scale, and the break-even is computable from the same numbers (below).

## Per-turn measurements (tokens shown `in/out`)

| Turn | Baseline (prefetch) tokens | Baseline (prefetch) cost | Baseline (lean) tokens | Baseline (lean) cost | Agentic tokens | Agentic cost | Agentic ÷ lean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 — Balance read | 4618/230 | $0.008072 | 2033/139 | $0.003931 | 18610/440 | $0.018766 | 4.77x |
| S2 — Pure policy question | 4616/233 | $0.008100 | 2031/223 | $0.004769 | 16925/688 | $0.019682 | 4.13x |
| S3 — Policy + tenure rule | 4617/117 | $0.006941 | 2032/206 | $0.004600 | 17541/680 | $0.019690 | 4.28x |
| S4 — Slot fill (missing type) | 4618/362 | $0.009392 | 2033/261 | $0.005151 | 6296/385 | $0.011720 | 2.28x |
| S5 — WFH policy | 4619/256 | $0.008334 | 2034/171 | $0.004253 | 16884/869 | $0.019628 | 4.62x |
| S6 — Attendance rule | 4618/217 | $0.007942 | 2033/193 | $0.004471 | 16897/645 | $0.019703 | 4.41x |
| S7 — Payslip read | 4617/180 | $0.007571 | 2032/97 | $0.003510 | 6294/250 | $0.010367 | 2.95x |
| S8 — Requests read | 4617/639 | $0.012161 | 2032/52 | $0.003060 | 19342/1274 | $0.023931 | 7.82x |
| S9 — Off-domain | 4616/113 | $0.006900 | 2031/103 | $0.003569 | 6293/156 | $0.009426 | 2.64x |
| S10 — Encashment policy | 4617/155 | $0.007321 | 2032/292 | $0.005460 | 16915/644 | $0.019802 | 3.63x |
| **Total (10 turns)** | **46173/2502** | **$0.082734** | **20323/1737** | **$0.042774** | **141997/6031** | **$0.172715** | **4.04x** |

The middle pair of columns is the baseline as a team would actually ship it: a single call has no way
to decide which HR reads it needs, so it prefetches all 12. That prefetch costs
1.93x the lean variant and still lands below the agentic path.

## Break-even on corpus size

The lean baseline's input is almost entirely the inlined manual, so its cost grows linearly with
corpus size. The agentic path's does not: retrieval caps what A2 ever sees at ~6 clauses regardless
of how large the manual gets.

- Baseline cost per turn ≈ $0.001641 fixed + (policy tokens × $1.25/1M)
- Agentic cost per turn ≈ $0.017272, flat in corpus size
- **Break-even ≈ 12,504 policy tokens — about 5.9× the current manual**
  (roughly a 40–50 page handbook, which is a realistic enterprise HR corpus)

Past that point every additional page is free for the agentic path and billed on every single turn
for the baseline. Below it, inlining wins on cost and loses on everything else: no citation
provenance, no verdict taxonomy, no abstention, no per-step trace.

## What would actually cut agentic cost

Ranked by measured impact, none of which are implemented yet — listing them is more useful than
claiming them:

1. **Prompt caching on A1's system contract.** It is static and re-sent on every dispatch; it is
   ~90% of agentic input tokens. Cached input is priced far below fresh input. Modelled at
   **−27.1%** of total spend in §5 below.
2. **Fewer A1 dispatches.** Turns needing an HRMS read plus a policy check pay A1 three times. The
   plan and the compose step could merge for single-tool turns.
3. **Drop A1 to a mid tier for slot-filling turns.** Asking "which leave type?" does not need
   `openai/gpt-5.6-sol`; composing a grounded final answer does.
4. **`rule_check` already avoids embeddings** by fetching clauses by tag — zero embedding calls.
   That saving is real but small, because embeddings were never the expensive part.

## Reproducing

```bash
bun run dev                                  # engine + Cloud backend must be reachable
bun run scripts/benchmark.ts                 # replays 3 × 10 turns, rewrites this file
bun run scripts/benchmark.ts --report-only   # rebuild this file from saved measurements
```

Raw measurements are committed at `scripts/benchmark-results.json`, so these numbers are auditable
without spending tokens.

## 5. Modelled: prompt caching on A1 (−27.1%)

**This section is arithmetic, not a measurement.** No caching is implemented. It is included because
§4 identifies A1 as the cost centre and a lever worth naming is worth sizing.

Basis: **32 live engine sessions, $0.682 measured total, $0.0213/session.** Spend by actor from
`trace_events`: **A1 60% ($0.411) · A2 25% ($0.168) · A3 15% ($0.103)** — model tiering is already
banked; A1 is the remaining surface.

| Line | Value | Note |
| --- | --- | --- |
| A1 spend today | $0.411 | 60% of total |
| …split input / output | $0.316 / $0.095 | input dominates: long instructions, small JSON out |
| Cacheable share of input | ~65% = $0.205 | the version-pinned instruction block, byte-identical every call |
| Same tokens at cached rate | $0.205 → $0.021 | $5.00 → $0.50 per 1M (90% discount) |
| Saving | $0.185 | on a $0.682 base |
| **Projected run cost** | **$0.497 · $0.0155/session** | **−27.1%** |

Deliberately conservative: A2's prompt is stateless and therefore 100% cacheable, and A3's is
version-pinned too — neither is counted above. Assumes output tokens ≈ 5% of input.

**Note the two denominators.** $0.0173 is per *turn* (10 scripted turns, harness). $0.0213 is per
*session* (32 live multi-turn sessions). Demo sessions average ~1.2 engine turns.

## 6. Scale projection

1M+ employees · 50% monthly active = 500K active users. Only queries-per-user is assumed, so it is
shown as a band rather than a point estimate.

| Volume driver | Queries / mo | Today | With caching |
| --- | --- | --- | --- |
| 1 query / user | 0.5M | $10,650 | $7,750 |
| 2 queries / user | 1.0M | $21,300 | $15,500 |
| 4 queries / user | 2.0M | $42,600 | $31,000 |

At the middle row, caching alone is ~$70K/year — which is the argument for implementing lever 1
before levers 2–4.
