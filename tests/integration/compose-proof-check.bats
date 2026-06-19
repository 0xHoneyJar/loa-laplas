#!/usr/bin/env bats
# =============================================================================
# compose-proof-check.bats — verifiable-compose Epic B sprint-4 (RFC #57).
# =============================================================================
# Check 6 (proof-of-operation verifier, fail-closed) — the negative-test battery.
# Drives `compose-proof-capture.py check` against constructed run dirs.
#   VC-B1  declared op, no marker + no receipt           -> broken_run (3)
#   VC-B2  two SAME-family ids on min_model_families:2   -> broken_run (3)  [B6]
#   VC-B3  >=2 families, correlated, sig-valid           -> valid (0)
#   VC-B4  non-FAGAN construct declaring                 -> gate-checked identically
#   B5/SB1 forged receipt (invented ids, no valid sig)   -> broken_run (3)
#   B4     replay (valid receipt from another run/stage) -> broken_run (3)
#   SB5    marker present + no real call (no receipt)     -> degraded_run (2), queued
#   SB6    unmapped final_model_id                        -> broken_run (3) + ignored
#   B3     marker present, receipt absent                 -> degraded_run (2)
#   back-compat: no proof-declared.json                   -> no-op (0)
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    CAP="$ROOT/scripts/compose-proof-capture.py"
    [[ -f "$CAP" ]] || skip "compose-proof-capture.py not found"
    command -v python3 >/dev/null || skip "python3 required"
    python3 -c "import cryptography" 2>/dev/null || skip "cryptography not installed"
    command -v jq >/dev/null || skip "jq required"
    TMP="$BATS_TEST_TMPDIR"
    KEYDIR="$TMP/keys"; mkdir -p "$KEYDIR"; KEYID="gatekeeper-test"
    _mint_key "$KEYDIR" "$KEYID"
    RUN="$TMP/run"
}

