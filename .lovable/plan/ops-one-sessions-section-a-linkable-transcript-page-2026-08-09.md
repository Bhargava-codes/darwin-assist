# Ops: one Sessions section + a linkable transcript page

## What changes

1. **Merge the two session tables.** Sections 05 ("Sessions") and 06 ("Engine sessions") collapse into a single section 05 titled **Sessions**, fed by the engine log so it always renders even when the legacy metrics feed is unavailable.
2. **No more inline expand.** Clicking a row navigates to a unique, shareable URL: `/ops/sessions/<session_id>`.
3. **Latest first.** Rows are ordered by last activity descending, so the newest session_id is the first row. The search/filter box (session_id, employee_code, first message) stays.
4. **New transcript page** at `/ops/sessions/<session_id>`, laid out like the reference screenshot.

## Sessions table columns

Session ID · Latency · A1 · A2 · A3 · RAG · Tools · Feedback · Cost · First message

- Per-agent counts, RAG, Tools, Latency and Cost are derived from `trace_events` for that session.
- Feedback comes from the recorded rating for the session; shows a dash when none.
- First message is the employee's opening line, truncated.

## Transcript page

Header: session_id (with copy), employee code/name, turn count, total cost, total latency, created / last-active timestamps, and a Back link to Ops.

Tab bar in the reference style: **Transcript** (default), **Trace log**, **Waterfall**, **Config**.

- **Transcript** — full turn-by-turn sequence in chronological order, interleaving user messages, agent output and every agent interaction:
  - User messages: left-aligned tinted bubble, timestamp above.
  - Assistant (A1) reply: right-aligned bubble with small meta chips (agent, model, latency).
  - A2 policy and A3 tool steps: centered system-note blocks between the bubbles, showing actor, action, verdict/status and latency; each expandable to the raw input/output JSON.
  - Tool executions render as a bordered card with the tool name, a status pill and the args/result payload — matching the card in the screenshot.
  - A "Hide system & tool steps" toggle to switch between the pure conversation and the full instrumented sequence.
- **Trace log** — the flat step list (turn, actor, action, model, status, latency, cost) with expandable input/output; this is the current expand-row content, relocated.
- **Waterfall** — per-turn horizontal bars showing each step's latency, colour-coded by agent, so parallel A2/A3 work is visible.
- **Config** — models used, baseline mode flag, and retrieval settings for the session.

Empty and error states: a plain "No steps recorded yet" / "Could not load this transcript" line, plus a 404-style message for an unknown session_id.

## Technical notes

- `src/routes/api/ops/engine-sessions.ts`: extend the list response with the derived per-session aggregates (intent, latency_ms, per-agent counts, rag, tools, feedback) so the merged table has one data source. The `?session_id=` branch already returns events + messages; add session metadata (employee, timestamps, turn count, cost) to that payload for the transcript header.
- `src/routes/ops.tsx`: delete `SessionRow`, `StepRow`, `EngineTrace` and the old section 05 table; keep sections 01–04 unchanged. The new `Sessions` section reuses `SectionHead` and the existing hairline table styling, rows as `<Link to="/ops/sessions/$sessionId">`.
- New route `src/routes/ops.sessions.$sessionId.tsx` with `createFileRoute("/ops/sessions/$sessionId")`, its own `head()` metadata, fetching from `/api/ops/engine-sessions?session_id=...`.
- Transcript rendering primitives live in a new `src/components/ops/transcript.tsx` to keep the route file small; reuse `AGENT_META` colours from `src/components/ops/primitives`.
- No schema changes, no changes to the assistant/engine runtime.
