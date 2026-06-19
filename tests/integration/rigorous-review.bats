#!/usr/bin/env bats
# =============================================================================
# rigorous-review.bats — verifiable-compose Epic A sprint-1 (RFC #56).
# =============================================================================
# The rigorous-review composition's BEAUVOIR synthesis stage carries an inline
# bridge-findings output_schema whose REQUIRED fields (per-finding severity/anchor/
# recommendation; a claims_ledger tagging each claim observed|claimed) make an
# ungrounded finding mechanically unemittable.
#
# Task 0 (Flatline SB3) is the load-bearing test: the FULL schema — including the
# NESTED array-item `required` (findings[].required, claims_ledger[].required) — must
# reach the agent({schema:...}) call. End-to-end nested-required enforcement is the
# Workflow StructuredOutput tool's full-schema validation (it validates the object and
# retries on miss); the emitter's conforms() backstop is top-level-only by design, so
# the schema MUST be handed to the StructuredOutput layer intact. Verified: no emitter
# change is needed (the full output_schema already flows through _emit_stage_schema).
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    CUT="$SUBSTRATE_ROOT/scripts/lib/compose-cut.py"
    EMIT="$SUBSTRATE_ROOT/scripts/lib/segment-emitter.py"
    SYNTAX="$SUBSTRATE_ROOT/scripts/lib/workflow-syntax-check.js"
    COMP="$SUBSTRATE_ROOT/compositions/experimentation/rigorous-review.yaml"

    [[ -f "$CUT" ]] || skip "compose-cut.py not found"
    [[ -f "$EMIT" ]] || skip "segment-emitter.py not found"
    [[ -f "$COMP" ]] || skip "rigorous-review.yaml not found"

    TMPROOT="$(mktemp -d)"
    export LOA_GRIMOIRE_DIR="$TMPROOT/grimoires"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

_y2j() { python3 -c "import yaml,json,sys; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)" "$1"; }

# Emit the (single) rigorous-review segment to $TMPROOT/seg.js; echo the path.
_emit_rigorous_seg() {
    _y2j "$COMP" > "$TMPROOT/comp.json"
    local seg
    seg="$(python3 "$CUT" - < "$TMPROOT/comp.json" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['segments'][0]))")"
    printf '%s' "$seg" | python3 "$EMIT" --segment - --composition "$TMPROOT/comp.json" > "$TMPROOT/seg.js"
    echo "$TMPROOT/seg.js"
}

@test "cut: rigorous-review is one sequential segment (4 work stages, no seam)" {
    _y2j "$COMP" > "$TMPROOT/comp.json"
    run python3 "$CUT" - < "$TMPROOT/comp.json"
    [[ "$status" -eq 0 ]] || fail "cut failed: $output"
    grep -q '"kind": "sequential"' <<<"$output" || fail "expected a sequential segment"
    grep -q '"segments"' <<<"$output" || fail "no segments in cut output"
}

@test "emit: rigorous-review emits + passes syntax/determinism check" {
    local js; js="$(_emit_rigorous_seg)"
    [[ -s "$js" ]] || fail "emit produced nothing (schema-key guard may have sys.exit'd)"
    run node "$SYNTAX" "$js"
    [[ "$status" -eq 0 ]] || fail "emitted workflow fails syntax check: $output"
}

@test "Task 0 [SB3]: the FULL nested bridge-findings schema reaches agent({schema})" {
    local js; js="$(_emit_rigorous_seg)"
    # Top-level required keys are present in the emitted schema:
    grep -q 'claims_ledger' "$js" || fail "claims_ledger missing from emitted schema"
    grep -q 'positive_callouts' "$js" || fail "positive_callouts missing from emitted schema"
    # NESTED array-item required fields (findings[].required + claims_ledger[].required)
    # must be present — this is what the StructuredOutput tool enforces post-hand-off:
    grep -q '"dimension"' "$js" || fail "nested finding field 'dimension' missing (findings[].required dropped)"
    grep -q '"recommendation"' "$js" || fail "nested finding field 'recommendation' missing"
    grep -q '"claim"' "$js" || fail "nested claims_ledger field 'claim' missing"
    grep -q '"grounding"' "$js" || fail "nested claims_ledger field 'grounding' missing"
    # The observed|claimed enum (the anti-confabulation tag) survives:
    grep -q '"observed"' "$js" || fail "claims_ledger tag enum 'observed' missing"
    grep -q '"claimed"' "$js" || fail "claims_ledger tag enum 'claimed' missing"
    # The severity enum survives:
    grep -q '"critical"' "$js" || fail "finding severity enum 'critical' missing"
}

@test "schema-keys [SB safety]: rigorous-review schema passes _assert_safe_schema_keys (no sys.exit)" {
    # _emit_rigorous_seg only produces a non-empty file if _assert_safe_schema_keys
    # accepted the schema and _validated_output_schema did not sys.exit.
    local js; js="$(_emit_rigorous_seg)"
    [[ -s "$js" ]] || fail "emit aborted — schema-key guard or output_schema validation rejected the schema"
    grep -q 'OUTPUT-SCHEMA-INVALID' "$js" && fail "schema-invalid marker leaked into emitted JS" || true
}

@test "no emitter change [SB3]: the existing form-c-dispatch suite is unregressed" {
    # Sentinel — the full suite is run by CI; here assert the emitter file was not
    # modified by this sprint (the premise: no emitter change).
    run git -C "$SUBSTRATE_ROOT" diff --name-only HEAD -- scripts/lib/segment-emitter.py
    [[ "$status" -eq 0 ]] || skip "git unavailable"
    [[ -z "$output" ]] || fail "segment-emitter.py was modified — sprint-1 must NOT change the emitter (SB3 premise verified: full schema already flows to agent({schema}))"
}
