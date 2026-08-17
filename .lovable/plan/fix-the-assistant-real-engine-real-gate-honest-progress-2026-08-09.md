# Fix the Assistant: real engine, real gate, honest progress

## What went wrong

Your turn is in the audit log. "can i take leave tmrw" was classified as *apply leave*, a preview (dry-run) of `apply_leave` was run, and the reply narrated that preview as if it had happened:

> "Your Casual Leave request for 10 Aug 2026 was submitted with Pending status. Remaining balance: 7."

Nothing was submitted. There is no leave request for 10 Aug in the database, and your CL balance is still 8. The screen also showed a Confirm card under a message claiming the thing was already done.

Cause: the Assistant screen still talks to the old agent stack (`/api/agent`), not the new engine that runs Agent 1 v8 / Agent 2 v1 / Agent 3 v1 with a code-enforced confirmation gate and receipts that can only come from real tool results.

## What we build

### 1. Assistant runs on the engine

Point the Assistant screen at the engine turn endpoint. The old `/api/agent` path and its prompts are retired so there is one agent stack, not two.

Consequences, by construction rather than by prompt wording:
- A write happens only after Confirm. There is no code path that writes on a question.
- Every receipt is Agent 3's report of an actual tool result. A preview can never be phrased as done.
- Every figure and citation comes from Agent 2 or Agent 3 in the same turn.

### 2. Order of operations for "can I take leave tomorrow?"

```text
1. Read your record        Agent 3 read  → balance, upcoming requests, attendance
2. Check the policy        Agent 2       → verdict + verbatim clause
3. Eligible? build action  Agent 1       → read-back of exactly what will be filed
4. You tap Confirm         gate          → nothing is filed before this
5. File it, report back    Agent 3 write → receipt: request id, dates, status
```

If policy says no, it stops at step 3 with the decisive clause and the honest reason — no confirm card.

### 3. Progress you can actually read

The turn takes seconds across three agents, so the wait gets narrated with real stage events streamed from the orchestrator as each step completes — not a fake timer. One line at a time, replacing the previous:

- "Looking up your leave record…"
- "Checking the leave policy…"
- "Working out whether tomorrow clears…"
- "Filing your request…" (only after Confirm)
- "Getting your receipt…"

Copy rules: present participle, one clause, under six words, no jargon ("Agent 2", "RAG", "tool"), no fake precision ("87% done"). If a stage runs long, the line stays — it never resets to a generic spinner.

### 4. Confirm card copy

The card states what will be filed and nothing else: leave type, dates in full ("Monday, 10 August 2026"), working days, reason, and balance after. Buttons: **Confirm** / **Change** / **Cancel**. The message above it says what *will* happen, future tense — never past tense.

After Confirm, the receipt is one sentence in Agent 3's voice with the request id and status, plus the receipt rows.

## Technical notes

- `src/lib/hr/store.tsx`: replace the `/api/agent` client with the engine turn client — session id, transcript, pending action, trace. Keep the existing context API surface (`send`, `confirm`, `cancelPending`) so the screen's structure holds.
- `src/routes/api/engine/turn.ts`: stream the turn as newline-delimited JSON. Each orchestrator step emits a `{ stage }` frame; the final frame carries the full turn response. Non-streaming callers keep working via the same handler shape.
- `src/lib/engine/orchestrator.server.ts`: add an optional `onStage` callback next to the existing trace-event recorder — same call sites, no logic change.
- `src/routes/assistant.tsx`: render the streamed stage line in place of the current busy state; confirm card and receipt rendering read the engine's `pending` and `receipt` shapes.
- Retire `src/routes/api/agent.ts`, `src/lib/ai/agents.server.ts`, and `src/lib/ai/prompts/*` once the screen is switched over. Trace and Requests screens repoint to the engine tables.
- The stale confirm cards from the broken turns stay in history; new turns are correct.

## Verification

1. "can i take leave tmrw" → eligibility answer with clause, confirm card in future tense, **no** database write.
2. Tap Confirm → a real row appears for 10 Aug, receipt matches it, balance moves 8 → 7.
3. Ask again → the engine reports the overlap with the existing request instead of filing a duplicate.
4. Stage lines appear in order and match what the trace log says actually ran.
