# Darwinbox HR Assistant — Multi-Agent Workflow Engine

An HR assistant that an employee can talk to in plain language — "can I take leave tomorrow?" — and get back an answer that is **grounded in the policy manual** and, when the policy allows it, an **actual transaction in the HR system**.

The interesting part is not the chat UI. It is that no number, date, balance or policy clause ever reaches the employee unless a sub-agent produced it in that same turn. Everything is traced, priced and replayable.

- Mobile assistant: `/assistant`
- Requests history: `/requests`
- Ops console (desktop observability): `/ops`
- Per-session transcript: `/ops/sessions/<session_id>`

---

## 1. What it does

| Employee says | What happens |
| --- | --- |
| "I'm taking time off 15–20 June" | Orchestrator probes for the missing leave type, reads the live balance from HRMS, asks the policy agent whether that span is allowed, then applies the leave after an explicit confirmation. |
| "Can I carry forward my leave?" | Pure policy question → retrieval over the embedded policy corpus → answer with the clause it came from, or an honest abstention. |
| "Cancel my WFH on Friday" | Write tool, MEDIUM risk → confirmation gate before execution, idempotency key so a double-tap can't double-book. |
| Anything outside HR | Marked `unsupported_topic`. The assistant declines instead of inventing a policy. |

---

## 2. Architecture

```text
                            ┌──────────────────────────────┐
   employee (mobile)        │  /assistant  (React 19 UI)   │
   ───────────────────────► │  streams stage updates       │
                            └───────────────┬──────────────┘
                                            │ POST /api/engine/turn
                                            ▼
                    ┌──────────────────────────────────────────────┐
                    │      ORCHESTRATOR  (pure TypeScript)         │
                    │  src/lib/engine/orchestrator.server.ts       │
                    │                                              │
                    │  • owns the turn loop (max 4 dispatches)     │
                    │  • owns slot filling + confirmation gates    │
                    │  • owns risk policy on write tools           │
                    │  • records every step as a trace event       │
                    └───┬──────────────┬───────────────┬───────────┘
                        │              │               │
              plan/compose        policy check     HRMS execution
                        │              │               │
            ┌───────────▼───┐  ┌───────▼────────┐  ┌───▼──────────────┐
            │ A1  Composer  │  │ A2  Policy/RAG │  │ A3  HRMS agent   │
            │ gpt-5.6-sol   │  │ gpt-5.6-luna   │  │ gpt-5.6-luna     │
            │ user-facing   │  │ verdict + cite │  │ picks 1 tool     │
            │ never invents │  │ stateless      │  │ two-phase:       │
            │ a fact        │  │                │  │ select → report  │
            └───────────────┘  └───────┬────────┘  └───┬──────────────┘
                                       │               │
                              ┌────────▼───────┐  ┌────▼─────────────┐
                              │ pgvector RAG   │  │ Mock HRMS        │
                              │ policy_chunks  │  │ 12 typed tools   │
                              │ text-embed-3   │  │ over Postgres    │
                              └────────────────┘  └──────────────────┘
                                       │               │
                              ┌────────▼───────────────▼─────────────┐
                              │  Postgres (Lovable Cloud)            │
                              │  engine_sessions · engine_messages   │
                              │  trace_events · feedback · HR tables  │
                              └────────────────┬─────────────────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │  /ops  console      │
                                    │  metrics + transcript│
                                    └─────────────────────┘
```

### The agent contract

**Orchestrator — pure code, no LLM.** It decides *when* an agent runs, not *what* it concludes. It enforces: HRMS read before policy check, at most 4 sub-agent dispatches per turn, a confirmation gate on every MEDIUM/HIGH-risk write, and an idempotency key per `(session, tool, args)`. Because it is deterministic code, a turn is debuggable without re-prompting anything.

**A1 — Composer** (`src/lib/engine/prompts/a1.ts`, `gpt-5.6-sol`). The only agent the employee ever hears. It plans which sub-agent to call, fills slots by asking short questions, and composes the final reply from facts handed to it. It has no tools and no policy knowledge of its own — a fact with no provenance is a bug, not a fallback.

**A2 — Policy / RAG** (`prompts/a2.ts`, `gpt-5.6-luna`). Stateless. Receives a normalised question plus retrieved clauses and returns a verdict: `FULL`, `PARTIAL`, `NONE`, `BLOCKED`, `ESCALATE`, or `NOT_IN_POLICY`, with the clause IDs it relied on. It never sees conversation history, so it cannot be talked into a verdict.

**A3 — HRMS agent** (`prompts/a3.ts`, `gpt-5.6-luna`). Two-phase. Phase 1 selects exactly one tool and its arguments; if an argument is missing it refuses rather than guessing. Phase 2 turns the raw tool result (or a mapped error code) into structured facts.

