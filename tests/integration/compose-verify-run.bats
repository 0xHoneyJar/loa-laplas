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

# -----------------------------------------------------------------------------
# CVR-001 — run_id path traversal (HIGH). An unvalidated run_id is concatenated
# into .run/compose/<run_id>/... — a `../`-bearing run_id would escape the run
# base and let an attacker steer the verifier at an arbitrary directory. The
# verifier MUST reject a malformed run_id BEFORE constructing any path, and MUST
# NOT accept a planted manifest reached via traversal.
# -----------------------------------------------------------------------------

@test "verify: a ../-bearing run_id is rejected and never escapes the run base (CVR-001)" {
    # Compile a FULLY VALID run, then forge its manifest+orchestrator run_id field
    # to MATCH a traversal string. `.run/compose/../compose/<run>` resolves back to
    # the real valid dir, and the forged run_id field defeats the manifest/orch
    # run_id-match checks — so WITHOUT run_id validation the verifier returns
    # valid_run for a path containing `..` (the escape: an attacker can steer the
    # verifier at any directory on disk). With validation, the malformed run_id is
    # refused before any path is built.
    local good; good="$(_compile_run rr-traversal-target)" || fail "could not compile target run"
    local traversal="../compose/rr-traversal-target"
    local m="$TMPROOT/.run/compose/rr-traversal-target/form-c-manifest.json"
    local o="$TMPROOT/.run/compose/rr-traversal-target/orchestrator.jsonl"
    jq --arg r "$traversal" '.run_id = $r' "$m" > "$m.tmp" && mv "$m.tmp" "$m"
    jq -c --arg r "$traversal" '.run_id = $r' "$o" > "$o.tmp" && mv "$o.tmp" "$o"
    run bash "$VERIFY" "$traversal" --json
    [[ "$status" -ne 0 ]] || fail "a ../-bearing run_id must NOT verify (path traversal escape): $output"
    echo "$output" | jq -e '.verdict != "valid_run"' >/dev/null \
        || fail "traversal run_id must NOT be accepted as valid_run: $output"
    echo "$output" | jq -e '.verdict == "not_a_run" or .verdict == "broken_run"' >/dev/null \
        || fail "expected not_a_run/broken_run for a traversal run_id: $output"
    echo "$output" | jq -e '.reason | test("run_id|invalid|traversal")' >/dev/null \
        || fail "expected an invalid-run_id reason: $output"
}

@test "verify: assorted malformed run_ids (slash, leading dash, absolute) are rejected (CVR-001)" {
    for bad in "a/b" "-rf" "/etc/passwd" "x/../../y" "..//x"; do
        run bash "$VERIFY" "$bad" --json
        [[ "$status" -ne 0 ]] || fail "malformed run_id '$bad' must be rejected: $output"
    done
}

@test "verify: a legit generated-shape run_id (YYYYMMDD-hex) still passes the allowlist (CVR-001 no false-positive)" {
    # compose-dispatch generates run_id as $(date -u +%Y%m%d)-$(openssl rand -hex 3).
    local rid="20260607-abab39"
    rid="$(_compile_run "$rid")" || fail "could not compile run with generated-shape run_id"
    run bash "$VERIFY" "$rid"
    [[ "$status" -eq 0 ]] || fail "a date-hash run_id must verify clean (allowlist false-positive), got $status: $output"
}

# -----------------------------------------------------------------------------
# CVR-003 — handoff-validate exit-code corridor (HIGH, worst). The validator's
# contract is 0=OK, 1=FAIL, 2=BLOCKER. Previously only exit 1 failed the gate;
# any other non-zero (2 BLOCKER, 127 missing, ...) silently passed. The verifier
# must be conservative-by-default: ANY non-zero from the validator → broken_run.
# We stub the host-install validator path so the verifier picks it up first.
# -----------------------------------------------------------------------------

_stub_validator() {
    # $1 = exit code the stub should return for every envelope.
    local code="$1"
    mkdir -p "$TMPROOT/.claude/scripts"
    cat > "$TMPROOT/.claude/scripts/handoff-validate.sh" <<EOF
#!/usr/bin/env bash
exit $code
EOF
    chmod +x "$TMPROOT/.claude/scripts/handoff-validate.sh"
}

