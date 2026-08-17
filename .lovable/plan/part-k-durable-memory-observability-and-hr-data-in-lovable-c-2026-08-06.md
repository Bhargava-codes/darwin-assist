# Part K — Durable memory, observability, and HR data in Lovable Cloud

Today everything lives in React state: HR records, chat history, slots and traces all vanish on reload, and retrieval embeds the corpus into a per-process memory cache. This moves all of it into the backend exactly as your Part K schema defines, keeps the app auto-signed-in as Bhargava, and splits the developer trace out into an HR Ops console.

## 1. Enable Cloud and apply the schema

One migration, in your order: extensions (`vector`), enums, HR tables, conversation memory (`conversations`, `messages`, `session_slots`), append-only observability (`turn_traces`, `agent_steps`, `retrieval_logs`, `tool_calls`), `policy_chunks` with ivfflat, `match_policy_chunks`, the four ops views, RLS with `current_employee_id()` / `is_hr_ops()`, and the indexes.

Two additions your SQL needs to actually work on this platform, no behaviour change:

- Every new public table also gets explicit `GRANT`s (Data API refuses access without them) and `service_role` grants, since trace writes come from the server.
- `for all` policies get a matching `with check` alongside `using`, otherwise inserts are rejected even for the owning employee.
- Ops views are created with `security_invoker = on` so they inherit the caller's RLS instead of the view owner's.

Seed data goes in the same migration as literal INSERTs: Bhargava (E-4471, `is_hr_ops = true` so he can also open /ops), his FY26 balances, ~6 leave requests, a month of attendance with 2 flagged days, 3 upcoming WFH days.

## 2. Sign-in

An anonymous-free demo path: on first load the app signs the demo user in with a fixed seeded email/password (auto-confirmed), so every query runs under a real `auth.uid()` and RLS is genuinely enforced rather than bypassed. No login screen; a one-time "Signing you in" state on first paint.

## 3. Policy corpus moves to pgvector

- The corpus in `src/data/policy-corpus.ts` becomes the seed source: each subsection is inserted into `policy_chunks` with `policy_version = 'FY26-v2'`, `clause_id`, `policy_area`, `subject` (`LEAVE.CL` style), `heading`, verbatim `content`.
- Embeddings are generated once by a server-side admin seeding endpoint using `openai/text-embedding-3-large` with `dimensions: 1536`, matching your `vector(1536)` column and the ivfflat cap. It is idempotent: rows missing an embedding get one, existing rows are left alone.
- Per turn, only the query is embedded; `match_policy_chunks` does the subject filter, the 0.75 threshold and the ranking in SQL. Zero rows returned = `NOT_IN_POLICY`, so Agent 2 is never invoked on below-threshold context.
- The current in-memory keyword scorer stays as a labelled fallback only if the embeddings call fails, and Trace records which mode produced the scores.
- Threshold note: raw cosine on this model for genuinely relevant clauses sits well below 0.75. So the SQL gate runs at a calibrated-equivalent raw threshold tuned against the real corpus, and both raw and calibrated numbers are logged, so the sabbatical question still abstains and the carry-forward question still cites §1.4.

## 4. Turn lifecycle on the server

`/api/agent` stops taking HR state from the client. It receives `{ conversation_id | null, message, confirm }` and runs your 11 steps: upsert conversation → insert user message → read `session_slots` → open `turn_traces` → Agent 1 classify → parallel retrieval + Agent 2 + Agent 3 (each `agent_steps` row stamped with `started_at` so the overlap is provable) → Agent 1 judge/compose → write `session_slots` → insert assistant message with chips and `clause_refs` → close trace totals with both `cost_optimized_usd` and `cost_baseline_usd` from the same token counts → roll up conversation totals.

Tools read and write the real tables instead of the in-memory object, so a submitted leave request shows up in Requests and survives a reload. `pending_confirmation` in `session_slots` becomes the confirmation gate; an ambiguous acknowledgment clears it while retaining `slots` (D15). `paused_intent` / `paused_slots` carry the read-only interjection lock.

Abstention with [Ask HR] writes an `hr_tickets` row with the offramp code and D-line.

## 5. App surfaces

- **Employee app drops to 3 tabs**: Home, Assistant, Requests. Home and Requests read from the database; the Assistant restores the last active conversation on load, so chat history and half-filled slots survive a reload.
- **`/ops`** (HR Ops only, gated on `is_hr_ops`): conversation list from `ops_conversations`, a conversation detail view with the turn-by-turn trace — agent steps with model/tokens/latency and a timeline that shows Agent 2 and Agent 3 overlapping, retrieved chunks with similarity and pass/fail, tool calls with params/error/attempts — plus `ops_coverage_gaps` (what your policy fails to answer, ranked by demand), `ops_grounding`, and `ops_cost_summary` with the baseline-vs-optimised percentage.

The existing Trace tab's card design carries over into the /ops conversation detail view, so nothing built so far is thrown away.

## 6. Verification

After the change, run the demo flows in a browser: the 15–20 June probe, PARTIAL on 10 days CL, the cited carry-forward answer, the sabbatical abstention, and INSUFFICIENT_BALANCE with `attempts: 1` — then reload mid-flow and confirm the conversation and slots come back, and check /ops shows the trace, overlapping agent windows, and a coverage-gap row for "sabbatical".

## Technical notes

- Retrieval, embeddings and all trace writes stay server-side behind `/api/agent` and a seeding route; `LOVABLE_API_KEY` and the service role never reach the browser.
- Employee-facing reads go through the browser client under RLS; trace writes use the service-role client (RLS bypassed), and /ops reads go through RLS as the HR Ops user, matching your note.
- Not built, per your §11: no vector search over chat history, no slots-history table, no soft deletes, no models table, no partitioning.
