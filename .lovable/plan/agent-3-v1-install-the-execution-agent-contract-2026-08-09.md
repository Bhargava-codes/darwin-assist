# Agent 3 v1 — install the execution agent contract

Agent 3 today is a thin tool *picker*: it names one tool and its arguments, the orchestrator runs it, and the orchestrator writes the employee-facing sentence itself. The v1 prompt makes Agent 3 the accountable reporter of the operation — it must return the system's result verbatim, map failures to a fixed code list, and own the one sentence the employee reads after a confirmed action.

## What changes

1. **Prompt installed verbatim.** The v1 text (§1–§11) replaces the interim Agent 3 prompt, unedited.
2. **Two-phase invocation, one operation.** Because tool execution lives in the orchestrator (pure code), one Agent 3 invocation becomes: (a) select the single tool + arguments, (b) after the orchestrator runs it, report the §10 object from the tool result. The retry budget stays exactly as v1 requires — one retry for transient failures only, never for a definitive rejection — and `attempts` is reported as 1 or 2, never more.
3. **Read mode.** Agent 3 returns the tool's data untouched, `user_message: null`. Agent 1 receives the full result rather than a hand-written summary, so no figure is re-typed on the way through. Empty history stays a successful empty result, not "not found". A balance of 0 stays data.
4. **Execute mode (after Confirm).** Agent 3's own one-sentence `user_message` becomes the reply the employee sees, and the receipt is returned in full — request id, recorded values, resulting state — instead of only id + status. An idempotent duplicate is reported as success with the existing receipt.
5. **Failure reporting.** The orchestrator's hand-written failure copy for confirmed writes is replaced by Agent 3's mapped outcome: one code from the v1 list (`NOT_FOUND`, `INVALID_DATE_RANGE`, `INSUFFICIENT_BALANCE`, `CAP_EXCEEDED`, `OVERLAP`, `ALREADY_APPROVED`, `PAST_DATED`, `RETRIES_EXHAUSTED`, `VALIDATION_FAILED`, `UNMAPPED`), the system's own message verbatim as detail, and one plain sentence with no next steps or alternatives. Anything unrecognised or half-formed reports `UNMAPPED` rather than being dressed as success.
6. **Structural validation only.** A missing or wrong-shaped required argument returns `VALIDATION_FAILED` listing every offending field and makes no tool call. Agent 3 never fills, coerces, or reformats a value, and never re-checks policy.
7. **Guardrail kept.** The confirmed pending action stays the system of record: the write executes with the held tool and held arguments even if Agent 3 names something else, and that mismatch is traced.

## Trace and observability

Each Agent 3 phase records its own trace event, and the reported object (mode, status, error code, attempts) is stored so `/engine` and `/ops` show exactly why a write succeeded or failed.

## Technical notes

- `src/lib/engine/prompts/a3.ts`: prompt replaced verbatim; add the §6.2 input builder (`mode`, `request`, `payload`) and the §10 report schema/type. Existing tool-signature and argument-name maps stay — they keep Agent 3 from guessing field names.
- `src/lib/engine/orchestrator.server.ts`: read path and `runConfirm` gain the report phase; `executeWithRetry` reports attempts and the transient/definitive split to Agent 3; `ERROR_COPY` narration for confirmed writes retires; findings passed to Agent 1 carry the verbatim read data.
- No schema or UI changes needed.

## Verification

End-to-end API checks: balance read (data verbatim, no `user_message`), empty request history (ok + empty), confirmed leave apply (full receipt + one sentence), insufficient balance on execute (`INSUFFICIENT_BALANCE`, verbatim detail, no alternatives offered), re-confirm of an already-applied action (duplicate reported as success), and a missing-argument case (`VALIDATION_FAILED` with no tool call).
