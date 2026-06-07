#!/usr/bin/env bats
# =============================================================================
# compose-verify-run.bats — proof-of-run gate acceptance.
# =============================================================================
# compose-verify-run.sh is the FIRST tooth of "proof-of-run": it distinguishes a
# real governed Form C run (a manifest + emitted segment workflow(s) +
# orchestrator trail, optionally hash-verified handoff envelopes) from an inline
# role-played fake that produced composition-looking output with NO runtime
# provenance.
#
# It is READ-ONLY and ADDITIVE — it changes no existing dispatch/emit behavior.
#
# Cases:
#   - a REAL run (compiled here via compose-dispatch.sh --form-c on the pilot)
#     verifies clean (exit 0).
#   - a missing/forged run_id is `not_a_run` (non-zero).
#   - a TAMPERED manifest (run_id mismatch) is rejected.
#   - a DELETED segment workflow file is rejected (broken_run).
#   - a DELETED orchestrator.jsonl is rejected (broken_run).
#   - a TAMPERED handoff envelope (composition_run_id flipped) is rejected.
#   - a corrupt (unparseable) handoff envelope is rejected.
#   - the --json flag emits a structured verdict consumers can gate on.
#
# Uses REPO-RELATIVE paths (this pack's own scripts/), so it runs in standalone
# dev as well as when installed. State is isolated under a temp LOA_PROJECT_ROOT.
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    DISPATCH="$SUBSTRATE_ROOT/scripts/compose-dispatch.sh"
    VERIFY="$SUBSTRATE_ROOT/scripts/compose-verify-run.sh"
    HWRAP="$SUBSTRATE_ROOT/scripts/compose-handoff-wrap.sh"
    PILOT="$SUBSTRATE_ROOT/compositions/code-implement-and-review.yaml"

    [[ -f "$DISPATCH" ]] || skip "compose-dispatch.sh not found"
    [[ -f "$VERIFY" ]] || skip "compose-verify-run.sh not found"
    [[ -f "$PILOT" ]] || skip "pilot composition missing"

    # Resolve the bridge composition schema: env override, then sibling host repo.
    if [[ -n "${LOA_COMPOSE_SCHEMA:-}" && -f "${LOA_COMPOSE_SCHEMA:-}" ]]; then
        SCHEMA="$LOA_COMPOSE_SCHEMA"
    elif [[ -f "$SUBSTRATE_ROOT/../loa-constructs/.claude/schemas/runtime/composition.schema.json" ]]; then
        SCHEMA="$(cd "$SUBSTRATE_ROOT/../loa-constructs/.claude/schemas/runtime" && pwd)/composition.schema.json"
    else
        SCHEMA=""
    fi

    TMPROOT="$(mktemp -d)"
    export LOA_PROJECT_ROOT="$TMPROOT"
    [[ -n "$SCHEMA" ]] && export LOA_COMPOSE_SCHEMA="$SCHEMA"
    # Isolate clew side-effects to the temp dir (handoff-wrap path stays in-temp).
    export LOA_GRIMOIRE_DIR="$TMPROOT/grimoires"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

# Compile a real Form C run for the pilot under $TMPROOT; echo the run_id.
# compose-dispatch.sh --form-c exits 3 ("awaiting main loop") on SUCCESS.
_compile_run() {
    local run_id="${1:-rr1}"
    bash "$DISPATCH" "$PILOT" --form-c --run-id "$run_id" --json >/dev/null 2>&1
    local rc=$?
    [[ "$rc" -eq 3 ]] || { echo "compile failed (exit $rc)" >&2; return 1; }
    echo "$run_id"
}

# Wrap a handoff seed into a validated envelope for $run_id / $stage_index.
_wrap_envelope() {
    local run_id="$1" slug="$2" stage="$3"
    local seed
    seed="$(jq -nc --arg s "$slug" --argjson i "$stage" \
        '{construct_slug:$s, persona:($s|ascii_upcase), output_type:"Artifact", invocation_mode:"room", stage_index:$i, verdict:{output:"diff", rationale:"why"}}')"
    printf '%s' "$seed" | bash "$HWRAP" --seed - --cycle-id cycle-053 --run-id "$run_id" >/dev/null 2>&1
}

# -----------------------------------------------------------------------------
# Happy path — a real governed run (no envelopes yet: segments not executed)
# -----------------------------------------------------------------------------

