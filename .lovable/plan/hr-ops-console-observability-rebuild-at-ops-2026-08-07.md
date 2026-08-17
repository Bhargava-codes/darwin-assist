# HR Ops Console — observability rebuild at /ops

Rebuild `/ops` as a desktop instrument-style dashboard matching the supplied spec exactly, then wire every number to the existing backend.

## Current state (verified)

- `/ops` today is a mobile-width card list (rounded corners, shadows) — it will be replaced wholesale.
- Backend has real audit data but only demo-scale: 1 conversation, 12 turns, 32 agent steps, 9 retrieval logs, 1 tool call.
- No `feedback` table exists. No thumbs up/down control anywhere in the app.
- Existing ops views (`ops_conversations`, `ops_cost_summary`, `ops_coverage_gaps`, `ops_grounding`) don't cover the new metrics; the new console queries the base tables directly.

## What gets built

### 1. Design tokens + shell
Add the ops palette (violet/teal/amber/emerald/rose + slate scale) as tokens in `src/styles.css`. Ops surfaces use zero border-radius, 1px borders, no shadows, mono + tabular-nums for every number, `gap-px` hairline grids. The mobile shell (430px container, bottom tabs) is bypassed for `/ops` so it renders full-width desktop.

Dark top bar (slate-900, 100px): `▎▎▎ hrlens` + `darwinbox · prod`, centered search field with `Cmd K` chip, 28px violet `HR` square. Below: breadcrumb, "Agent health", subtitle.

### 2. Reusable pieces
`Metric` (label / value / sub, big + normal sizes), `Tip` (Info icon + dark hover popover, keyboard focusable), `SectionHead` (faint number, uppercase title, lowercase hint), `AgentBar` (2px colored square, A1/A2/A3, proportional div bar, right-aligned value + count), `AgentDot`.

### 3. Sections 01–04 (visual first, seed values)
- **01 Value** — Deflection (emerald, hero), Explicit feedback with 2px stacked emerald/rose/slate bar, D7 retention.
- **02 Engagement** — Conversations, AHT.
- **03 Technical** — four latency tiles (per-turn lead, Turn 1, Turn 2, greyed session total); per-agent latency panel (bars scaled to 4000ms); Tool calls + RAG pulls counters.
- **04 Cost** — 1/3 column with cost/session and 7-day total; 2/3 cost-split-by-agent panel with $ and %.

Every metric gets its spec tooltip copy verbatim.

### 4. Section 05 sessions table
Full-width table (Session | Intent | Latency | A1 | A2 | A3 | RAG | Tools | FB), chevron + hover-highlight focusable rows, `scroll-x` at narrow widths. Row expands to a slate-50 nested panel listing every step across turns (agent-colored left border, `T{turn}`, agent chip, role, tool chip, latency); a step expands to a two-column input | output JSON panel at 11px mono. Footer: "Showing N of M sessions."

### 5. Feedback capture
New `feedback` table (conversation_id, turn_index, rating up|down, note) with RLS + grants: employees write/read their own rows via their conversation, HR Ops reads all. Add a thumbs up/down control to each assistant message in the employee assistant screen, writing through a server route.

### 6. Seed + wire
Seed ~42 conversations across the last 7 days with realistic intent mix (leave_apply, leave_read, policy_qa, attendance_regularize, wfh_apply, leave_cancel), ~78% RESOLVED with a few ESCALATED/ABANDONED, plus their turn_traces, agent_steps (with raw_input/raw_output JSON), retrieval_logs, tool_calls and feedback rows — tuned so the metrics land near the spec's scale (86% deflection, 42 sessions, 2.52s per-turn, $0.612 total).

Then replace hardcoded values section by section with real queries — no restyling during the data pass.

## Technical notes

- Metrics are computed server-side in `src/routes/api/ops.ts` (rewritten): HR-Ops-gated, service-role reads, one payload with `value`, `engagement`, `technical`, `cost`, `sessions[]` (each with `steps[]`). P95s and per-turn latency are computed in SQL via a read-only RPC (`ops_metrics`) so percentiles aren't done in JS.
- Bars stay plain divs; no chart library. Icons from lucide-react.
- Seed data goes in as a data insert, feedback table + RPC as migrations.
- `prefers-reduced-motion` respected; rows are real `<button>`/focusable elements.

## Assumption to flag

The 42 seeded conversations are synthetic demo data written into the live tables (attributed to the demo employee). If you'd rather keep the tables clean and see only real traffic, say so and I'll skip the seed — the console will simply show small numbers until usage accumulates.
