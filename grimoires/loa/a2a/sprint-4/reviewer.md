# Sprint 4 — The Phase-1 stall path (the keystone) — Implementation Report

**Cycle**: decompose-bridge · **Sprint**: 4 (final) · **Status**: ready for re-review (cycle 2)

## Feedback Addressed (cycle 2 — senior-lead CHANGES_REQUIRED)

The cycle-1 senior-lead review (adversarial self-review) returned CHANGES_REQUIRED on two
real defects. Both fixed:

- **C1 — dead code** (`laplas/lib/wave-cancel.mjs`): the unreachable `__wave_stalled` branch
  in `runDag` is removed (`cancellableWave` only ever emits `__wave_cancelled` /
  `__drain_timeout` / `__wave_thrown`; the staller is recorded via `__drain_timeout`). The name
  now appears only in an explanatory comment. Verified: `grep -E 'if \(r && r\.__wave_stalled\)'`
  → no live branch.
- **C2 — `stall_s` dead plumbing**: the `/compose` driver now forwards `args.stall_s` alongside
  `args.gate_batch_max` (`skills/compose/SKILL.md`), the resolver doc-comment lists `stall_s`
  (`laplas/bin/compose-resolve.mjs:4`), and a **regression test** pins it
  (`laplas/test/compose-driver.test.mjs` — casual→90, competitive→45, proving it is rel-derived
  and cannot silently collapse to `DEFAULT_STALL_S`).
- Non-blocking nits (per-wave false-positive risk, setTimeout-unverified, redundant deadline
  wrap) left as documented Known Limitations per the reviewer's "note, don't block" guidance.

Re-verified after the fixes: **87/87 laplas · 95/95 bats · emitter `node --check` clean ·
dispatch determinism guard passes**.

---


**Scope decision (operator, 2026-06-14)**: *Fold S3.4 in now* — the unified emitter
wave-loop rewrite covers **both** S4.4 (cancel/drain) **and** the deferred S3.4/`x7l`
(DEPENDENCY_FAILED stranding, B7). The biggest live-emitter change; closes `x7l`.

## Executive Summary

FR-4.5 is live: a stalled leaf now has a real, run_mode-aware exit with a named-gap
interface, and the DAG wave loop strands only a failed item's transitive dependents
(instead of aborting the whole dag) with bounded cooperative cancellation on stall.

Five net-new laplas modules + one schema, an additive incident-schema event, and a
unified rewrite of the emitter's DAG wave loop (the single highest-blast-radius file —
every composition fans out through it). The wave-loop logic is a **single source**
(`laplas/lib/wave-cancel.mjs`): unit-tested in the kit AND emitted verbatim into the
workflow (the sandbox cannot import it). **87/87 laplas tests green; 95/95 form-c
integration (bats) green** (was 67 + 92 at baseline; +20 unit, +2 integration, 1
integration updated to the new B7 contract).

The one residual risk is named explicitly in **Known Limitations §1**: the *live* cancel/
drain path depends on `setTimeout` being available in the Workflow sandbox (unverified —
the prior emitter never used a timer). The design **degrades safely** to B7-stranding-only
when timers are absent, and the cancel/drain primitive is fully unit-tested with injected
timers. This is the "integration-only AC" the operator flagged at the cadence checkpoint.

## AC Verification

> AC-S4.1: `diagnose` on a stalled fixture → schema-valid `named_gap`, non-empty `missing_role`.

**✓ Met.** `diagnose()` emits the C9 `named_gap` shape with a guaranteed non-empty
`missing_role` (falls back to `"unknown-specialist"` — the schema floor).
- Schema: `laplas/schemas/named-gap.schema.json` (`missing_role` `minLength:1`; `recommendation` pattern `^(re-quest|escalate|summon:.+)$`)
- Impl: `laplas/lib/diagnose.mjs:18` (`diagnose`), `:20-22` (non-empty `missing_role` w/ `FALLBACK_ROLE`)
- Test: `laplas/test/named-gap.test.mjs:24` (AC-S4.1 — schema-valid + non-empty), `:33` (no-role fallback)

