# Update the three docs from the uploaded files

Replace the repo's docs with the uploaded versions, verbatim. GitHub sync picks
them up automatically once the change lands — no separate push step.

| Uploaded file | Goes to | Repo copy today | Uploaded |
| --- | --- | --- | --- |
| `README.md` | `README.md` (root) | 17,136 bytes | 21,616 bytes |
| `ARCHITECTURE.md` | `docs/ARCHITECTURE.md` | 6,705 bytes | 7,598 bytes |
| `BENCHMARK.md` | `docs/BENCHMARK.md` | 5,081 bytes | 7,097 bytes |

## What the uploaded versions add

All three are supersets of what's in the repo — no content is being dropped.

- **README.md** — embedding config paragraph (`text-embedding-3-small`, 1536 dims,
  batch 64, `chunk_id` = manual clause ID, verbatim chunk text); a table of the two
  code-chosen retrieval paths (`policy_qa` vs `rule_check`) and why `rule_check`
  exists; the modelled −27.1% prompt-caching section with its line-by-line
  arithmetic; the two-denominators note ($0.0173/turn harness vs $0.0213/session
  live); and the Darwinbox-scale volume table.
- **ARCHITECTURE.md** — a new enforcement point 0 on code-side retrieval routing
  and clause-level auditability, and the cost paragraph rewritten to size the
  caching lever ($0.682 across 32 sessions, A1 = 60%, projected $0.0155/session)
  instead of only naming it.
- **BENCHMARK.md** — the header now scopes §1–§3 as measured and §5 as modelled;
  a new §5 "Modelled: prompt caching on A1 (−27.1%)" with actor-level spend split
  and stated assumptions; and §6 reframed as a scale band.

## How

Extract the three files from the upload and write them over the existing paths as
exact copies — no editorial changes, no merging. Nothing else in the repo is
touched: no source, config, or `docs/` files beyond the two named above.

## Verification

- Byte sizes of the three files match the uploaded ones.
- `docs/ARCHITECTURE.md`'s `[BENCHMARK.md](BENCHMARK.md)` link still resolves, and
  the README's `docs/` links are unchanged.