@test "verify: a handoff-validate exit code of 2 (BLOCKER) fails the gate, not a silent pass (CVR-003)" {
    local rid; rid="$(_compile_run rr-vexit2)" || fail "could not compile run"
    _wrap_envelope "rr-vexit2" "codex-rescue" 1 || fail "could not wrap envelope"
    _stub_validator 2
    run bash "$VERIFY" "rr-vexit2" --json
    [[ "$status" -ne 0 ]] || fail "validator exit 2 must NOT silently pass: $output"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
    echo "$output" | jq -e '.reason | test("valid|envelope")' >/dev/null || fail "expected a validation reason: $output"
}

@test "verify: a handoff-validate exit code of 3 (undefined) fails the gate, not a silent pass (CVR-003)" {
    local rid; rid="$(_compile_run rr-vexit3)" || fail "could not compile run"
    _wrap_envelope "rr-vexit3" "codex-rescue" 1 || fail "could not wrap envelope"
    _stub_validator 3
    run bash "$VERIFY" "rr-vexit3" --json
    [[ "$status" -ne 0 ]] || fail "validator exit 3 must NOT silently pass: $output"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
}

@test "verify: a handoff-validate exit code of 127 (not found) fails the gate (CVR-003)" {
    local rid; rid="$(_compile_run rr-vexit127)" || fail "could not compile run"
    _wrap_envelope "rr-vexit127" "codex-rescue" 1 || fail "could not wrap envelope"
    _stub_validator 127
    run bash "$VERIFY" "rr-vexit127" --json
    [[ "$status" -ne 0 ]] || fail "validator exit 127 must NOT silently pass: $output"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
}

@test "verify: a handoff-validate exit code of 0 (OK) still passes (CVR-003 no false-negative)" {
    local rid; rid="$(_compile_run rr-vexit0)" || fail "could not compile run"
    _wrap_envelope "rr-vexit0" "codex-rescue" 1 || fail "could not wrap envelope"
    _stub_validator 0
    run bash "$VERIFY" "rr-vexit0" --json
    [[ "$status" -eq 0 ]] || fail "validator exit 0 must pass, got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null || fail "expected valid_run: $output"
}

# -----------------------------------------------------------------------------
# CVR-002 — hasher portability (HIGH, silent CI failure). The fallback hash used
# `shasum -a 256` (macOS-only). On Linux/CI without shasum it fails silently.
# Must prefer sha256sum, fall back to shasum, and FAIL LOUDLY if neither exists.
# We constrain PATH to a minimal dir we populate so we can hide a hasher.
# -----------------------------------------------------------------------------

# Build a minimal bin dir symlinking the core tools the verifier needs, then
# optionally a single hasher. Echoes the bin dir path.
_minimal_bin() {
    local want_hasher="$1"   # sha256sum | shasum | none
    local bindir="$TMPROOT/minbin-$want_hasher"
    mkdir -p "$bindir"
    local t
    for t in bash jq awk sort sed grep find basename dirname cat printf cut tr head tail mktemp realpath python3 openssl env date chmod mkdir rm cp mv ls wc; do
        local p; p="$(command -v "$t" 2>/dev/null || true)"
        [[ -n "$p" ]] && ln -sf "$p" "$bindir/$t" 2>/dev/null || true
    done
    case "$want_hasher" in
        sha256sum) local p; p="$(command -v sha256sum || true)"; [[ -n "$p" ]] && ln -sf "$p" "$bindir/sha256sum" ;;
        shasum)    local p; p="$(command -v shasum || true)";    [[ -n "$p" ]] && ln -sf "$p" "$bindir/shasum" ;;
        none)      : ;;  # neither hasher linked
    esac
    echo "$bindir"
}