> AC-S4.2 **(progress, §0.5)**: the timer resets on the leaf's own tool/output event, not on a sibling's; no progress for `stall_s` → stall fires.

**✓ Met.** `makeStallWatch` keeps a per-leaf last-own-event timestamp; `progress(id)`
resets **only** that id's timer.
- Impl: `laplas/lib/stall-watch.mjs:25` (`makeStallWatch`), `:36` (`progress` resets own only), `:37` (`stalled` = now−lastOwn ≥ stallMs)
- Test: `laplas/test/stall-watch.test.mjs:23` (no-progress→stall fires), `:33` (AC: own-event reset, a chatty sibling does NOT mask a silent stall)

> AC-S4.3 **(FR-4.5)**: automated + stall → fail-loud `STALLED_NO_SUMMON` + named_gap, nonzero, **no silent re-queue**; interactive + stall → escalation, no auto-proceed.

**✓ Met.** `stallExit(named_gap, run_mode)` — automated → `fail_loud` + `stalled_no_summon`
incident + named_gap + nonzero `exit_code`; interactive → `escalate`, `auto_proceed:false`.
- Impl: `laplas/lib/stall-exit.mjs:20` (`stallExit`), `:26` (interactive→escalate), `:47-49` (automated→fail_loud + nonzero), `:38` (incident event)
- Schema: `laplas/schemas/incident.schema.json:11` (additive `stalled_no_summon` event — IMP-014)
- Test: `laplas/test/stall-exit.test.mjs:25` (AC: automated fail-loud, nonzero, no auto-proceed, incident schema-valid), `:43` (AC: interactive escalation)

> AC-S4.4: cancel → no zombie workers, completed receipts preserved; **a worker ignoring cancel is killed after the drain timeout; timeout-during-drain still emits a typed result** (Flatline D13).

**✓ Met (primitive layer); ⚠ live-integration is a Known Limitation (§1).**
`cancellableWave` — cooperative skip for not-yet-started siblings (no zombie), completed
receipts preserved, abandoned-laggard typed at the drain deadline (no hang).
- Impl: `laplas/lib/wave-cancel.mjs:44` (`cancellableWave`), `:52` (`__wave_cancelled` cooperative skip), `:72` (`__drain_timeout` typed abandonment)
- Emitter wiring: `scripts/lib/segment-emitter.py:677` (`emit_wave_cancel`, single-source emit), `:1187` (`makeWaveCancel` per-wave timer→signal/deadline, guarded by `typeof setTimeout`), `:1102` (`await runDag`)
- Test: `laplas/test/wave-cancel.test.mjs:39` (cooperative cancel + receipt preserved), `:51` (drain abandons laggard, typed, no hang), `:62` (only the laggard abandoned, finished sibling kept)

> **(folded S3.4 / x7l, B7)**: a failed batch marks its items failed and strands their dependents with a typed `DEPENDENCY_FAILED` reason (no silent partial success); independent batches still complete.

**✓ Met.** `runDag` visits every wave (no whole-dag abort) and strands only a failed
item's transitive dependents.
- Impl: `laplas/lib/wave-cancel.mjs:81` (`runDag`), `:95-96` (`deadDep` → `DEPENDENCY_FAILED` strand), `:85` (`stranded` map)
- Emitter: `scripts/lib/segment-emitter.py:1102` (`runDag` replaces the old whole-dag-abort loop), `:1114` (typed `dag-partial-failure`/`dag-stalled` degraded envelope w/ `failed`/`stranded`/`stalled` breakdown)
- Test (unit): `laplas/test/wave-cancel.test.mjs:79` (independent item completes in the SAME wave as a failure — no whole-dag abort), `:90` (transitive stranding)
- Test (integration): `tests/integration/form-c-dispatch.bats` test 94 (a→b: `a` fails → `b` stranded `DEPENDENCY_FAILED`, in the emitted workflow), test 93 (independent both-fail → `dag-partial-failure`)

