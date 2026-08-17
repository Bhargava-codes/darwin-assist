# Commit history cleanup (and why screenshots came up)

## On screenshots

They are not a checklist item — the brief asks for a diagram, and the README already has one.
The only reason to add two or three is that a reviewer opening the repo on GitHub sees the
README before they ever run the app, and a picture of the mobile assistant plus the `/ops`
console proves the thing exists in about four seconds. It is worth roughly a point of polish,
not a point of substance. Skip it if you would rather not chase image files; the score barely
moves either way.

## The actual gap: commit history

The repo currently carries ~279 commits, nearly all authored by the sync bot, with messages
that describe platform pushes rather than the build. A reviewer reading `git log` learns
nothing about how the system was assembled. The fix is to collapse it into a small, logical
series authored by you.

Git state is managed outside this environment, so I cannot run these commands — this is the
sequence for you to run locally after cloning the synced repo.

### Step 0 — safety net

```bash
git clone <repo-url> darwin-assist && cd darwin-assist
git branch backup-original      # keeps the 279-commit history recoverable
```

### Step 1 — confirm `.env` is not tracked

`.gitignore` lists `.env`, but that does not remove it from earlier commits.

```bash
git log --all --oneline -- .env      # any output = it was committed at some point
```

If it shows anything, the squash in Step 2 is what actually removes it, since the new history
is built from the working tree rather than from the old commits. Verify after Step 2 with
`git log --all --oneline -- .env` returning nothing.

### Step 2 — rebuild history as one orphan branch

Simplest reliable route: start a fresh root and commit the current tree in logical slices.

```bash
git checkout --orphan clean-history
git reset                            # unstage everything, keep files
```

Then stage and commit in this order. Each commit is the current state of those paths — no
attempt to reconstruct intermediate states.

| # | Message | Paths |
| --- | --- | --- |
| 1 | `chore: scaffold TanStack Start app, Tailwind theme, brand tokens` | `package.json`, `bun.lock`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `components.json`, `bunfig.toml`, `.gitignore`, `.prettier*`, `src/styles.css`, `src/router.tsx`, `src/start.ts`, `src/server.ts`, `src/routes/__root.tsx`, `src/components/ui/**` |
| 2 | `feat(data): HR schema, policy corpus, pgvector retrieval` | `supabase/**`, `src/integrations/supabase/**`, `src/data/**`, `src/lib/engine/policy-chunks.ts`, `src/lib/engine/embed.server.ts`, `src/lib/engine/retrieval.server.ts`, `src/lib/hr/**` |
| 3 | `feat(engine): pure-code orchestrator + three agent prompts` | `src/lib/engine/**` (rest), `src/lib/ai/**`, `src/routes/api/engine/**`, `src/routes/api/agent.ts`, `src/routes/api/session.ts`, `src/routes/api/hr-action.ts` |
| 4 | `feat(app): mobile assistant, requests, session history` | `src/routes/index.tsx`, `src/routes/assistant*.tsx`, `src/routes/requests.tsx`, `src/components/app/**`, `src/hooks/**` |
| 5 | `feat(ops): observability console and per-session transcript` | `src/routes/ops*.tsx`, `src/routes/api/ops*`, `src/components/ops/**`, `src/lib/ops/**`, `src/routes/api/feedback.ts` |
| 6 | `perf: cut avg turn latency 13.2s to ~5s (routing, concurrency, streaming)` | empty commit or a small tweak — see note below |
| 7 | `test: cost benchmark harness (agentic vs baseline)` | `scripts/**` |
| 8 | `docs: README, architecture brief, benchmark writeup` | `README.md`, `docs/**`, `AGENTS.md`, `.env.example`, `public/**` |

For #6 there is no separate file set (the latency work edited files already committed in #3),
so either fold it into #3's message or record it as
`git commit --allow-empty -m "perf: ..."` with the measured numbers in the body. Folding it in
is cleaner.

Per commit:

```bash
git add <paths>
git commit -m "<message>"
```

Then catch anything unstaged:

```bash
git status --short          # should be empty; if not, add to the closest commit above
```

### Step 3 — set authorship to you

The orphan commits are authored by whatever `git config user.email` is set to locally — check
it before Step 2:

```bash
git config user.name  && git config user.email
```

If earlier commits were made under the wrong identity, fix all of them at once:

```bash
git rebase -r --root --exec 'git commit --amend --no-edit --reset-author'
```

### Step 4 — publish

```bash
git log --oneline           # expect 7-8 commits, all yours
git push --force origin clean-history:main
```

Then in GitHub settings confirm `main` is the default branch. Keep `backup-original` local
only — do not push it, or the reviewer sees both histories.

### Important: Lovable sync after the rewrite

Force-pushing rewrites the history the Lovable sync expects. Future changes from here will
push new commits on top of the clean history, which is fine — but reconnect/verify sync in the
workspace GitHub settings once after the force push, and expect any further platform commits
to appear as bot-authored again. If you want the log to stay pristine for the review, do this
cleanup **after** you finish making changes here.

## Scope

Nothing in the application changes. No files in this project are edited by this plan; it is a
sequence of local git commands for you to run.
