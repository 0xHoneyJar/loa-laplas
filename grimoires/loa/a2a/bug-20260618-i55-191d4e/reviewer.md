# Implementation Report — Bug #55: Form C emitter silently drops declared inputs[]

**Bug ID**: 20260618-i55-191d4e · **Sprint**: sprint-bug-2 · **Source**: issue #55 (0xHoneyJar/loa-laplas)
**Beads**: construct-rooms-substrate-xti · **Risk**: medium · **Test type**: integration · **Repro**: strong

## Executive Summary

The Form C segment emitter read only the magic arg names (`task`, `scope`, and in the
DAG branch `items`/`gate_batch_max`/`stall_s`) out of the `args` global. A composition's
declared `inputs[]` array was never read — `comp.get('inputs')` had **zero** references in
`segment-emitter.py` — so any input whose name was not magic was silently dropped at
runtime. The agent never saw it; the only guard (`if (!input.task)`) does not fire when
`task` is present, so the drop was fully silent.

Fixed by wiring **every** declared non-magic input generically (the issue's option 1, made
class-wide rather than single-field): the preamble now reads each declared `inputs[].name`
from `input` into a collision-safe `declaredInputs` object, surfaces it into every
stage/gate prompt next to `TASK`/`SCOPE`, warns loudly when a `required: true` input is
absent, and logs the wiring status. The fix is the same "declared → reaches the segment"
repair as #28/#29 (the recurring class #55 named).

This is a **root-cause, generic** fix, not a symptom patch — it activates immediately for
real compositions: the pilot `code-implement-and-review.yaml` declared `operator_context`
(non-magic, `required: false`), which was being silently dropped and is now wired.

## AC Verification

> AC source: `grimoires/loa/a2a/bug-20260618-i55-191d4e/sprint.md` (final Acceptance Criteria block)

1. **"A composition's declared non-magic inputs reach the segment and its stage prompt"** — ✓ Met
   - Preamble wires each non-magic declared input into `declaredInputs`: `scripts/lib/segment-emitter.py:501-507` (`const declaredInputs = {}` + the `for (const __spec of __declaredInputSpecs)` loop binding `declaredInputs[__spec.name] = input[__spec.name]`).
   - Surfaced into the prompt via `declaredInputsLine` at all five builder sites: `segment-emitter.py:1079, 1173, 1205, 1386, 1475`.
   - Test: `tests/integration/form-c-dispatch.bats:1146` asserts `prior_grounding` + `declaredInputs` + `DECLARED INPUTS` all reach the emitted segment.

2. **"Absent `required: true` inputs produce a loud warning; declared-but-unconsumed inputs are logged"** — ✓ Met
   - Required-absent → loud warning: `segment-emitter.py:509` (`log("WARNING: required declared input(s) absent from args …")`).
   - Wiring/absence status log: `segment-emitter.py:510` (`log("declared inputs[] wired: […]; absent(optional): […]")`).
   - Test: `tests/integration/form-c-dispatch.bats:1159` executes the preamble with the required input absent and asserts `warned:true` and no throw.

3. **"Failing-first integration test proves the fix"** — ✓ Met
   - Two tests added at `tests/integration/form-c-dispatch.bats:1146` and `:1159`. Both were confirmed **FAILING** against pre-fix code (`grep prior_grounding` empty; `warned:false,hasObj:false`) and **PASSING** after — captured in the implement transcript.

4. **"No regressions; magic keys are not re-declared and syntax-check stays green"** — ✓ Met
   - Magic-key skip set: `segment-emitter.py:454` (`_MAGIC_INPUT_NAMES = ("task","scope","items","gate_batch_max","stall_s")`), applied in `_declared_input_specs` (`:457-465`).
   - Full `form-c-dispatch.bats` suite: **113 ok / 0 not ok**. Emitter-adjacent suites green: `recent-learnings.bats` (incl. byte-identical determinism test), `compose-terminal-gate.bats` (10/0), `composition-pilot.bats` (8/0).
   - `workflow-syntax-check.js` passes on a pilot-emitted iterating segment (verified post-fix). The new test (`:1146`) also runs the syntax check.

5. **"Fix addresses root cause (the emitter never reading `comp.get('inputs')`)"** — ✓ Met
   - Both call sites now thread declared inputs in: `segment-emitter.py:1345` and `:1492` (`_emit_args_preamble(…, comp.get('inputs') or [])`). The preamble signature gained the `declared_inputs` param (`:474`), keeping the single-source invariant so both call sites inherit the wiring.

