# Bug Triage: Form C emitter silently drops declared inputs[]

## Metadata
- **schema_version**: 1
- **bug_id**: 20260618-i55-191d4e
- **source_issue**: https://github.com/0xHoneyJar/loa-laplas/issues/55
- **classification**: logic_bug (silent data drop — declared-surface-not-reaching-segment class)
- **severity**: high
- **eligibility_score**: 4
- **eligibility_reasoning**: Stack-trace-grade source locations verified to exist (+1: segment-emitter.py L451-479, L1246-1289; compose-dispatch.sh:311), executable reproduction steps (+2: author composition with a custom input, call Workflow, grep the emitted .workflow.js), and a cited recurring-regression baseline (+1: siblings #28/#29 fixed, #31 open-RFC). No disqualifier matched — this is a defect in existing emitter behavior, not new-feature/route/schema work.
- **test_type**: integration
- **risk_level**: medium
- **created**: 2026-06-18T21:15:08Z

## Reproduction
### Steps
1. Author a composition whose YAML declares a non-magic input, e.g. `inputs: [{type: Artifact, name: foo, required: false}]` (same shape as `compositions/code-implement-and-review.yaml:52-60`, which declares `task` and `scope`).
2. Cut + emit the segment via the Form C path (`scripts/lib/segment-emitter.py`, reached through `compose-dispatch.sh --form-c`).
3. Invoke the emitted workflow with `args: {task: "t", foo: "BAR"}`.
4. `grep foo` over the emitted `.workflow.js`.

### Expected Behavior
The declared input `foo` is wired into the segment — its value reaches the work/gate stage prompt the same way `task` and `scope` do — and a `required: true` input that is absent produces a loud warning.

### Actual Behavior
`grep foo` returns nothing. The emitter only reads the five magic keys; `foo` is never bound, never surfaced into any prompt, and the stage never receives `BAR`. The only guard (`if (!input.task)` WARNING at segment-emitter.py:476) does not fire because `task` is present, so the drop is fully silent.

### Environment
Form C composition runtime (construct-rooms-substrate) in this repo (loa-laplas). Reproducible offline — the emitter is a pure producer that never spends tokens.

## Analysis
### Suspected Files
| File | Line(s) | Confidence | Reason |
|------|---------|------------|--------|
| scripts/lib/segment-emitter.py | 451-479 (`_emit_args_preamble`) | high | Root cause. Emits only `const task = input.task` (477) and `const scope = input.scope` (478). `comp.get('inputs')` is never referenced anywhere in this file (grep confirms: only doc/comment hits at L12/L452/L464). The declared `inputs[]` array is fully unused. |
| scripts/lib/segment-emitter.py | 1292, 1437 | high | The two `_emit_args_preamble(...)` call sites (iterating-pair and sequential builders). Both pass only `comp.get('intent')`; neither threads the declared inputs through. The preamble fn signature `_emit_args_preamble(default_task)` must gain a `declared_inputs` param and both sites must pass `comp.get('inputs')`. |
| scripts/lib/segment-emitter.py | 1027-1028, 1120-1121, 1152, 1332, 1419-1420 | medium | Stage/gate prompt builders. These surface `"TASK: " + JSON.stringify(task)` and `"SCOPE: " + JSON.stringify(scope)` into the agent prompt. Declared inputs must be surfaced here the same way, or they are bound-but-not-seen. |
| scripts/lib/segment-emitter.py | 1246, 1249, 1255, 1289 | medium | DAG branch — reads the other three magic keys (`input.items`, `input.gate_batch_max`, `input.stall_s`). Defines the full magic-key skip set the generic wiring must exclude to avoid double-declaration / var collision: `task, scope, items, gate_batch_max, stall_s`. |
| scripts/compose-dispatch.sh | 311 | low | Emits `"inputs": []` passthrough in the Form C room-packet body (`invocation_path: agent_call`). Informational sibling of the drop, not the runtime drop point. Verify whether the room packet should carry declared input names; the executable defect lives in the emitter. |

### Related Tests
| Test File | Coverage |
|-----------|----------|
| tests/integration/form-c-dispatch.bats | Exercises the segment emitter end-to-end (cut → emit → syntax/determinism/injection/room-packet). Harness already YAML→JSON's a pilot composition and runs `segment-emitter.py`; `EMIT`/`_y2j`/`_cut` helpers at L21/L62/L64. The new acceptance test extends this file. |
| tests/composition/state/recent-learnings.bats | Second emitter consumer (reference for harness invocation shape). |

### Test Target
Integration test in `tests/integration/form-c-dispatch.bats`: feed the emitter a composition declaring a non-magic input (`foo`), emit the segment, and assert (a) the emitted JS binds `foo` from `input.foo` (e.g. `const foo = input.foo` or an equivalent declared-inputs binding) and surfaces it into a stage prompt, (b) a `required: true` declared input that is absent emits a loud warning, and (c) the five magic keys are NOT re-declared (no syntax error / no clobber — the existing `workflow-syntax-check.js` step must still pass). The pre-fix test must fail (grep finds nothing), proving the drop.

### Constraints
- **Generic, not single-field**: wire ALL declared `inputs[].name`, not just `foo`. The fix is the class fix, per the issue.
- **Magic-key skip set is load-bearing**: skip `task`, `scope`, `items`, `gate_batch_max`, `stall_s` — re-emitting these would shadow/clobber the preamble + DAG bindings and can break the emitted workflow.
- **JS-identifier safety**: a declared `name` need not be a valid JS identifier (dashes, leading digits, reserved words). Emitting `const <name> = input.<name>` blindly can produce a syntax error the `workflow-syntax-check.js` step will reject. Guard: skip-with-warning on unsafe identifiers, or bind through a `declaredInputs` object accessed by bracket key.
- **Internal-name collision**: avoid colliding with the emitter's own locals (`input`, `args`, `_args`, `ledger`, `workState`, `lastVerdict`, `MAX_ITER`, `dagItems`, …). The object-binding form sidesteps this entirely.
- **Warnings never throw**: required-but-absent → loud `log("WARNING: …")` (mirroring the existing L476 guard); declared-but-unconsumed names → a `log()` list. Neither halts the segment.
- **Single source**: the preamble is emitted identically into every segment body from ONE function (L452 docstring notes prior drift when copies diverged) — keep the wiring inside `_emit_args_preamble` so both call sites (L1292, L1437) inherit it.

## Fix Strategy
Adopt the issue's option 1 ("wire them"), made generic:

1. **Thread declared inputs into the preamble.** Change `_emit_args_preamble(default_task)` → `_emit_args_preamble(default_task, declared_inputs)` and pass `comp.get('inputs') or []` at both call sites (L1292, L1437).
2. **Emit bindings for every non-magic declared input.** Inside the preamble, after `const input = …`, iterate `declared_inputs`, skip the five magic names, and emit a binding for each remaining `name`. Prefer the collision-safe form — a `const declaredInputs = { <name>: input["<name>"], … }` object plus, for identifier-safe names, individual `const <name> = input["<name>"]` conveniences — so unsafe identifiers degrade to object access instead of a syntax error.
3. **Surface into the stage/gate prompt.** Append the declared input values into the prompt lines next to `TASK:`/`SCOPE:` in the work/gate builders (L1027-1028, L1120-1121, L1152, L1332, L1419-1420), e.g. one `"INPUTS: " + JSON.stringify(declaredInputs)` line, so capable models actually see them.
4. **Loud guards.** For each `required: true` declared input absent from `input`, emit `log("WARNING: required input '<name>' missing — segment running without it")`. Emit a `log()` listing any declared input names that ended up unconsumed.
5. **Test-first.** Land the failing `form-c-dispatch.bats` case before the emitter change; confirm it fails (grep empty), then passes after, with `workflow-syntax-check.js` still green and existing emitter tests unregressed.

### Fix Hints
Structured hints for multi-model handoff (each hint targets one file change):

| File | Action | Target | Constraint |
|------|--------|--------|------------|
| scripts/lib/segment-emitter.py | refactor | `_emit_args_preamble` signature — add `declared_inputs` param | keep ONE source; both call sites inherit |
| scripts/lib/segment-emitter.py | add | emit bindings for every declared `inputs[].name` after `const input` | skip magic keys task/scope/items/gate_batch_max/stall_s; JS-identifier-safe (prefer `declaredInputs` object for unsafe names); no internal-local collision |
| scripts/lib/segment-emitter.py | fix | pass `comp.get('inputs') or []` into `_emit_args_preamble` at L1292 and L1437 | both call sites, not one |
| scripts/lib/segment-emitter.py | add | surface declared input values into stage/gate prompt next to TASK/SCOPE (L1027,L1120,L1152,L1332,L1419) | same JSON.stringify shape as task/scope |
| scripts/lib/segment-emitter.py | validate | required:true declared input absent → loud `log("WARNING…")`; declared-but-unconsumed → `log()` list | warnings only, never throw |
| tests/integration/form-c-dispatch.bats | add | failing-first integration test: composition with non-magic input `foo` → assert binding + prompt surfacing + required-missing warning | syntax-check stays green; magic keys not re-declared |