> `node --test laplas/test/` green.

**✓ Met (via the working invocation).** All 86 laplas tests pass via
`node --test laplas/test/*.test.mjs`. The **bare-directory** form in the AC
(`node --test laplas/test/`) fails on **Node 23** — it tries to import `laplas/test` as a
*module* (`Cannot find module`), a Node-version behavior that affects the **whole** suite,
not S4 (pre-existing since S1). See Known Limitations §3.

## Tasks Completed

| Task | Deliverable | Files |
|---|---|---|
| **S4.1** | C9 `named_gap` schema + GECKO `diagnose` sense | `laplas/schemas/named-gap.schema.json` (new), `laplas/lib/diagnose.mjs` (new, 41 L) |
| **S4.2** | per-leaf `stall_s` progress-reset watchdog | `laplas/lib/stall-watch.mjs` (new, 52 L) |
| **S4.3** | run_mode-aware terminal stall exit | `laplas/lib/stall-exit.mjs` (new, 55 L), `laplas/schemas/incident.schema.json` (+1 enum) |
| **S4.4 + S3.4/x7l** | unified cancel/drain + DEPENDENCY_FAILED stranding | `laplas/lib/wave-cancel.mjs` (new, 137 L), `scripts/lib/segment-emitter.py` (emitter rewrite), `laplas/lib/constants.mjs` (+2 consts), `laplas/lib/compose-items.mjs` (plumb `stall_s`) |
| **Tests** | 19 unit + 2 integration | `laplas/test/{named-gap,stall-watch,stall-exit,wave-cancel}.test.mjs` (new), `tests/integration/form-c-dispatch.bats` (test 93 updated, test 94 new) |

### Approach highlights

- **Single source, no drift**: `wave-cancel.mjs` carries a `// >>>INLINE … // <<<INLINE`
  block of global-free function declarations. `segment-emitter.py:81` (`_inline_block`)
  extracts it **verbatim** into the emitted preamble (`emit_wave_cancel`,
  `:677`); the module's `export {…}` makes the same code unit-testable. The two can never
  disagree. Pinned constants (`DEFAULT_STALL_S`, `STALL_DRAIN_TIMEOUT_MS`) are read from
  `constants.mjs` by `_laplas_const` for the same reason.
- **Separation of concerns**: the cancel `signal` and drain `deadline` are **injected**
  into `cancellableWave` (read no clock, arm no timer) → deterministically unit-testable.
  The emitter owns the one integration-only piece — wiring `setTimeout` to flip the signal —
  isolated in `makeWaveCancel` and guarded by `typeof setTimeout`.