@test "verify: a real compiled run (manifest + segment + orchestrator) verifies clean (exit 0)" {
    local rid; rid="$(_compile_run rr-clean)" || fail "could not compile run"
    run bash "$VERIFY" "$rid"
    [[ "$status" -eq 0 ]] || fail "expected exit 0 for a real run, got $status: $output"
}

@test "verify --json: a real run emits verdict=valid_run with structured proof fields" {
    local rid; rid="$(_compile_run rr-json)" || fail "could not compile run"
    run bash "$VERIFY" "$rid" --json
    [[ "$status" -eq 0 ]] || fail "expected exit 0, got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null || fail "expected verdict valid_run: $output"
    echo "$output" | jq -e '.run_id == "rr-json"' >/dev/null || fail "run_id missing from verdict: $output"
    echo "$output" | jq -e '.checks.manifest == true' >/dev/null || fail "manifest check missing: $output"
    echo "$output" | jq -e '.checks.segments_present == true' >/dev/null || fail "segment check missing: $output"
    echo "$output" | jq -e '.checks.orchestrator == true' >/dev/null || fail "orchestrator check missing: $output"
}

# -----------------------------------------------------------------------------
# Inline-fake / missing — no provenance at all
# -----------------------------------------------------------------------------

@test "verify: a fabricated run_id with no emit dir is not_a_run (non-zero)" {
    run bash "$VERIFY" "this-run-never-happened"
    [[ "$status" -ne 0 ]] || fail "a fabricated run_id must NOT verify"
    run bash "$VERIFY" "this-run-never-happened" --json
    echo "$output" | jq -e '.verdict == "not_a_run"' >/dev/null || fail "expected not_a_run verdict: $output"
    echo "$output" | jq -e '.reason | test("no.*manifest|no.*run")' >/dev/null || fail "expected a clear missing-manifest reason: $output"
}

@test "verify: an empty run dir (no manifest) is not_a_run" {
    mkdir -p "$TMPROOT/.run/compose/empty-dir"
    run bash "$VERIFY" "empty-dir" --json
    [[ "$status" -ne 0 ]] || fail "an empty run dir must NOT verify"
    echo "$output" | jq -e '.verdict == "not_a_run"' >/dev/null || fail "expected not_a_run: $output"
}

@test "verify: a missing run_id argument is a usage error (exit 1)" {
    run bash "$VERIFY"
    [[ "$status" -eq 1 ]] || fail "expected usage exit 1 with no run_id, got $status"
}

# -----------------------------------------------------------------------------
# Tamper / forgery — present but broken provenance
# -----------------------------------------------------------------------------

@test "verify: a manifest whose run_id mismatches the dir is rejected (forged)" {
    local rid; rid="$(_compile_run rr-mismatch)" || fail "could not compile run"
    local manifest="$TMPROOT/.run/compose/rr-mismatch/form-c-manifest.json"
    # Forge: rewrite the manifest's run_id to something else.
    jq '.run_id = "some-other-run"' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
    run bash "$VERIFY" "rr-mismatch" --json
    [[ "$status" -ne 0 ]] || fail "a run_id-mismatched manifest must be rejected"
    echo "$output" | jq -e '.reason | test("run_id")' >/dev/null || fail "expected a run_id mismatch reason: $output"
}

@test "verify: a corrupt (unparseable) manifest is rejected" {
    local rid; rid="$(_compile_run rr-corrupt)" || fail "could not compile run"
    printf 'not json {{{' > "$TMPROOT/.run/compose/rr-corrupt/form-c-manifest.json"
    run bash "$VERIFY" "rr-corrupt" --json
    [[ "$status" -ne 0 ]] || fail "a corrupt manifest must be rejected"
    echo "$output" | jq -e '.reason | test("parse|json")' >/dev/null || fail "expected a parse reason: $output"
}

@test "verify: a deleted segment workflow file is broken_run" {
    local rid; rid="$(_compile_run rr-noseg)" || fail "could not compile run"
    # Remove the emitted segment workflow the manifest references.
    rm -f "$TMPROOT/.run/compose/rr-noseg/workflows/"*.workflow.js
    run bash "$VERIFY" "rr-noseg" --json
    [[ "$status" -ne 0 ]] || fail "a missing segment workflow must fail"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
    echo "$output" | jq -e '.reason | test("segment|workflow")' >/dev/null || fail "expected a segment reason: $output"
}

