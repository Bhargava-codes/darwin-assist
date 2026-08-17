# Latency definition cleanup for Ops Sessions

## Current state
- In `/api/ops/engine-sessions.ts`, the `latency_ms` field for each session is currently the **sum of every trace event's `latency_ms`** in that session.
- In the Sessions table (`/ops`) this number is rendered as seconds with the column header "Latency".
- Because Agent 2 (RAG) and Agent 3 (tools) run in parallel, summing their step latencies overstates the wall-clock wait the user actually feels.
- The top-level `/api/ops` metrics already compute honest per-turn P95s, but the Sessions row-level metric is ambiguous.

## What we will change
1. **Row-level latency = average latency per turn**
   - Compute `latency_ms / turn_count` for each session in `/api/ops/engine-sessions.ts`.
   - This matches the user's expectation: the average wait the employee experiences each time they send a message.
2. **Add a separate "Duration" column for wall-clock session length**
   - Compute `last_active_at - created_at` in milliseconds.
   - This represents the total real-world time of the conversation, independent of model step sums.
3. **Rename the Sessions table column**
   - Change "Latency" to "Avg turn latency".
   - Add a tooltip/hint: "Average model latency per employee turn in this session."
4. **Keep the transcript detail view unchanged**
   - Step-level latencies inside the transcript/Trace log/Waterfall tabs remain the raw per-step numbers, which is correct for debugging.

## Industry-standard framing we will expose
- **Avg turn latency** (per-turn average) — what the user feels each reply.
- **Session duration** (wall-clock) — total conversation length.
- **P95 per-turn latency** — already in the top Technical section; remains the percentile view.
- **TTFT / TBT** are not currently instrumented at the token level and are out of scope for this fix.

## Files to edit
- `src/routes/api/ops/engine-sessions.ts`: change aggregation math, add `duration_ms`.
- `src/routes/ops.index.tsx`: update column header, add Duration column, render avg latency.
- `src/components/ops/transcript.tsx`: update Config panel labels from "Total latency" to "Avg turn latency" and add "Session duration".

## Acceptance criteria
- Sessions table shows "Avg turn latency" and "Duration" columns.
- The avg turn latency value equals `total_step_latency / turn_count`.
- The duration value equals `last_active_at - created_at`.
- No change to transcript step-level latencies.