### Grounding rule

> Every figure, date, balance, entitlement and clause in the assistant's reply must trace to an A2 verdict or an A3 tool result produced **in the same turn**.

The transcript view exists to prove this: for any sentence shown to the employee you can point at the trace event that produced it.

---

## 3. Running it

**Prereqs:** [Bun](https://bun.sh) ≥ 1.1, Node 20+, and a Lovable Cloud backend (Postgres + pgvector) — or any Supabase project.

```bash
bun install
cp .env.example .env     # fill in your backend URL + publishable key
bun run dev              # http://localhost:8080
```

`bun run build` produces the production bundle; the server half runs on an edge worker runtime, so server code sticks to Web-standard and Worker-safe APIs.

**Backend.** Schema lives in `supabase/migrations/`. Applying them creates the conversation tables, the trace tables, the vector table and the mock HR tables, and seeds employee **E-4471** with balances, attendance and payslips.

**Secrets.** `.env` holds only the backend URL, project ref and the **publishable** (anon) key — values that are safe in a browser bundle and are gated by row-level policies, not by secrecy. No provider or service-role keys are in the repo: model calls go through the Lovable AI Gateway, which injects `LOVABLE_API_KEY` into the server runtime at call time. `.env` is gitignored going forward; if you fork this, run `git rm --cached .env` and supply your own from `.env.example`.

### Retrieval: chunking and the abstention floor

The corpus in `src/lib/engine/policy-chunks.ts` is chunked **one clause per chunk** — 27 chunks, median 81 tokens, max 192 — and embedded into `policy_chunks_small` via `POST /api/engine/embed`.

Clause-level chunking is a deliberate choice over fixed-size windows: a citation is only useful if it names the thing a human can look up, and an HR clause is already the atomic unit of meaning ("EL accrues 1.5 days/month", "PL requires 6 months' tenure"). Fixed 512-token windows would straddle two leave types and let A2 cite a chunk that half-supports its verdict. The cost is lower recall on questions phrased across clauses, which the top-6 fan-out absorbs.

**Embedding config:** `text-embedding-3-small`, 1536 dims pinned to the `vector(1536)` column, batched 64 per call. `chunk_id` *is* the clause ID from the manual (`1.1-CL`, `2.3`), so a citation is auditable against the source document by a human. Chunk text is stored verbatim — never paraphrased into the index.

### Two retrieval paths, both chosen by code

The LLM never decides how to search. The orchestrator does, based on whether it already knows the object in play (`src/lib/engine/retrieval.server.ts`):

| Path | When | How | Embedding calls |
| --- | --- | --- | --- |
| `policy_qa` | Open question — "can I carry forward leave?" | Embed the question, top-6 vector search over `policy_chunks_small` | 1 |
| `rule_check` | Object already known — casual leave, WFH, regularisation | Fetch clauses by `object_tags` overlap, ordered, capped at 12 | **0** |

`rule_check` exists because most turns are not open questions: by the time the orchestrator has slot-filled a leave application it knows exactly which clauses govern it, and embedding a question it already answered is wasted latency and spend. The saving is real but small — embeddings were never the expensive line item (see §3a).

Retrieval on the `policy_qa` path enforces a **cosine similarity floor of 0.32 inside the SQL function**, not in application code:

```sql
where (1 - (p.embedding <=> query_embedding)) >= match_threshold  -- default 0.32
```

Calibrated against the live corpus: in-policy questions score 0.43–0.57, off-domain questions ("who is the CEO of Tesla?") never exceed 0.21. Below the floor the RPC returns zero rows, A2 sees no clauses and returns `NOT_IN_POLICY` — an abstention with a human hand-off, not a plausible paragraph. Because the floor lives in the function, no caller can bypass it.

**Models** (via the Lovable AI Gateway, so no provider keys in the repo):

| Role | Model | Why |
| --- | --- | --- |
| A1 composer | `openai/gpt-5.6-sol` | user-facing reasoning + planning |
| A2 policy, A3 tools | `openai/gpt-5.6-luna` | narrow, schema-constrained, high volume |
| Retrieval | `openai/text-embedding-3-small` | cheap recall over a small, dense corpus |
| Baseline comparison | `openai/gpt-5.6-sol` | one big call, for the cost/quality contrast in `/ops` |

---

## 3a. Cost: measured, and not the flattering result

`bun run benchmark` replays 10 representative turns three ways — agentic, naive one-big-call baseline with all 12 HR reads prefetched, and the same baseline without the prefetch — and prices every turn from the `trace_events` rows the engine wrote. Raw measurements are committed at `scripts/benchmark-results.json`; the full write-up is [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

| Mode | 10 turns | Per turn |
| --- | --- | --- |
| Baseline, no prefetch | $0.042774 | $0.004277 |
| Baseline, 12 reads prefetched | $0.082734 | $0.008273 |
| **Agentic pipeline** | **$0.172715** | **$0.017272** |

**The agentic pipeline costs ~4× the lean baseline at this corpus size.** That is the measured result and it is stated here rather than buried, because the cause is structural: the policy manual is only ~2,100 tokens, so inlining all of it is cheap, while A1's system contract is re-sent on every dispatch (up to 3 per turn) on the expensive tier. Model tiering does work — A2 and A3 together are a rounding error. The cost is A1.

The break-even is computable from the same numbers: the baseline's cost grows linearly with corpus size, the agentic path's does not (retrieval caps A2's input at ~6 clauses). Crossover is at **~12,500 policy tokens, ~6× this manual** — a 40–50 page handbook, i.e. a realistic enterprise corpus. Below that, inlining wins on cost and loses on citation provenance, verdict taxonomy, abstention and per-step tracing.

### The 27% cut from prompt caching — modelled, not yet measured

The measurement above says the lever is A1, so this models that lever explicitly. Over the **32 live sessions** in the engine at time of writing (**$0.682 total, $0.0213/session**), spend splits **A1 60% / A2 25% / A3 15%** — the cheap-model lever is already spent, and A1 is what's left.

| Line | Value | Note |
| --- | --- | --- |
| A1 spend today | $0.411 | 60% of $0.682 |
| …split input / output | $0.316 / $0.095 | input dominates — long instructions, small JSON out |
| Cacheable share of input | ~65% = $0.205 | the version-pinned instruction block, byte-identical every call |
| Same tokens at cached rate | $0.205 → $0.021 | $5.00 → $0.50 per 1M input (90% discount) |
| Saving | $0.185 | on a $0.682 base |
| **New run cost** | **$0.497 · $0.0155/session** | **−27.1%** |

This is **modelled arithmetic on measured spend, not a measured result** — caching is not implemented (see §7). It is deliberately conservative: A2's prompt is stateless and therefore 100% cacheable, A3's is version-pinned too, and neither is counted. Output tokens are assumed ≈5% of input.

Two cost bases appear in this repo and they are not the same denominator: **$0.0173 per *turn*** is the benchmark harness replaying 10 scripted turns; **$0.0213 per *session*** is live spend across 32 real multi-turn sessions. Sessions in the demo average ~1.2 engine turns, which is why the two land close.

### At Darwinbox scale

| Volume driver | Queries / mo | Today | With caching |
| --- | --- | --- | --- |
| 1 query / user | 0.5M | $10,650 | $7,750 |
| 2 queries / user | 1.0M | $21,300 | $15,500 |
| 4 queries / user | 2.0M | $42,600 | $31,000 |

Basis: 1M+ employees, 50% monthly active = 500K active users. Only queries-per-user is an assumption, hence the sensitivity band. At the middle row, caching alone is **~$70K/year**.

So the claim this build makes is **grounding and auditability**, not cheapness. `docs/BENCHMARK.md` lists the four changes that would actually cut agentic spend (prompt caching on A1's static contract first, worth ~90% of its input tokens) and is explicit that none are implemented yet.


---

## 4. Key design decisions

| Decision | Why | Tradeoff we accepted |
| --- | --- | --- |
| **Pure-code orchestrator**, not LangChain / CrewAI / AutoGen | Control flow *is* the product: slot filling, confirmation gates and risk rules must be inspectable and testable, not implied by a framework's agent loop. | We hand-wrote the loop, retries and schema validation. |
| **Three narrow agents** instead of one tool-using model | A single model with tools drifts between quoting policy and inventing it. Splitting policy from execution means policy can hard-block an action the tool layer is perfectly capable of performing. | More round-trips per turn, so higher latency. |
| **Two model tiers** | A1 needs judgment; A2/A3 return schema-shaped JSON, where a cheap fast model is indistinguishable. | Two prompt surfaces to keep in sync. |
| **Strict JSON contracts per agent** | The orchestrator can reject a malformed agent response instead of forwarding half-parsed text to the user. | Prompts are long and version-pinned; changes need re-testing. |
| **RAG with a similarity floor + abstention verdict** | The correct answer to an unwritten policy is "this isn't in the manual, here's who to ask" — not a plausible paragraph. | Recall loss on badly worded questions; we'd rather under-answer. |
| **Trace-first schema** | Every step writes a `trace_event` with actor, latency, tokens and cost *before* the reply renders. Observability isn't a later add-on. | Extra writes per turn; traces contain full agent I/O. |
| **Confirmation gate on writes** | An LLM should never be one token away from filing leave on someone's behalf. | An extra turn on every transaction. |
| **Mock HRMS behind a typed tool interface** | The 12 tools are the seam. Swapping the mock for a real Darwinbox API is an adapter change, not an agent change. | Demo data only; no real HRMS edge cases yet. |

---

### The 12 tools

`src/lib/engine/hrms.server.ts`. Every tool is a JSON Schema with typed args, enums, and `additionalProperties: false`; A3 selects exactly one per phase-1 call and refuses rather than guessing a missing argument.

| Reads (7) | Writes (5) |
| --- | --- |
| `get_employee_profile` | `apply_leave` |
| `get_leave_balance` | `cancel_leave` |
| `get_leave_requests` | `apply_wfh` |
| `get_attendance` | `cancel_wfh` |
| `get_wfh_usage` | `regularize_attendance` |
| `get_regularization_usage` | |
| `get_payslips` | |

Writes are the only tools behind the confirmation gate, and the only ones carrying an idempotency key.

---

## 5. Observability

Every turn writes a `trace_event` row per step (`orchestrator`, `A1`, `A2`, `A3`, `rag`, `hrms`) carrying input, output, latency, token counts and actual USD cost from the live price map.

`/ops` surfaces:

- **Deflection** — turns resolved without escalation.
- **Avg turn latency** — total step latency ÷ turns. What the employee actually waits per reply.
- **Duration** — wall-clock session length (`last_active_at − created_at`). Separate from latency on purpose: agents run in parallel, so summing steps overstates the wait.
- **P95 latency**, **cost per session**, **A1/A2/A3 call counts**, **RAG hits**, **tool calls**, **feedback**.

`/ops/sessions/<session_id>` is a shareable transcript: the interleaved user → A1 → A2 → A3 sequence, plus **Trace log**, **Waterfall** and **Config** tabs. Sessions list newest-first; the same `session_id` is shown in the mobile chat header so a reported issue is one click from its trace.

---

## 6. Repo map

| Path | What lives there |
| --- | --- |
| `src/lib/engine/orchestrator.server.ts` | the turn loop, slot filling, risk gates, tracing |
| `src/lib/engine/prompts/{a1,a2,a3}.ts` | version-pinned system prompts |
| `src/lib/engine/hrms.server.ts` | 12 HR tools, idempotency, error mapping |
| `src/lib/engine/retrieval.server.ts`, `embed.server.ts` | pgvector retrieval + embedding |
| `src/lib/engine/policy-chunks.ts` | the policy corpus, chunked by clause |
| `src/lib/engine/pricing.ts` | model routing + real token pricing |
| `src/routes/api/engine/*` | `turn`, `sessions`, `embed` endpoints |
| `src/routes/api/ops/*` | aggregate metrics + per-session detail |
| `src/routes/assistant.*`, `requests.tsx` | mobile employee app |
| `src/routes/ops*`, `src/components/ops/transcript.tsx` | observability console |
| `scripts/benchmark.ts` | cost benchmark harness + committed raw measurements |
| `supabase/migrations/` | schema + seed |
| `docs/ARCHITECTURE.md`, `docs/BENCHMARK.md` | architecture brief + cost measurements |

---

## 7. What is real, what is mocked

**Real:** the agents, prompts, orchestration, semantic retrieval over the actual policy manual, token/cost accounting, persistence, and the trace pipeline.

**Mocked:** the HRMS. Tools read and write Postgres tables that stand in for Darwinbox, seeded with one employee (E-4471).

### The hardest trade-off

Correctness bought at the architecture layer; speed bought back at the perception layer.

| What I gave up | What I bought | How I paid it back |
| --- | --- | --- |
| More round trips than one tool-using model | Policy outranks capability — A2 hard-blocks what A3 could happily execute | Chips collapse a typed reply into one tap |
| A full extra turn on every write, for the confirmation gate | A2 never sees the transcript, so it can't be argued into a verdict | Streamed stage updates make the wait legible, not dead |
| Two prompt surfaces to keep in sync | No fact without provenance in the same turn | Confirm and Cancel are deterministic — zero LLM calls |

---

**Not built yet:** SSO and multi-tenant row-level isolation, real HRMS adapters, an automated eval harness over a golden set of turns, prompt regression gating, per-user rate limits and cost ceilings, PII redaction in stored traces, prompt caching on A1's static contract, and durable (rather than in-memory) retry state for transient tool failures.

**How it was built.** The app shell — routing, Tailwind design tokens, shadcn components, the Cloud/Postgres wiring — was scaffolded with Lovable, which is why the git history is dominated by bot-authored commits. The parts under review were authored deliberately and iterated by hand: the orchestrator turn loop and its gates, the three agent contracts, the tool layer and its error taxonomy, the retrieval path and its abstention floor, the trace schema, and the benchmark harness. Read `src/lib/engine/` to judge the work; the commit log reflects the tool, not the design.

The one-page brief in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the reasoning and the path to production; the cost numbers live in [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

