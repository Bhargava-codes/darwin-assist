# Architecture Brief — Darwinbox HR Assistant

## Problem

An HR question is rarely one thing. "Can I take leave tomorrow?" is simultaneously a **policy interpretation** (does my tenure, gender, leave type and notice period permit it?) and a **transaction** (does my balance cover it, and please file it). A single LLM with tools handles both badly: it will confidently paraphrase a policy it never read, or it will read the policy and still not act. Neither failure is acceptable in HR, where a wrong answer becomes a payroll dispute.

## Approach

Split the work across three narrow agents and give control flow to code, not to a model.

**LLMs decide. Code controls.** The orchestrator is plain TypeScript: it sequences the agents, fills missing slots, enforces read-before-policy ordering, gates risky writes behind explicit confirmation, and writes a trace event for every step. Nothing about the turn's shape is emergent.

- **A1 — Composer** (`gpt-5.6-sol`): the only voice the employee hears. Plans, asks clarifying questions, composes the reply. No tools, no policy memory.
- **A2 — Policy** (`gpt-5.6-luna`): stateless verdict over retrieved clauses. `FULL / PARTIAL / NONE / BLOCKED / ESCALATE / NOT_IN_POLICY`, with citations.
- **A3 — HRMS** (`gpt-5.6-luna`): two-phase. Selects exactly one of 12 typed tools and its arguments, then reports the result as structured facts.

```text
  user turn
     │
     ▼
 ORCHESTRATOR (pure code) ──► A1  plan / slot-fill / compose
     │  max 4 dispatches            ▲
     ├──► A3  HRMS read ────────────┤   facts
     ├──► A2  policy + RAG ─────────┤   verdict + clause IDs
     ├──► confirmation gate (writes)│
     └──► A3  HRMS write ───────────┘
     │
     ├──► trace_events  (actor, latency, tokens, cost)
     ▼
  reply to employee            ──►  /ops console + transcript
```

## Grounding and safety

The invariant: **every fact in a reply traces to an A2 verdict or an A3 tool result from the same turn.** A1 originating a number is treated as a defect.

Three enforcement layers:

0. **Retrieval routing in code.** Two paths, both chosen by the orchestrator, never by a model.
   `policy_qa` embeds an open question and runs top-6 vector search; `rule_check` fetches clauses by
   `object_tags` when the object is already known, at zero embedding calls. Chunks are one per
   numbered clause, `chunk_id` *is* the manual's clause ID, and text is stored verbatim — so a
   citation is auditable against the source document by a human, not just by the system.
1. **Retrieval floor.** A cosine similarity floor of **0.32, enforced inside the `match_policy_small` SQL function** so no caller can bypass it. Calibrated on the live corpus: in-policy questions score 0.43–0.57, off-domain questions never exceed 0.21. Below the floor the query returns zero rows, so A2 sees no clauses and returns `NOT_IN_POLICY` — an abstention with a human hand-off, not a guess.
2. **Verdict taxonomy.** `BLOCKED` and `NONE` stop an action the tool layer is technically able to perform. Policy outranks capability.
3. **Confirmation gate + idempotency.** MEDIUM/HIGH-risk writes require an explicit yes, and each `(session, tool, args)` carries an idempotency key so a retry cannot double-file.

Off-domain input is flagged `unsupported_topic` and declined.

## Data model

| Group | Tables |
| --- | --- |
| Conversation | `engine_sessions`, `engine_messages` |
| Observability | `trace_events`, `feedback` |
| Knowledge | `policy_chunks_small` (pgvector, clause-level) |
| HR system of record (mock) | `employees`, `leave_balances`, `leave_requests`, `attendance_records`, `attendance_regularizations`, `wfh_requests`, `payslips` |

Traces are written during the turn, not reconstructed after, so `/ops/sessions/<id>` replays the exact sequence with per-step latency, tokens and USD cost.

## Design decisions and tradeoffs

| Decision | Rationale | Cost |
| --- | --- | --- |
| Hand-written orchestrator over LangChain/CrewAI | Gates and ordering are the product; they must be readable and unit-testable | We own the loop, retries and validation |
| Three narrow agents over one tool-using model | Isolates policy authority from execution capability | More round-trips, higher latency |
| Model tiering (sol for A1, luna for A2/A3) | Judgment where it matters; schema-shaped JSON is cheap | Two prompt surfaces to maintain |
| Strict JSON contracts | Malformed agent output is rejected, not forwarded | Long, version-pinned prompts |
| Abstain-by-default retrieval | Under-answering beats fabricating policy | Recall loss on vague questions |
| Clause-level chunks (27 chunks, median 81 tokens) | A citation is only useful if it names a clause a human can look up; fixed windows straddle two leave types | Lower recall on cross-clause questions, absorbed by top-6 fan-out |
| Trace-first schema | Observability is a build-time property, not a retrofit | Extra writes; traces hold full agent I/O |
| Mock HRMS behind a typed tool seam | Real API is an adapter swap, not an agent rewrite | No production HRMS edge cases yet |

## Metrics that matter

**Deflection** (turns closed without escalation), **avg turn latency** (total step latency ÷ turns — the employee's felt wait), **session duration** (wall clock; deliberately separate, since parallel agents make summed steps misleading), **P95 latency**, and **cost per turn** against a single-big-call baseline.

### Cost, measured rather than asserted

`bun run benchmark` replays 10 representative turns three ways and prices each from the trace rows the engine wrote. Result: **$0.0173/turn agentic vs $0.0043/turn for a lean one-call baseline — the agentic path is ~4× more expensive at this corpus size.** The cause is structural: a ~2,100-token manual is cheap to inline wholesale, while A1's static contract is re-sent on every dispatch on the expensive tier. Tiering works; A2 and A3 are a rounding error.

Because baseline cost scales with corpus size and the agentic path's does not, crossover sits at **~12,500 policy tokens (~6× this manual, a 40–50 page handbook)**. Below that, inlining is cheaper and gives up citation provenance, verdict taxonomy, abstention and per-step tracing. The strongest lever on agentic spend — prompt caching on A1's static contract — is sized rather
than merely named: across 32 live sessions ($0.682, $0.0213/session), A1 is 60% of spend, ~65% of
its input is the version-pinned instruction block, and repricing those tokens at the cached rate
projects **−27.1% ($0.0155/session)**. That figure is **modelled arithmetic on measured spend, not a
measured result** — caching is not implemented. At Darwinbox scale (1M employees, 50% MAU, 2
queries/user/mo = 1M queries) that lever is $21,300/mo → $15,500/mo. Full numbers: [`BENCHMARK.md`](BENCHMARK.md).

## Path to production

1. **Identity** — SSO plus per-tenant row-level isolation; today's demo is one seeded employee.
2. **Real HRMS adapters** behind the existing 12-tool interface, with contract tests per tool.
3. **Eval harness** — a golden set of turns asserting verdict, citation and tool choice; run on every prompt change.
4. **Prompt versioning + regression gates** so a prompt edit cannot silently change a verdict.
5. **Guardrails at scale** — per-user rate limits, cost ceilings, and PII redaction before traces are persisted.
6. **Human hand-off loop** — escalations open a real HR ticket with the trace attached.