_mint_key() {
    python3 - "$1" "$2" <<'PY'
import sys, os
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
d, kid = Path(sys.argv[1]), sys.argv[2]
k = Ed25519PrivateKey.generate()
(d / f"{kid}.priv").write_bytes(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
(d / f"{kid}.pub").write_bytes(k.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
os.chmod(d / f"{kid}.priv", 0o600)
PY
}

_modelinv() { : > "$1"; local path="$1"; shift; local i=0
    for id in "$@"; do
        printf '{"final_model_id":"%s","provider":"%s","invocation_id":"inv-%d","timestamp":"2026-06-19T00:00:0%dZ"}\n' "$id" "${id%%:*}" "$i" "$i" >> "$path"; i=$((i+1)); done
}

# proof-declared.json with one declaring stage
_declare() {  # run-dir idx stage_id op minfam
    mkdir -p "$1"
    printf '[{"stage_index":%s,"stage_id":"%s","operation":"%s","min_model_families":%s}]\n' "$2" "$3" "$4" "$5" > "$1/proof-declared.json"
}
_capture() {  # run-dir run-id idx stage_id op modelinv
    python3 "$CAP" capture --run-dir "$1" --run-id "$2" --stage-index "$3" --stage-id "$4" \
        --operation "$5" --envelope-hash "sha256:env$3" --modelinv "$6" --key-id "$KEYID" --key-dir "$KEYDIR" >/dev/null
}
_check() { python3 "$CAP" check --run-dir "$1" --run-id "$2" --pubkey-dir "$KEYDIR"; }

@test "VC-B1: declared op, no marker + no receipt -> broken_run (3)" {
    _declare "$RUN" 4 synthesize multimodal-review 2
    run _check "$RUN" r1
    [[ "$status" -eq 3 ]] || fail "expected broken_run 3, got $status: $output"
    echo "$output" | grep -q "never ran" || fail "reason should say never ran: $output"
}

@test "VC-B2 [B6]: two SAME-family ids on min 2 -> broken_run (3)" {
    _declare "$RUN" 4 synthesize multimodal-review 2
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "anthropic:claude-sonnet-4-6"
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    _capture "$RUN" r1 4 synthesize multimodal-review "$TMP/mi.jsonl"
    run _check "$RUN" r1
    [[ "$status" -eq 3 ]] || fail "same-family must be under-family broken, got $status: $output"
    echo "$output" | grep -q "< required 2" || fail "reason should cite family shortfall: $output"
}

@test "VC-B3: >=2 families, correlated, sig-valid -> valid (0)" {
    _declare "$RUN" 4 synthesize multimodal-review 2
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:gpt-5.5"
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    _capture "$RUN" r1 4 synthesize multimodal-review "$TMP/mi.jsonl"
    run _check "$RUN" r1
    [[ "$status" -eq 0 ]] || fail "valid run must pass, got $status: $output"
    echo "$output" | grep -q '"check6": "valid"' || fail "expected valid: $output"
}

@test "VC-B4: a non-FAGAN construct's declaration is gate-checked identically" {
    _declare "$RUN" 2 my-custom-reviewer design-council 2
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "google:gemini-2.5-pro"
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 2 >/dev/null
    _capture "$RUN" r1 2 my-custom-reviewer design-council "$TMP/mi.jsonl"
    run _check "$RUN" r1
    [[ "$status" -eq 0 ]] || fail "non-FAGAN declaration must validate identically, got $status: $output"
}

@test "[B5/SB1]: forged receipt (invented ids, no valid sig) -> broken_run (3)" {
    _declare "$RUN" 4 synthesize multimodal-review 2
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    mkdir -p "$RUN/receipts"
    cat > "$RUN/receipts/4.json" <<'J'
{"payload":{"compose_run_id":"r1","stage_index":4,"stage_id":"synthesize","operation":"multimodal-review","envelope_hash":"sha256:env4","invocations":[{"final_model_id":"anthropic:claude-opus-4-8","model_family":"anthropic"},{"final_model_id":"openai:gpt-5.5","model_family":"openai"}],"families":["anthropic","openai"],"family_count":2},"signing_key_id":"gatekeeper-test","sig":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
J
    run _check "$RUN" r1
    [[ "$status" -eq 3 ]] || fail "forged-sig receipt must be broken, got $status: $output"
    echo "$output" | grep -q "signature invalid" || fail "reason should cite bad sig: $output"
}

@test "[B4]: replay (valid receipt from a DIFFERENT run) -> broken_run (3) correlation" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:gpt-5.5"
    # genuine receipt for run r1 stage 4
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    _capture "$RUN" r1 4 synthesize multimodal-review "$TMP/mi.jsonl"
    # attacker declares run r2 and copies r1's receipt in
    _declare "$TMP/run2" 4 synthesize multimodal-review 2
    mkdir -p "$TMP/run2/receipts" "$TMP/run2/attempted"
    cp "$RUN/receipts/4.json" "$TMP/run2/receipts/4.json"
    touch "$TMP/run2/attempted/4"
    run _check "$TMP/run2" r2
    [[ "$status" -eq 3 ]] || fail "replayed receipt must fail correlation, got $status: $output"
    echo "$output" | grep -q "correlation mismatch" || fail "reason should cite correlation: $output"
}

@test "[SB5/B3]: marker present + no receipt -> degraded_run (2), queued to verify-fail" {
    _declare "$RUN" 4 synthesize multimodal-review 2
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    run _check "$RUN" r1
    [[ "$status" -eq 2 ]] || fail "marker-without-receipt must be degraded(2), got $status: $output"
    [[ -f "$RUN/verify-fail.jsonl" ]] || fail "SB5: degraded must be queued to verify-fail.jsonl"
    grep -q "degraded_run" "$RUN/verify-fail.jsonl" || fail "verify-fail.jsonl should record degraded"
}

@test "[SB6]: an unmapped final_model_id cannot satisfy a family slot -> broken_run (3)" {
    _declare "$RUN" 4 synthesize multimodal-review 2
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "mystery-model-9000"
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    _capture "$RUN" r1 4 synthesize multimodal-review "$TMP/mi.jsonl"
    run _check "$RUN" r1
    [[ "$status" -eq 3 ]] || fail "unmapped id must not satisfy a slot, got $status: $output"
    echo "$output" | grep -q "SB6 unmapped" || fail "reason should flag unmapped (audit signal): $output"
}

@test "back-compat: no proof-declared.json -> Check 6 no-op (0)" {
    mkdir -p "$RUN"
    run _check "$RUN" r1
    [[ "$status" -eq 0 ]] || fail "no declaration must be a no-op, got $status: $output"
    echo "$output" | grep -q "no-op" || fail "expected no-op: $output"
}

@test "tamper: proof-declared.json deleted but artifacts present -> broken_run (3)" {
    # An attacker removes the requirement list to skip the gate, leaving a marker.
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    [[ ! -f "$RUN/proof-declared.json" ]] || rm -f "$RUN/proof-declared.json"
    run _check "$RUN" r1
    [[ "$status" -eq 3 ]] || fail "deleted declaration + present artifacts must be broken, got $status: $output"
    echo "$output" | grep -q "tamper" || fail "reason should flag tamper: $output"
}

@test "[BB#1]: a corrupt receipt makes Check 6 fail CLOSED (broken_run 3, never valid)" {
    _declare "$RUN" 4 synthesize multimodal-review 2
    python3 "$CAP" mark --run-dir "$RUN" --stage-index 4 >/dev/null
    mkdir -p "$RUN/receipts"
    printf '{ this is not valid json ]' > "$RUN/receipts/4.json"
    run _check "$RUN" r1
    [[ "$status" -eq 3 ]] || fail "corrupt receipt must be broken_run 3 (fail closed), got $status: $output"
    echo "$output" | grep -qi "corrupt" || fail "reason should cite corrupt receipt: $output"
}

@test "[BB#3]: a non-integer stage_index is rejected (broken_run 3, no path-join)" {
    mkdir -p "$RUN"
    printf '[{"stage_index":"../../../etc/passwd","stage_id":"x","operation":"op","min_model_families":1}]\n' > "$RUN/proof-declared.json"
    run _check "$RUN" r1
    [[ "$status" -eq 3 ]] || fail "path-traversal stage_index must be broken, got $status: $output"
    echo "$output" | grep -qi "invalid stage_index" || fail "reason should flag invalid index: $output"
}