@test "verify: a deleted orchestrator.jsonl is broken_run" {
    local rid; rid="$(_compile_run rr-noorch)" || fail "could not compile run"
    rm -f "$TMPROOT/.run/compose/rr-noorch/orchestrator.jsonl"
    run bash "$VERIFY" "rr-noorch" --json
    [[ "$status" -ne 0 ]] || fail "a missing orchestrator trail must fail"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
    echo "$output" | jq -e '.reason | test("orchestrator")' >/dev/null || fail "expected an orchestrator reason: $output"
}

@test "verify: an orchestrator that never records this run_id is rejected" {
    local rid; rid="$(_compile_run rr-orchforge)" || fail "could not compile run"
    # Overwrite the trail with events for a DIFFERENT run_id (forged trail).
    jq -c '.run_id = "other-run"' "$TMPROOT/.run/compose/rr-orchforge/orchestrator.jsonl" \
        > "$TMPROOT/.run/compose/rr-orchforge/orchestrator.jsonl.tmp" \
        && mv "$TMPROOT/.run/compose/rr-orchforge/orchestrator.jsonl.tmp" \
              "$TMPROOT/.run/compose/rr-orchforge/orchestrator.jsonl"
    run bash "$VERIFY" "rr-orchforge" --json
    [[ "$status" -ne 0 ]] || fail "an orchestrator trail that never names this run must fail"
    echo "$output" | jq -e '.reason | test("orchestrator|run_id")' >/dev/null || fail "expected an orchestrator/run_id reason: $output"
}

# -----------------------------------------------------------------------------
# Handoff envelopes (segments executed) — integrity of the executed run
# -----------------------------------------------------------------------------

@test "verify: a run with valid handoff envelopes verifies clean and reports envelope_count" {
    local rid; rid="$(_compile_run rr-env)" || fail "could not compile run"
    _wrap_envelope "rr-env" "codex-rescue" 1 || fail "could not wrap envelope"
    run bash "$VERIFY" "rr-env" --json
    [[ "$status" -eq 0 ]] || fail "a run with a valid envelope must verify, got $status: $output"
    echo "$output" | jq -e '.checks.envelopes == true' >/dev/null || fail "envelope check missing: $output"
    echo "$output" | jq -e '.envelope_count == 1' >/dev/null || fail "expected envelope_count 1: $output"
}

@test "verify: a handoff envelope whose composition_run_id mismatches the run is rejected" {
    local rid; rid="$(_compile_run rr-envbad)" || fail "could not compile run"
    _wrap_envelope "rr-envbad" "codex-rescue" 1 || fail "could not wrap envelope"
    local env="$TMPROOT/.run/compose/rr-envbad/envelopes/01.codex-rescue.handoff.json"
    jq '.composition_run_id = "a-different-run"' "$env" > "$env.tmp" && mv "$env.tmp" "$env"
    run bash "$VERIFY" "rr-envbad" --json
    [[ "$status" -ne 0 ]] || fail "an envelope with a mismatched composition_run_id must fail"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
    echo "$output" | jq -e '.reason | test("envelope|run_id")' >/dev/null || fail "expected an envelope reason: $output"
}

@test "verify: a corrupt (unparseable) handoff envelope is rejected" {
    local rid; rid="$(_compile_run rr-envcorrupt)" || fail "could not compile run"
    _wrap_envelope "rr-envcorrupt" "codex-rescue" 1 || fail "could not wrap envelope"
    printf 'garbage {{{' > "$TMPROOT/.run/compose/rr-envcorrupt/envelopes/01.codex-rescue.handoff.json"
    run bash "$VERIFY" "rr-envcorrupt" --json
    [[ "$status" -ne 0 ]] || fail "a corrupt envelope must fail"
    echo "$output" | jq -e '.reason | test("envelope|parse|json")' >/dev/null || fail "expected an envelope parse reason: $output"
}

@test "verify: a handoff envelope for a stage_index not in the manifest is rejected" {
    local rid; rid="$(_compile_run rr-envstage)" || fail "could not compile run"
    # Stage 99 is not part of the pilot's chain.
    _wrap_envelope "rr-envstage" "codex-rescue" 99 || fail "could not wrap envelope"
    run bash "$VERIFY" "rr-envstage" --json
    [[ "$status" -ne 0 ]] || fail "an envelope for an unknown stage must fail"
    echo "$output" | jq -e '.reason | test("stage")' >/dev/null || fail "expected a stage reason: $output"
}
