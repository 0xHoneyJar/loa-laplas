# Vendored: construct-clew capture path

These files are vendored **verbatim** from the operator-WIP clew force-chain so
the cycle-053 compose-as-CC-workflow **clew-at-seam** handler has a self-contained
capture primitive (no cross-repo runtime dependency).

- **Source:** `loa-constructs` branch `feat/construct-clew`
- **Pinned commit:** `92b822f631b683749e1b8360af744b4b59092f28`
- **Vendored:** 2026-05-31 (cycle-053)
- **Path at source:** `scripts/clew/`

## What is here (the hot-path capture node only)

| file | role |
|---|---|
| `loa-clew-capture.sh` | marker parser — reads argv **or** stdin (UserPromptSubmit JSON / raw); matches `>>clew@<construct>[/<skill>]: <why>`; appends a learning. Injection-safe: the verbatim quote is assembled in Python, never `eval`'d or shell-interpolated. |
| `ledger-append.sh` | the single `<slug> → ~/.loa/constructs/packs/<slug>/LEARNINGS.jsonl` resolver; validate-then-append under the shared lock. |
| `clew-lock.sh` | stable advisory lock (flock, with a macOS `mkdir` fallback). |
| `learnings-construct.schema.json` | per-line ledger schema. |
| `README.md` | upstream capture-path docs. |

## What is NOT here (cold-path — stays in the canonical repo)

`distill.sh`, `ratify.sh`, `propose-construct-learning.sh`, `surface.sh` — the
distill→ratify→PR force chain is human-gated and crosses the machine boundary only
on explicit `ratify approve`. The seam is the **capture** node only (Draft C §3.3).

## Re-sync

When the operator lands `feat/construct-clew`, re-vendor:

```sh
SRC=/path/to/loa-constructs
for f in loa-clew-capture.sh ledger-append.sh clew-lock.sh learnings-construct.schema.json README.md; do
  git -C "$SRC" show <new-commit>:scripts/clew/$f > scripts/clew/$f
done
```
