# Deliverables for hiring-team review: README, Architecture brief, clean repo

Goal: make the repo readable in 5 minutes by a product person and in 20 minutes by an engineer. Three artifacts, built in order.

Today `README.md` is the raw build prompt pasted in — it reads like a spec dump, not a project. That gets replaced.

## Step 1 — README.md (rewritten from scratch)

Structure, in this order:

1. **One-liner + what it does** — a multi-agent HR assistant where employees ask in plain language ("can I take leave tomorrow?") and get a grounded, policy-checked answer plus a real HRMS action.
2. **Screens / where to look** — `/assistant` (mobile chat), `/requests`, `/ops` (observability console), `/ops/sessions/<id>` (full transcript). Screenshot placeholders.
3. **Architecture diagram** — ASCII, in-README (mirrors the brief).
4. **The agent contract** — A1 customer-facing composer, A2 policy/RAG verdicts, A3 HRMS execution, and the pure-code orchestrator that owns the loop. One paragraph each, plus the grounding rule: no fact reaches the user unless A2 or A3 produced it in the same turn.
5. **Setup** — prereqs, `bun install`, env vars needed, `bun run dev`, note that backend (Postgres + pgvector + auth) is provisioned by Lovable Cloud, and how policy chunks get embedded.
6. **Key design decisions** — 6-8 entries, each as *decision → why → tradeoff* (see Step 2 list; README carries the short form).
7. **Observability** — what a turn writes (trace events, per-agent latency, tokens, cost), and the metrics defined: deflection, avg turn latency vs session duration, P95, cost/session.
8. **Repo map** — table of the directories that matter (`src/lib/engine`, `prompts/`, `src/routes/api`, `src/routes/ops*`).
9. **What's mocked vs real / known limits** — honest section: HRMS is a mock over Postgres, no SSO, single seeded employee, prompt versions pinned.

Tone: declarative, short sentences, no marketing adjectives. Every claim traceable to a file.

## Step 2 — ARCHITECTURE.md (the 1-page brief)

Standalone, ~1 page, written for the product + builders audience. Sections:

- **Problem** — HR queries are half policy interpretation, half transaction; a single LLM either hallucinates policy or can't act.
- **Approach** — separation of concerns across three narrow agents with a deterministic orchestrator; LLMs decide, code controls.
- **Diagram** — request path from user turn through orchestrator → (A1 plan) → parallel A2 policy retrieval / A3 tool call → A1 compose → persisted trace.
- **Grounding & safety model** — verdict taxonomy (FULL / PARTIAL / NONE / BLOCKED / ESCALATE / NOT_IN_POLICY), confirmation gate on MEDIUM/HIGH-risk tools, abstain-by-default.
- **Data model** — sessions, messages, turn traces, trace events, policy chunks (vector), HR entities.
- **Design decisions with tradeoffs** — the long form of the README list, including: pure-code orchestrator over LangChain/CrewAI; two model tiers (reasoning model for A1, cheaper for A2/A3); strict JSON contracts per agent; RAG over pgvector with a similarity floor; trace-first schema; mock HRMS behind a tool interface.
- **What we'd do next for production** — auth/SSO + per-tenant RLS, real HRMS adapters, eval harness on a golden set of turns, prompt versioning + regression gates, rate limits and cost ceilings, PII redaction in traces.

Kept in Markdown as the source of truth; a PDF is generated from it (Step 4) so it can be attached.

## Step 3 — Repo hygiene for the hiring team

- Delete/relocate spec leftovers so the root reads clean (e.g. `src/routes/README.md` if it's stale prompt text).
- Add a `docs/` folder holding `ARCHITECTURE.md` and screenshots.
- Add `.env.example` documenting required variables with no secret values.
- Note on commit history: I can't run git here. History is cleaned on your side — connect GitHub via the + menu, then squash/rebase the sync commits into a small logical series (`chore: scaffold`, `feat: engine`, `feat: ops console`, `docs: readme + architecture`). I'll include the suggested commit sequence in the plan output.

## Step 4 — Generate the PDF + QA

- Render `docs/ARCHITECTURE.md` to `Architecture_Brief.pdf` (single page, brand colors: Darwinbox Pink #E61E50, Blue #1A1F2C, Grey #8E9196), delivered as a downloadable artifact.
- Convert each PDF page to an image and inspect for clipping, overflow, unreadable diagram, and page-count creep before handing it over.

## Order of execution

Step 1 → Step 2 → Step 3 → Step 4. Nothing in the running app changes; this is documentation and repo cleanup only.
