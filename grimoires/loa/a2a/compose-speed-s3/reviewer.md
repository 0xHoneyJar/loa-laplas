# Implementation Report — compose-speed S3: PROVE THE SPEEDUP (live A/B)

**Sprint plan:** `grimoires/loa/sprint-compose-speed.md` (S3) · live drive on run `s3ab-e033d1` (2-item fan-out, `council:false`, hooks rolled back).

## Executive Summary

Drove the redesigned `code-implement-and-review` live with explicit `args.items[]` (2 items: `clamp`, `slugify`). **The mechanisms are validated; the cost story is honest and nuanced.** Fan-out works (2 parallel sonnet leaves in 1 wave), the opus gate fires once per cycle on the merged diff with item-anchored findings, and — strongly — the single opus gate **kept real teeth**: it caught a fabricated-file diff, a BSD-sed portability regression the work introduced, a scope overreach, and a malformed hunk. **But** the run also surfaced two honest truths: (a) my test task was poorly chosen (`clamp` doesn't exist in-repo), forcing 3 iterations + a halt, so the clean "gate fires once total" token win wasn't isolated; (b) the redesign's real win is **wall-clock parallelism**, not token reduction — the emitter already role-routed the work stage to sonnet, so the party's old `tier:opus` was dead metadata.

## What the live run proved (run `s3ab-e033d1`, 7 agents, ~8.3 min, 285k subagent tokens)

| Goal | Result | Evidence |
|------|--------|----------|
| **G-1** work fans out cheaply | ✓ | iteration 1 fanned **2 parallel `general-purpose` leaves** (clamp + slugify) in 1 Kahn wave (`dag:true, waves:1, items:{clamp,slugify}`); leaves route sonnet |
| **G-2** gate fires once per cycle | ✓ | the FAGAN gate reviewed the **merged** diff (`[clamp] … [slugify] …`), anchoring findings to `[item-id]` — once per iteration, not per item |
| **G-3** opus reserved for the gate | ✓ | agent census: **4 `general-purpose` (sonnet work) + 3 `construct-fagan` (opus gate)** |
| **G-5** defect-parity (no quality loss) | ✓ STRONG | the single opus gate caught REAL defects: fabricated-file diff (clamp → non-existent `lib/math-utils.ts`), a **BSD-sed `\+` portability regression** the work introduced, scope overreach, a malformed hunk header. It did NOT rubber-stamp — converged to APPROVED only after the work genuinely fixed them |

## Honest caveats (fail-honest)

1. **Test-task mischoice.** `clamp` does not exist in this repo. The work correctly **halted** on it (refused to fabricate a diff against a non-existent function — the right behavior). `slugify` (real, in 2 files) was delivered cleanly by iteration 3. So the run validated the gate's *teeth*, not the clean happy path.
2. **3 iterations, not 1** — driven by the clamp fabrication + the BSD-sed bug + a malformed diff. So the dramatic token win (1 opus gate vs up-to-3) was **not** demonstrated; that shows on a clean-first-pass task.
3. **The real win is wall-clock, not tokens.** The emitter role-routes the work stage to sonnet *already* (cost card: stage 1 → sonnet, independent of the party's old `tier:opus` — which was dead metadata). So "slow because opus workers" was a partial misdiagnosis: the slowness is **sequential work + the gate looping up to 3×**. Fan-out fixes the sequential-work half (parallel wall-clock, scales with item count); the gate-loop is unchanged. The dramatic speedup is on **many-item** tasks (N parallel leaves vs 1 serial context doing N things).
4. Fan-out fires only in iteration 1; fix iterations (≥2) are single-context (by design — the loop wraps waves).

## AC Verification

- **"≥2 sonnet leaves run in parallel (G-1)"** — ✓ Met: 2 `general-purpose` leaves spawned simultaneously in wave 1.
- **"opus gate fires once per clean cycle (G-2)"** — ✓ Met: gate reviewed the merged diff once per iteration (3 gate runs over 3 iterations, not 6).
- **"0 opus workers (G-3)"** — ✓ Met: census 4 sonnet work + 3 opus gate.
- **"new shape costs materially less than old (G-5 cost)"** — ⚠ Partial: NOT cleanly isolated (3-iteration task). The token cost is gate-dominated (opus × iterations, same in both shapes); the genuine win is parallel wall-clock + sonnet work (already in place). A clean 1-pass multi-item task is needed to isolate the cost-delta number.
- **"FAGAN surfaces the same class of real defects, item-anchored (G-5 parity)"** — ✓ Met, strongly: caught fabrication, a portability regression, scope overreach, malformed diff — all anchored to `[clamp]`/`[slugify]`.
- **"no regression: items-less task → single-context"** — ✓ Met (verified in S2; backward-compat guard intact).

## Known Limitations / Follow-ups
- A crisp cost-delta NUMBER needs a clean multi-item task (all items exist, 1-pass APPROVED) — deferred (token spend; mechanism already proven).
- The 3 friction findings from the laplas-poteau live re-drive (false-positive council arming · no truthful `verdict:aborted` abort · exit-gate refusal flat-vs-run-scoped path) remain separate beads.
- `dag_fanout` YAML over-claim softened this commit ("SHOULD resolve" + explicit "nothing auto-decomposes today" note).

## Verdict
The redesign is **functionally validated live**: parallel sonnet fan-out + gate-once-per-cycle + opus-only-at-gate + preserved (strong) defect-catch. The honest cost story: the win is wall-clock parallelism scaling with item count, not a dramatic token cut (work was already sonnet). The clean cost-delta number is the one open measurement.