@test "verify: hashing works when only sha256sum is on PATH (CVR-002)" {
    command -v sha256sum >/dev/null || skip "sha256sum not installed on this host"
    local rid; rid="$(_compile_run rr-only256)" || fail "could not compile run"
    _wrap_envelope "rr-only256" "codex-rescue" 1 || fail "could not wrap envelope"
    local bindir; bindir="$(_minimal_bin sha256sum)"
    run env PATH="$bindir" LOA_PROJECT_ROOT="$TMPROOT" LOA_COMPOSE_SCHEMA="${LOA_COMPOSE_SCHEMA:-}" \
        bash "$VERIFY" "rr-only256" --json
    [[ "$status" -eq 0 ]] || fail "verify must work with only sha256sum, got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null || fail "expected valid_run: $output"
    echo "$output" | jq -e '.envelope_count == 1' >/dev/null || fail "expected the envelope to be found+checked: $output"
    echo "$output" | jq -e '.envelope_digest | test("^sha256:")' >/dev/null \
        || fail "expected an sha256 envelope_digest: $output"
}

@test "verify: hashing works when only shasum is on PATH (CVR-002 fallback)" {
    command -v shasum >/dev/null || skip "shasum not installed on this host"
    local rid; rid="$(_compile_run rr-onlyshasum)" || fail "could not compile run"
    _wrap_envelope "rr-onlyshasum" "codex-rescue" 1 || fail "could not wrap envelope"
    local bindir; bindir="$(_minimal_bin shasum)"
    run env PATH="$bindir" LOA_PROJECT_ROOT="$TMPROOT" LOA_COMPOSE_SCHEMA="${LOA_COMPOSE_SCHEMA:-}" \
        bash "$VERIFY" "rr-onlyshasum" --json
    [[ "$status" -eq 0 ]] || fail "verify must work with only shasum, got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null || fail "expected valid_run: $output"
    echo "$output" | jq -e '.envelope_digest | test("^sha256:")' >/dev/null \
        || fail "expected an sha256 envelope_digest: $output"
}

@test "verify: hashing FAILS LOUDLY when neither sha256sum nor shasum is on PATH (CVR-002)" {
    local rid; rid="$(_compile_run rr-nohasher)" || fail "could not compile run"
    _wrap_envelope "rr-nohasher" "codex-rescue" 1 || fail "could not wrap envelope"
    local bindir; bindir="$(_minimal_bin none)"
    run env PATH="$bindir" LOA_PROJECT_ROOT="$TMPROOT" LOA_COMPOSE_SCHEMA="${LOA_COMPOSE_SCHEMA:-}" \
        bash "$VERIFY" "rr-nohasher" --json
    # MUST NOT silently pass: a missing hasher means integrity is uncheckable.
    [[ "$status" -ne 0 ]] || fail "verify must FAIL LOUDLY with no hasher, got exit 0: $output"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null \
        || fail "expected broken_run with no hasher: $output"
    # The envelope WAS found (find present) — the failure is the hasher, surfaced.
    echo "$output" | jq -e '.envelope_count == 1' >/dev/null \
        || fail "envelope should have been enumerated; failure must be the hasher: $output"
    echo "$output" | jq -e '.reason | test("sha256|hasher|integrity")' >/dev/null \
        || fail "expected a loud hasher/integrity reason (not a silent pass): $output"
}

# -----------------------------------------------------------------------------
# CVR-005 — envelopes-present but no manifest stages (MED, silent-pass). The
# stage_index check was silently skipped when the manifest declared no stages,
# so an envelope with any stage_index passed unchecked. Envelopes present + no
# manifest stages to validate against is an inconsistency → broken_run.
# -----------------------------------------------------------------------------

@test "verify: envelopes present but manifest has no stages is broken_run, not a silent pass (CVR-005)" {
    local rid; rid="$(_compile_run rr-nostages)" || fail "could not compile run"
    _wrap_envelope "rr-nostages" "codex-rescue" 1 || fail "could not wrap envelope"
    # Strip every segment's stages so there are NO manifest stages to validate against.
    local manifest="$TMPROOT/.run/compose/rr-nostages/form-c-manifest.json"
    jq '(.segments[]?.stages) = []' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
    run bash "$VERIFY" "rr-nostages" --json
    [[ "$status" -ne 0 ]] || fail "envelopes + no manifest stages must NOT silently pass: $output"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
    echo "$output" | jq -e '.reason | test("stage|manifest")' >/dev/null || fail "expected a stage/manifest reason: $output"
}
