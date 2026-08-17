# Cleaner assistant replies: no clause badges, no rating buttons, friendly chip labels

## What changes

1. **Remove the clause chips** under every assistant reply. The "C-xx / View clause" badge and its expandable clause text disappear from the chat. Answers still come from policy — the citation just isn't shown in the bubble.
2. **Remove "Was this helpful?" thumbs up / down** from every assistant reply.  
This hsould be placed when in the confirmation gating
3. **Make quick-reply chips read like language, not codes.** When the assistant offers a leave-type chip it currently shows `CL`, `SL`, `BL`. These render as the full name instead:
  - CL → Casual Leave
  - SL → Sick Leave
  - EL → Earned Leave
  - ML → Maternity Leave
  - PL → Paternity Leave
  - BL → Bereavement Leave
  - UL → Unpaid Leave
   Chips that already read as sentences ("See my requests", "Apply it") stay untouched. Patterns like `CL (7 available)` or `CL - Casual Leave` are normalised to `Casual Leave (7 available)` / `Casual Leave`.

Everything else on the screen stays as it is.

## Technical notes

- All work is presentation-only, in `src/routes/assistant.$sessionId.tsx`:
  - Delete the `ClauseBadge` and `FeedbackControl` components and their render sites in `AssistantMessage`; drop the now-unused `ChevronRight`, `ThumbsUp`, `ThumbsDown` imports and the `Citation` type import.
  - Add a small `chipLabel()` helper that expands a leading leave code using `LEAVE_TYPE_LABEL` from `src/lib/hr/types.ts` (handles a bare code, a code with a trailing parenthetical, and a `CODE - Name` form).
  - Chips keep sending their original text to the engine (`send(chip)`), so orchestrator/A1 slot-filling behaviour is unchanged — only the visible label differs.
- No changes to the engine, prompts, store, database, or the Ops console. Citations and feedback continue to be recorded server-side; the `/api/feedback` route and trace UI are left in place.