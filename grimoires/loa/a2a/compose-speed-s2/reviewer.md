# Implementation Report — compose-speed S2: THE EXECUTOR WIRING

**Sprint plan:** `grimoires/loa/sprint-compose-speed.md` (S2) · depends on S1 (manifest, `laplas-ready` green).

## Executive Summary

Made `code-implement-and-review` actually USE the runtime's RFC #35 fan-out. The composition now *declares* the fan-out contract (one work stage + one gate → `dag_capable`), instructs the `/compose` driver to resolve the task into `args.items[]`, and documents the decomposition heuristic + an invocation example. Verified by emitting the composition and reading the generated workflow: the DAG machinery is present, leaves route to **sonnet**, the FAGAN gate routes to **opus** and fires once on the merged diff, and an `items`-less task still runs the single-context path. **No runtime code changed** — the machinery already ships; this declares + proves it.

## AC Verification

1. **"executor passes `args.items[]` (≥2) → emitted workflow logs `DAG mode: N item(s) in M wave(s)` + `DAG wave 1/M`"**
   - ✓ Met — the emitted `.run/compose/<run>/workflows/code-implement-and-review.segment-1.workflow.js` contains the `DAG mode` + `DAG wave` log statements and the `dagWaves`/`boundedParallel` scheduler (grep-confirmed: `TIER_MODEL_JS`, `leafModel`, `dagWaves`, `boundedParallel`, `dagItems`, `DAG mode` all present). The live log fires at runtime — exercised in S3's drive.

2. **"Each leaf resolves `model: "sonnet"`"**
   - ✓ Met — DAG branch (workflow line 188 `if (iteration === 1 && dagWavesResolved)`) routes the leaf agent `agentType: "general-purpose", model: leafModel(it)`; `leafModel` defaults to `TIER_MODEL_JS["cheap"|"mid"|…] || "sonnet"`, and `"cheap": "sonnet"` confirmed in the emitted map. Cost card: stage 1 → `sonnet`.

3. **"FAGAN gate emits opus + fires ONCE per cycle on the merged diff"**
   - ✓ Met — gate stage: `agentType: "construct-fagan", model: "opus"`; the gate prompt reviews `JSON.stringify(workState)` (the merged fan-out output, line ~269), not per-item — so it fires once per convergence cycle. Cost card: stage 2 → `opus`.

4. **"A task with NO `items[]` still runs the single-context implement→gate path (no regression)"**
   - ✓ Met — workflow line 173 `const dagItems = (Array.isArray(input.items) && input.items.length) ? input.items : null;`; null → `dagWavesResolved` null → the `} else {` branch (line 238) runs the original single-context implementer. Fan-out is opt-in.

5. **"`terminate_when` / `max_iterations` preserved: convergence loop wraps WAVES; iterations ≥ 2 stay the single fixer context"**
   - ✓ Met — the `while (iteration < MAX_ITER)` loop wraps the fan-out+gate; iteration 1 fans out (DAG branch), iterations ≥ 2 take the single-context fixer (`else` branch). `max_iterations: 3` + `terminate_when` (composition lines 76-81) unchanged.

## Tasks Completed

| Task | File | Change |
|------|------|--------|
| 2.1 | `compositions/code-implement-and-review.yaml` | added a `dag_fanout` block + a documented section declaring RFC-#35 capability (one work stage + one gate); confirmed stage 1 is NOT opus-pinned (emitter routes role:primary→sonnet; the opus cost-mistake was the party, fixed in S1) |
| 2.2 | `…yaml` | documented the executor instruction (driver populates `args.items[]`) + the decomposition heuristic; added a fan-out `invocation_example` |
| 2.3 | — | emitted the composition; confirmed `TIER_MODEL_JS`/`leafModel`/`dagWaves`/`boundedParallel`/`dagItems`/`DAG mode` present, leaves→sonnet, gate→opus (cost card + emitted JS) |
| 2.4 | — | confirmed the `items`-less backward-compat path (dagItems null → single-context `else` branch) |

## Technical Highlights
- **Declaration + proof, not code** — the emitter bakes the DAG machinery into every segment regardless; S2 declares the contract and proves the emission carries it.
- **dag_capable holds** — the `iterate:[[1,2]]` pair has exactly one work stage (role:primary) + one gate (role:craft-gate), so `len(work_stages)==1`. Do NOT add work stages (S2 risk noted in plan).
- **Gate-once is structural** — the gate reviews the merged `workState`, so its cost is ~1×/cycle regardless of item count (the inverse of the old serial-loop-feeds-opus-gate shape).

## Testing Summary
- `compose-dispatch … --form-c` → segments:1, stage models {1:sonnet, 2:opus}.
- Emitted workflow grep: all 6 DAG-machinery markers present; leaf `leafModel(it)`; gate `construct-fagan/opus` on merged `workState`; `dagItems` ternary backward-compat guard.

## Known Limitations
- The **live** fan-out (actual `DAG wave 1/N` log + parallel sonnet leaves + A/B cost numbers) is **S3** — S2 proves the emitted machinery + tiering statically; it does not spend agent tokens.
- The driver's actual decomposition logic (how `/compose` derives `items[]` from a task) is documented as a heuristic in the composition; whether the `/compose` skill auto-decomposes or the operator supplies items is exercised/decided in S3.

## Verification Steps (reviewer)
1. `bash scripts/compose-dispatch.sh compositions/code-implement-and-review.yaml --module modules/code-implement-and-review/module.json --form-c --run-id v --json` (with `LOA_PROJECT_ROOT=$(pwd)`) → cost card stages {1:sonnet, 2:opus}.
2. `grep -E 'TIER_MODEL_JS|leafModel|dagWaves|boundedParallel|dagItems|DAG mode' .run/compose/v/workflows/*.workflow.js` → all present.
3. Confirm `const dagItems = … ? input.items : null` (backward-compat) + the `iteration === 1 && dagWavesResolved` DAG branch.