## Tasks Completed

### Task 1 — Failing test (test-first) · `tests/integration/form-c-dispatch.bats:1140-1197` (+58 lines)
- Two `@test` blocks under a new "Issue #55 regression" header, alongside the #28/#29 PR-#32 block.
- Hermetic (uses the existing `TMPROOT` harness + `general-purpose` built-in construct, no adapter stub needed).
- One static+syntax test (wiring + prompt-surfacing + magic-key-not-leaked + syntax-check); one behavioral test (required-absent warns, never throws, `declaredInputs` always defined).

### Task 2 — Generic fix · `scripts/lib/segment-emitter.py` (+65/−7)
- `_MAGIC_INPUT_NAMES` constant (`:454`) + `_declared_input_specs()` helper (`:457-465`) — de-dupes, validates names are non-empty strings, skips magic keys.
- `_emit_args_preamble(default_task, declared_inputs=None)` (`:474`) emits a generic wiring block inside the `@preamble` sentinels: bakes the specs as JSON, loops at runtime over `input`, builds `declaredInputs`, fires the required-absent warning + status log, and defines `declaredInputsLine` (`:511`).
- Both call sites updated (`:1345`, `:1492`).
- `declaredInputsLine` inserted after the `SCOPE` line at all five prompt builders (work-singular, sequential, DAG-item, gate, sequential-other) — `:1079, 1173, 1205, 1386, 1475` — each `.filter(Boolean)`-guarded so empty inputs are dropped.

## Technical Highlights

- **Collision-safe by construction.** Inputs bind into an OBJECT (`declaredInputs[name]`),
  never `const <name> = …`. This sidesteps the two landmines the naive fix would hit:
  (1) a declared name that is not a valid JS identifier (dash/leading-digit/reserved word)
  would be a syntax error `workflow-syntax-check.js` rejects; (2) a name colliding with an
  emitter local (`input`, `ledger`, `iteration`, …). Both are impossible with bracket access.
- **Injection-safe.** Declared names flow through `js()` (the JSON-escaping serializer) into
  the baked spec array, and runtime access is `input[name]` + `JSON.stringify(declaredInputs)`
  — no string interpolation of composition-controlled values into code.
- **v1-safe / additive.** A composition declaring no non-magic inputs emits an inert block
  (empty object, empty line, no logs); the prompt line filters out. Determinism is preserved
  (no `Date`/`Math.random`) — the byte-identical `recent-learnings.bats` test still passes.
- **No string rot.** The `issue #55` provenance lives only in Python comments/docstring; the
  emitted JS carries an issue-free comment (honors the "no issue-tracker literals in emitted
  segments" council rule).

## Testing Summary

- `bats tests/integration/form-c-dispatch.bats` → **113 ok / 0 not ok** (2 new #55 tests).
- `bats tests/composition/state/recent-learnings.bats` → green (determinism preserved).
- `bats tests/integration/compose-terminal-gate.bats` → 10/0; `composition-pilot.bats` → 8/0.
- Manual: pilot-emitted iterating segment passes `node scripts/lib/workflow-syntax-check.js`;
  pilot's `operator_context` now wired + `DECLARED INPUTS` surfaced; `grep 'issue #55'` on
  emitted JS → 0.

Run: `bats tests/integration/form-c-dispatch.bats -f "issue #55"`

## Known Limitations

- The runtime status `log()` fires once per segment for compositions that declare non-magic
  inputs (visibility by design; silent for compositions that declare none).
- Declared inputs surface as one JSON `DECLARED INPUTS` line per prompt. Very large artifact
  inputs ride in the prompt verbatim (same shape as `TASK`/`SCOPE` today) — no truncation
  added, matching existing behavior. `// loa:shortcut: no per-input size cap; add a cap if a
  declared Artifact input is observed to blow the prompt budget`.

## Verification Steps (for reviewer/auditor)

1. `git diff scripts/lib/segment-emitter.py tests/integration/form-c-dispatch.bats`
2. `bats tests/integration/form-c-dispatch.bats` → expect 113/0.
3. Confirm the five `declaredInputsLine,` insertions are each `.filter(Boolean)`-guarded and
   indented to match their prompt array.
4. Confirm no magic key can be re-emitted: `_MAGIC_INPUT_NAMES` skip in `_declared_input_specs`.
5. Confirm no `issue #5` literal in emitted JS (string-rot rule).
