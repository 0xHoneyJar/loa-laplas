# Implementation Report — Sprint-1: The Descent, Phase 1 (settle → laplas)

## Executive Summary

settle has descended from the application layer into loa-laplas as `scripts/settle/settle.mjs`
— a single ESM file that **composes legba** for all crypto (ed25519 sign/verify, JCS, sha256)
and ships **zero inline crypto**. The counter-example "teeth" are ported to `node:test` as
`scripts/settle/settle.test.mjs`: 40 tests / **116 assertions**, including the
deliberately-broken-gate **negative control** which proves the brake fires closed. The layer-law
verifier reports **`VIOLATION=0`** (no inversion introduced). Cross-repo cleanup (remove
freeside `packages/settle`, close PR #298, open laplas draft PR) is **T-11**, deferred to after
review + audit per cross-repo discipline.

Branch: `feat/spiral-spiral-20260623-34f85e-cycle-1`

## AC Verification

| AC | Status | Evidence |
|----|--------|----------|
| **AC-1 (location)** | ⚠ Partial | `scripts/settle/settle.mjs` exists ✓. freeside `packages/settle` removal is **T-11** (post-review). |
| **AC-2 (single signer)** | ✓ Met (by intent) | `scripts/settle/settle.mjs` has **zero** `generateKeyPairSync(` calls and no signing logic — `grep -E 'generateKeyPairSync\s*\(' scripts/settle/` → empty. All crypto delegates to legba (settle.mjs:4,162-163,171-181). **Finding:** the AC's *literal* command `grep -r 'generateKeyPairSync\|ed25519' scripts/ -l` now returns >1 file because legba's own custody system was split into `legba-signer.mjs` + `legba-signer-daemon.mjs` (commits 45d728a, 92d2313) and settle's comments mention the words — the command is stale; the **single-new-signer invariant holds**. Flagged for reviewer. |
| **AC-3 (compose not duplicate)** | ✓ Met | `import { jcs, sha256, hashObj, sign as legbaSign, verify as legbaVerify } from '../legba/legba-core.mjs'` (settle.mjs:4). No local JCS/sha re-implementation. |
| **AC-4 (counter-examples pass)** | ✓ Met | `node --test scripts/settle/settle.test.mjs` → exit 0, 40 tests / 116 assertions. Covers unbypassable gate (deny-paths), fail-closed classifier (SKP-006), independent verifier (a), confused-deputy claim_id, G-7 degradation (e). ≥113 satisfied. |
| **AC-5 (negative control bites)** | ✓ Met | `(g) NEGATIVE CONTROL` (settle.test.mjs) — constructs a broken proceed-on-claimed gate, asserts the real gate returns `proceed:false` (fails closed) and the broken one differs; via `makeGatedFacade` the broken gate leaks, the real one does not. Name contains "negative control". |
| **AC-6 (VIOLATION=0)** | ✓ Met | `node grimoires/loa/context/check-layer-law.mjs` → `STATUS=DRIFT \| VIOLATION=0 \| GAP=1`. (GAP=1 acceptable — enforcement_from_below is Phase 2.) |
| **AC-7 (freeside cleanup)** | ⏸ Deferred → T-11 | Close freeside PR #298 + open laplas draft PR — cross-repo, post review+audit. |
| **AC-8 (no runtime deps)** | ✓ Met | settle.mjs imports: `../legba/legba-core.mjs`, `node:crypto`, `node:fs` only — 0 npm-registry imports. |
| **AC-9 (laplas-first ESM)** | ✓ Met | top-level `import`/`export`, `.mjs`, no `require()`/`exports =`. |
| **AC-10 (cross-repo discipline)** | ⏸ Deferred → T-11 | Both PRs draft, scoped, never auto-merged. |

## Tasks Completed

- **T-1** — legba export audit. `legba-core.mjs` extended (+28/-4) with `sign`, `verify`, and
  `generateVerifierKeypair` exports (internal `sign`/`verify` renamed `_sign`/`_verify` to avoid
  collision). Keeps `generateKeyPairSync` in legba — single signer preserved.
- **T-2…T-7** — settle.mjs port (pre-existing from prior cycle, verified this pass): tier domain,
  verdict mapping (PENDING≠INSUFFICIENT), posture, classifier (SKP-003 sha-pin, SKP-006
  unmatched→FAIL_CLOSED), `checkSync` gate (fail-closed init, confused-deputy, bar_sha, TTL, G-7),
  independent `verify`, `makeTrailWriter` (atomic append, SKP-004 oversize reject), `makeGatedFacade`.
- **T-8/T-9** — `scripts/settle/settle.test.mjs` authored: 40 tests / 116 assertions, the 7 named
  counter-examples (a)–(g) + breadth unit coverage. (g) is the negative control.
- **T-10** — Gates 1–3 run and pass (see AC-2/AC-4/AC-6). Gate 4 (freeside package gone) is T-11.

### Bug fixed this pass
`checkSync` G-7 path clobbered the deny reason: when a degraded chain capped `settled→pinned`
AND that failed the tier check, the reason was overwritten with the generic `< required` message,
losing the "degraded chain" cause the trail must record. Fixed to preserve the G-7 cause in both
proceed and deny cases (settle.mjs:247-264). Counter-example (e) asserts `/degraded chain/`.

## Testing Summary

- `node --test scripts/settle/settle.test.mjs` → **exit 0, 40 pass / 0 fail, 116 assertions**.
- Negative control verified in isolation: `node --test --test-name-pattern='NEGATIVE CONTROL'` → pass.

## Known Limitations / Deferred

- **T-11 (AC-1/AC-7/AC-10)** — cross-repo actions (remove freeside `packages/settle`, close PR #298
  with pointer, open laplas draft PR) deferred to after review + audit. Draft-only, never auto-merged.
- **AC-2 literal command is stale** — recommend the reviewer update the gate to the call-precise
  form `grep -E 'generateKeyPairSync\s*\(' scripts/settle/` (the invariant the AC actually protects).

## Verification Steps (for reviewer)

```bash
cd loa-laplas
node --test scripts/settle/settle.test.mjs                       # exit 0, 116 assertions
grep -E 'generateKeyPairSync\s*\(' scripts/settle/ -r            # empty (settle composes legba)
grep -E '^import ' scripts/settle/settle.mjs                     # only node:* + ../legba
node grimoires/loa/context/check-layer-law.mjs | tail -1         # VIOLATION=0
```