- **Surgical emitter change**: the rewrite is confined to the DAG-fanout branch +
  `dag_setup`; existing `boundedParallel` callers, the sequential body, and the gate path
  are untouched. `args.items` bypass (RFC #35) and all 92 prior form-c behaviors unchanged.

## Technical Highlights

- **B7 correctness via Kahn layering**: stranding checks only *direct* dead dependencies;
  because waves are Kahn layers, that is transitively correct (a stranded item is itself
  "dead" for its own dependents next wave). Proven by `wave-cancel.test.mjs:90`.
- **D13 bounded cleanup**: a worker that ignores cancel cannot be aborted (no abort hook in
  the runtime) — it is *abandoned* (we stop awaiting it; the runtime concurrency cap reclaims
  the slot) and gets a typed `__drain_timeout`, never a silent gap or an indefinite hang.
- **Determinism guard compliance**: the emitted block carries no `Date`/`Math.random` token
  (the dispatch's `workflow-syntax-check` greps source and aborts on either) — including in
  comments. A comment mentioning `Date.now` initially tripped it; reworded.

## Testing Summary

- **Unit (laplas)**: `node --test laplas/test/*.test.mjs` → **87 pass / 0 fail** (67 baseline + 20 new; incl. the C2 stall_s-forwarding regression).
- **Integration (form-c)**: `bats tests/integration/form-c-dispatch.bats` → **95 ok / 0 not-ok** (test 84 exercises the new `runDag` happy path with real timers; test 94 proves B7 stranding end-to-end in the emitted workflow; dispatch determinism check, test 83, restored).
- **Emitter smoke**: a DAG-capable iterating composition emits valid JS (`node --check` pass, 434 L) with `runDag`/`cancellableWave`/`makeWaveCancel` present and the `stall_s` constant substituted.

## Known Limitations

1. **S4.4 live cancel/drain is integration-only (operator-flagged).** The emitted workflow's
   real stall→cancel→drain depends on `setTimeout` existing in the Workflow sandbox, which is
   **unverified** (the prior 1377-line emitter never used a timer; `Date.now` is banned there).
   Design mitigations: (a) `makeWaveCancel` is guarded by `typeof setTimeout` and **degrades to
   B7-stranding-only** when timers are absent — always correct, just no wall-clock cancel; (b)
   the cancel/drain primitive is fully unit-tested with injected timers (AC-S4.4 met at that
   layer); (c) the bats harness (real Node timers) exercises the timer path on the happy DAG.
   **A live multi-item dispatch is still needed to confirm the timer path fires in production.**
2. **Per-wave stall watchdog is P1-minimal.** The emitter uses a per-*wave* timeout proxy, not
   per-*leaf* intra-progress (which needs a progress feed the emitted workflow does not have).
   `stall-watch.mjs` provides the per-leaf progress-reset watchdog for the driver layer; the SDD
   explicitly scopes full loiter telemetry to Phase 1.5.
3. **AC test command vs Node 23.** `node --test laplas/test/` (bare dir) fails on Node 23 (imports
   the dir as a module). Use `node --test laplas/test/*.test.mjs`. Pre-existing, whole-suite; a
   follow-up should pin the canonical runner or update the AC command.
4. **Schema path: code convention over SDD prose.** SDD says `laplas/schema/named-gap.json`; I
   used `laplas/schemas/named-gap.schema.json` to match all 8 existing schemas (`schemas/*.schema.json`).
   Grounded over the SDD path typo.
5. **G-6 benchmark not automated this pass.** `x7l` mentions an AC-S3.4 G-6 wall-clock benchmark
   (gate ≤ 25% of wave on a large DAG) — integration-only; the *stranding* (the core x7l fix) is
   done + tested, but the perf benchmark needs a live large-DAG dispatch and is not added here.

## Verification Steps (for the reviewer)

```bash
# laplas unit suite (all S4 + regression)
node --test laplas/test/*.test.mjs            # → 87 pass / 0 fail

# form-c emitter integration
bats tests/integration/form-c-dispatch.bats   # → 95 ok / 0 not-ok

# the emitter still produces valid, determinism-clean JS + the dispatch guard passes
scripts/compose-dispatch.sh compositions/code-implement-and-review.yaml --form-c --run-id verify --json; echo "exit=$?"  # → exit 3 (emitted, awaiting gate), no determinism abort

# single-source check: the emitted block IS wave-cancel.mjs's inline block
python3 - <<'PY'
import importlib.util as u
m=u.module_from_spec(u.spec_from_file_location('se','scripts/lib/segment-emitter.py')); u.spec_from_file_location('se','scripts/lib/segment-emitter.py').loader.exec_module(m)
b=m._inline_block('wave-cancel.mjs','wave-cancel'); print('runDag in block:', 'async function runDag' in b, '| no export leak:', 'export {' not in b)
PY
```

## Folded scope — `x7l` closure

Bead `construct-rooms-substrate-x7l` ("S3.4 DEPENDENCY_FAILED stranding: rewrite emitter
wave-failure loop (B7) + G-6 benchmark") is closed by this sprint **except** the G-6
wall-clock benchmark (Known Limitations §5) — the stranding rewrite it primarily tracked is
done, tested at unit (`wave-cancel.test.mjs:79/90`) and integration (bats test 94) layers.
