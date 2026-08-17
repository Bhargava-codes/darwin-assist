# UX copy pass — Darwinbox HR Assistant

Copy-only rewrite. No logic, data, or agent-behaviour changes.

## Voice

Calm, plain, colleague-like. Second person ("you", "your"). Short sentences, verb-first buttons, no exclamation marks, no jargon ("regularize" stays only where it's the official HR term, always paired with a plain-language hint). Numbers do the reassuring, not adjectives.

## Home

- Greeting keeps the date line, but the sub-line becomes purposeful: "Hi Amit" + "Here's where you stand today."
- Clock card: idle state "You haven't clocked in yet" instead of "Not clocked in"; after clock-out "You clocked out at 6:42 PM". Button labels stay "Clock in" / "Clock out".
- Leave balance section: header "Your leave balance"; each card gets a full word under the code (Casual, Sick, Earned) and reads "8 left of 12" instead of "of 12".
- WFH / regularization cards: "Work from home · 2 of 4 used this month", "Attendance fixes · 1 of 3 used this month".
- Pending section: header "Waiting on your manager"; empty state "Nothing waiting for approval right now."
- Ask bar placeholder: "Ask about leave, attendance or WFH".

## Assistant

- Header: title "Assistant"; sub-line "Answers come straight from your HR policy, with the clause attached."
- Empty state: "What do you need today?" + "Ask about leave, attendance or working from home — or start with one of these."
- Verdict badges get plain-language labels next to the code so users aren't decoding acronyms: FULL → "Allowed", PARTIAL → "Needs a change", NONE → "Not allowed", UNKNOWN → "Not in policy".
- Clause badge: keep the clause ID, add a "View clause" affordance so the toggle is obvious.
- Confirmation card: "Check this before I submit"; buttons "Confirm and submit" / "Edit details".
- Abstention card: "I couldn't find this in your HR policy, so I won't guess. Your HR team can confirm." Button "Ask HR".
- Ambiguity nudge: "I need a clear yes before I submit this — tap Confirm, or reply 'yes'."
- Typing state and error line get human phrasing: errors read "Something went wrong. Try sending that again."

## Requests

- Header/sub-line: "Requests" + "Everything you've asked for, and where it stands."
- Filter chips stay short; "Past" becomes "Closed".
- Empty states per tab: "No leave requests yet.", "Nothing to fix here — your attendance is clean.", "No work-from-home requests yet."
- Sheets: titles "Apply for leave", "Fix an attendance day", "Request work from home"; optional fields labelled "Reason (optional)" rather than a bare "Optional" placeholder.
- Validation toasts: "Pick a start and end date", "Pick a date".
- Success toasts: "Leave request sent to your manager", "Attendance fix sent for approval", "Work-from-home request sent".
- Cancel confirmation toast: "Leave request cancelled".

## Trace

Stays technical — it's a debug surface — but labels get clearer: "Turns", "Cost this session", "Total time". Empty state: "Ask the assistant something and the full reasoning trail shows up here."

## Metadata

Titles and descriptions per route rewritten in the same voice, keeping lengths within SEO limits.

## Technical notes

Files touched: `src/routes/index.tsx`, `src/routes/assistant.tsx`, `src/routes/requests.tsx`, `src/routes/trace.tsx`, and `src/components/app/BottomTabs.tsx` (labels only). Verdict labels map from the existing `Verdict` union in `src/lib/ai/agent-types.ts` via a display-label lookup in the assistant route — the agent contract and returned codes are unchanged. Toast strings for failures still come from tool results; only the app-authored strings change.
