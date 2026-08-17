# Darwinbox HR Assistant — Mobile Conversational Prototype

A mobile-first (390×844) HR self-service app for one employee (Bhargava). Conversational assistant as the hero surface, plus tap-first screens for leave, attendance and WFH over the same in-memory data. Real AI powers the three agents; all HR records stay in memory (no backend database).

## Build order

1. **Tokens + shell** — Darwinbox palette (deep-violet primary, ~#6C2BD9 family, with your specified neutrals) as CSS custom properties in `src/styles.css`; Inter; 12px card radius; 36px pill chips; 200ms ease-out motion. Bottom tab bar with 4 tabs (Home, Assistant, Requests, Trace), Assistant visually centred and larger.
2. **Data layer + 11 tools** — seeded employee, balances, ~6 leave requests, a month of attendance with 2 flagged days, 3 upcoming WFH days. All 11 tool functions with risk ratings and injected failures: TIMEOUT on ~1-in-5 first `check_leave_balance` calls (retry ×2 with backoff), INSUFFICIENT_BALANCE and CAP_EXCEEDED never retried.
3. **Requests tab (full CRUD)** — segmented Leave/Attendance/WFH, status-grouped cards, swipe-to-cancel on Pending, detail sheet with Edit/Cancel, FAB → bottom sheet (~85%, drag handle, live eligibility hint, ineligible options disabled, read-back step). Attendance: month calendar strip, flagged-day list, regularization sheet with mandatory reason, "1 of 3 used" header. WFH: usage bar, upcoming list, cancel.
4. **Policy corpus + retrieval gate** — clause-aware corpus file chunked by subsection (1.1…3.4), each chunk self-contained with heading and `clause_id`. Seeded now with the section-8 key facts as verbatim clauses; you paste the full manual into that one file later with no code changes. Retrieval scores candidate chunks, applies the ~0.75 similarity threshold and an entity/subject match check, and returns NOT_IN_POLICY when either fails.
5. **Agents (real AI)** — three server-side agents on Lovable AI:
   - Agent 1 — conversation & orchestration: intent classification (all 12 intents incl. `unmatched`), slot ladder (given → computed → inferred → probed), dates before type, one probe per turn, max 3 probes, verdict judging (FULL/PARTIAL/NONE/UNKNOWN), reply composition. Prime directive in its system prompt: never originates a fact.
   - Agent 2 — policy RAG: `{user_question, subjects[]}` → per-subject `text_verbatim` + `clause_id`, or NOT_IN_POLICY. Never sees employee attributes.
   - Agent 3 — tool executor: one tool per request, verbatim results, MISSING_PARAMETERS instead of defaults, confirmation_token required for MEDIUM/HIGH risk.
   Grounding enforced in code as well as prompt: threshold gate, entity match, verbatim passthrough, policy-beats-prior-knowledge, no hedging words. PARTIAL requires a scalar gap; alternatives only from `eligible_types` / `alternates_with_balance`.
6. **Assistant tab UI** — chat bubbles (user right in primary-light, assistant left on surface with border), quick-reply chips under the latest assistant message, clause citation badges expanding to verbatim text, confirmation cards with Confirm/Change, calm abstention card with [Raise with HR], three-dot typing indicator, pinned input bar with mic stub. Confirmation hard rule: only a tapped Confirm or explicit yes/confirm/go ahead/proceed commits; "ok/sure/hmm/haan/thik hai" re-asks once then abandons the action while keeping slots. Read-only interjections answered mid-flow, then the flow resumes.
7. **Trace tab** — developer-tool aesthetic, monospace values, code-block cards. Per turn: turn number, user message, agent pipeline (1 → [2 ‖ 3] → 1), per-step model/input/output/latency/tokens/cost, verdict badge, retrieved chunks with scores (below-threshold struck through), tool calls with params/result/error code/attempts, expandable JSON. Session totals plus a Baseline-vs-Optimised cost-delta toggle.
8. **Home tab** — gradient greeting band, large Clock in/out button with elapsed time, horizontally scrollable balance cards deep-linking into filtered Requests, "Ask the assistant" field that carries typed text into the Assistant tab, pending-requests summary with status chips.
9. **Demo polish** — verify the five demo-script flows end to end: policy-filtered probe (15–20 June), PARTIAL on 10 days CL, cited carry-forward answer, sabbatical abstention, INSUFFICIENT_BALANCE with attempts: 1.

## Technical notes

- TanStack Start. Tabs are real routes (`/`, `/assistant`, `/requests`, `/trace`) so each has its own head metadata; Requests sub-tabs use search params for deep links.
- Agent calls run in a server route (`/api/agent`) using the Lovable AI Gateway Responses API with `openai/gpt-5.6-sol`, streaming. `LOVABLE_API_KEY` stays server-side; a key is provisioned if missing.
- HR state, tools, retrieval, slot state and trace records live in a client-side in-memory store — nothing persists across reload, which keeps the demo repeatable.
- Retrieval runs server-side over the embedded corpus so Agent 2 receives only candidate clauses, never employee data.
- Policy corpus lives in one file (`src/data/policy-corpus.ts`) as the single paste target for the full manual.
