# Sprint Plan: Bug Fix — Form C emitter silently drops declared inputs[]

**Type**: bugfix
**Bug ID**: 20260618-i55-191d4e
**Source**: /bug (triage) — issue #55 (0xHoneyJar/loa-laplas)
**Sprint**: sprint-bug-2

---

## sprint-bug-2: Form C emitter silently drops declared inputs[]

### Sprint Goal
Wire every declared composition `inputs[].name` through the Form C segment emitter so non-magic inputs reach the stage prompt, with a loud warning for absent required inputs — proven by a failing-first integration test.

### Deliverables
- [ ] Failing integration test that reproduces the silent drop
- [ ] Source code fix (generic wiring of all declared inputs)
- [ ] All existing tests pass (no regressions; `workflow-syntax-check.js` stays green)
- [ ] Triage analysis document

### Technical Tasks

#### Task 1: Write Failing Test [G-5]
- Create an integration test in `tests/integration/form-c-dispatch.bats` reproducing the bug
- Composition declares a non-magic input (`foo`); emit the segment; assert the emitted JS binds `foo` from `input.foo` and surfaces it into a stage prompt, and that an absent `required: true` input emits a warning
- Verify the test fails with current code (grep for the binding returns nothing)
- Test file: tests/integration/form-c-dispatch.bats

**Acceptance Criteria**:
- Test fails with current code, proving declared non-magic inputs are dropped
- Test name clearly describes the bug scenario
- Test is isolated (uses the existing hermetic TMPROOT harness; no repo-state writes)

#### Task 2: Implement Fix [G-1, G-2]
- Fix root cause in `scripts/lib/segment-emitter.py` (`_emit_args_preamble`, L451-479): add a `declared_inputs` param; emit a binding for every declared input name, skipping the five magic keys (`task, scope, items, gate_batch_max, stall_s`); guard JS-identifier safety and internal-local collisions
- Pass `comp.get('inputs') or []` at both call sites (L1292, L1437)
- Surface declared input values into the stage/gate prompt next to TASK/SCOPE (L1027-1028, L1120-1121, L1152, L1332, L1419-1420)
- Emit a loud `log()` warning for absent `required: true` inputs and a `log()` list of declared-but-unconsumed names
- Verify the failing test now passes; run the full bats suite

**Acceptance Criteria**:
- Failing test now passes
- No regressions in existing tests; emitted workflows still pass `workflow-syntax-check.js`
- Fix is generic (wires all declared inputs, not a single named field) and addresses root cause, not symptoms

### Acceptance Criteria
- [ ] A composition's declared non-magic inputs reach the segment and its stage prompt
- [ ] Absent `required: true` inputs produce a loud warning; declared-but-unconsumed inputs are logged
- [ ] Failing-first integration test proves the fix
- [ ] No regressions; magic keys are not re-declared and syntax-check stays green
- [ ] Fix addresses root cause (the emitter never reading `comp.get('inputs')`)

### Triage Reference
See: grimoires/loa/a2a/bug-20260618-i55-191d4e/triage.md
