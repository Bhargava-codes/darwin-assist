# Submission re-score + closing the remaining gaps

## Re-score (out of 100)

| Item | Weight | Score | Why |
| --- | --- | --- | --- |
| GitHub repo — clean commit history | 25 | 23 | You rebuilt the history as logical, self-authored commits. Two small unknowns from here: whether `.env` appears in any earlier commit, and whether the repo is public/shared with the hiring team. |
| README (diagram + setup + decisions) | 25 | 24 | 281 lines: ASCII architecture diagram, setup steps, decision matrix with tradeoffs, honest cost benchmark, chunking rationale, build-provenance note. |
| Loom walkthrough (max 10 min) | 25 | 0 | Not recorded yet. |
| Architecture brief (1-page) | 25 | 22 | `docs/ARCHITECTURE.md` is strong but the branded `Architecture_Brief.pdf` is not in the repo, so a reviewer only finds the Markdown — and it runs slightly past one page. |

**Total: 69/100.** Excluding the Loom: 92/100.

## Highest-leverage fixes, in order

1. **Record the Loom (+25).** You are doing this yourself; the script below is the only support needed.
2. **Ship the PDF brief into the repo (+3).** Regenerate `docs/Architecture_Brief.pdf` and link it from the README's docs index, and tighten `ARCHITECTURE.md` to fit one printed page.
3. **Confirm repo hygiene (+2).** Verify `.env` was never committed in the new history (`git log --all --name-only -- .env` should be empty) and that the repo is public. `.gitignore` already excludes it locally.
4. **Optional polish.** A short "worked example" walkthrough (one query traced step by step, labelled AI vs. rule vs. lookup, with the 3 AI calls / 12 rules / 5 lookups count) reads very well to a hiring panel and reinforces the "LLMs decide, code controls" thesis.

## Loom script (10 minutes, timed)

```text
0:00  What it is: HR assistant, three agents, orchestrator is plain code.
0:45  Live demo — leave balance question (fast path, ~5s, streamed reply).
2:00  Live demo — policy + record question: verdict badge, citation, write gate.
3:30  Live demo — off-topic question: abstains instead of inventing a clause.
4:30  Ops console: session list, drill into a transcript, waterfall + trace log.
6:00  Hardest tradeoff: the agentic pipeline costs ~4x a single-call baseline;
      why the grounding guarantee is worth it, and where break-even sits.
7:30  Latency work: 13.2s -> ~5s on reads, what actually moved the number.
8:45  At production scale: prompt caching, per-tenant policy corpora,
      eval harness on verdicts, persistent slot memory.
9:45  Close.
```

## Scope of work here

- Regenerate the one-page PDF brief into `docs/` and link it from README.
- Trim `docs/ARCHITECTURE.md` to a true one-pager.
- Add the worked-example walkthrough section (only if you want item 4).

No app or engine code changes.
