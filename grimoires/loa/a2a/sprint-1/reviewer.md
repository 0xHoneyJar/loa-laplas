# Implementation Report — verifiable-compose sprint-1 (Epic A)

**Cycle**: verifiable-compose · **Sprint**: sprint-1 · **Branch**: cycle/verifiable-compose
**Source**: PRD/SDD/sprint hardened over 2 Flatline rounds (PRD §9)

## Executive Summary

Authored the `rigorous-review` composition whose BEAUVOIR synthesis stage carries an inline
`bridge-findings` `output_schema` — REQUIRED per-finding `{dimension, severity, anchor, issue,
recommendation}` + a REQUIRED `claims_ledger` tagging each claim `observed|claimed`. The schema
makes an ungrounded finding mechanically unemittable. **Task 0 (Flatline SB3) is verified: "no
emitter change" HOLDS** — the full nested schema flows to the `agent({schema})` StructuredOutput
layer untouched. 5 new tests pass; the existing `form-c-dispatch.bats` suite stays **114/0**.

## AC Verification

> ACs quoted from `grimoires/loa/sprint.md` sprint-1.

1. **Task 0 pre-check** ("validator recurses into array-item `required`, or emitter fix scoped in") — ✓ **Met (premise holds, no fix needed)**
   - Evidence: `scripts/lib/segment-emitter.py:948` `_validated_output_schema` returns the FULL inline `output_schema` and is shared by `_emit_stage_schema` (the `agent({schema})` arg — PRIMARY enforcement; the Workflow StructuredOutput tool validates the full JSON Schema incl. nested `required` and retries on miss) and `_emit_stage_required` (the `conforms()` backstop at `:756`, top-level-only by design). The nested schema reaches the StructuredOutput validator intact → no emitter change.
   - Test: `tests/integration/rigorous-review.bats` "Task 0 [SB3]" asserts `findings[].required` (`dimension`/`recommendation`), `claims_ledger[].required` (`claim`/`grounding`), and the `observed`/`claimed` + `critical` enums all reach the emitted `agent({schema})`.

2. **VC-A1** ("the emitted synthesis stage carries the bridge-findings `output_schema`; a synthesis payload missing `anchor`/`severity`/`recommendation` triggers … validation rejects") — ✓ **Met (structural, per SB2)**
   - Evidence: `compositions/experimentation/rigorous-review.yaml` stage 4 `output_schema.properties.findings.items.required: [dimension, severity, anchor, issue, recommendation]`; reaches `agent({schema})` (test "Task 0"). **Honest scoping (Task 0 + SB2):** the *runtime rejection* of a finding missing `anchor` is the Workflow StructuredOutput tool's full-schema validation, NOT the emitter's `conforms()` (which is top-level-only). Sprint-1 proves the schema is *handed to* that validator (structural); it does not re-implement the validator.

3. **VC-A2** ("`claims_ledger` is a REQUIRED top-level field; a ledger item missing `grounding`/`tag` fails validation") — ✓ **Met (structural)**
   - Evidence: `rigorous-review.yaml` `output_schema.required: [summary, findings, claims_ledger]` and `claims_ledger.items.required: [claim, grounding, tag]` (`tag` enum `[observed, claimed]`). Test "Task 0" asserts `claim`/`grounding`/`observed`/`claimed` reach the emitted schema.

4. **[SB2]** ("sprint-1 proves *structural* enforcement only … grounding is sprint-2's job") — ✓ **Met**
   - Anchor *resolution* (proving an anchor is real, not just present) is NOT implemented here — it is sprint-2 (SDD §2.6). `rigorous-review.yaml`'s synthesis notes instruct observed-vs-claimed tagging; the *resolve step* is deferred. No over-claim.

5. **"No emitter source change IF Task 0 passes; `workflow-syntax-check.js` green; existing `form-c-dispatch.bats` unregressed"** — ✓ **Met**
   - `tests/integration/rigorous-review.bats` "no emitter change" asserts `git diff segment-emitter.py` is empty. Syntax check green (test "emit"). `form-c-dispatch.bats`: **114/0** (re-run this session).

## Tasks Completed

| Task | File | Lines | Approach |
|------|------|-------|----------|
| Author composition | `compositions/experimentation/rigorous-review.yaml` | +150 | Sibling of `tiered-code-review.yaml`; chain gecko→gygax→kranz lenses → BEAUVOIR synthesis (`role: primary` work stage — a `craft-gate` would emit the fixed `GATE_SCHEMA`, so the synthesis is a work stage to carry its own `output_schema`) |
| Tests | `tests/integration/rigorous-review.bats` | +110 | 5 hermetic tests mirroring `form-c-dispatch.bats` setup |

## Technical Highlights

- **The `craft-gate` trap (caught at author time):** a synthesis stage tagged `craft-gate` would emit with the hardcoded `GATE_SCHEMA` (verdict/findings), silently dropping the bridge-findings schema. The synthesis is therefore a `role: primary` work stage; its `output_schema` flows through `_emit_stage_schema`. Documented inline in the YAML.
- **Task 0 honesty:** the emitter's `conforms()` is a top-level backstop; nested-required enforcement is the StructuredOutput tool's full-schema validation. The composition proves the schema reaches that layer — which is exactly the structural guarantee sprint-1 claims (SB2).
- **Schema-key safety:** `_assert_safe_schema_keys` accepts the schema (the emit does not `sys.exit`); test "schema-keys" asserts no `OUTPUT-SCHEMA-INVALID` leak.

## Testing Summary

- `bats tests/integration/rigorous-review.bats` → **5/5**.
- `bats tests/integration/form-c-dispatch.bats` → **114/0** (no regression).
- Run: `bats tests/integration/rigorous-review.bats`

## Known Limitations

- **Renderer + anchor resolution are sprint-2** (SDD §2.4/§2.6) — sprint-1 is the schema-carrying composition only.
- The lens constructs (gecko/gygax/kranz) + `the-weaver`/BEAUVOIR synthesis are the SDD's *default* lenses; the composition is opt-in and the lenses are configurable. Their adapters must be installed for a live `/compose` run (the tests emit without `--validate-constructs`).
- `// loa:shortcut: lens roster is the SDD default; swap per review domain` — the composition hardcodes one roster; a per-domain roster is a future enhancement, not needed for the contract.

## Verification Steps (for reviewer/auditor)

1. `git diff compositions/experimentation/rigorous-review.yaml tests/integration/rigorous-review.bats`
2. Confirm `segment-emitter.py` is UNCHANGED (`git diff HEAD -- scripts/lib/segment-emitter.py` empty) — the SB3 premise.
3. `bats tests/integration/rigorous-review.bats` → 5/5; `bats tests/integration/form-c-dispatch.bats` → 114/0.
4. Confirm the synthesis stage is `role: primary` (not `craft-gate`) so its `output_schema` is emitted, not `GATE_SCHEMA`.
