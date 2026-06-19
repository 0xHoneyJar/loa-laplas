#!/usr/bin/env bats
# =============================================================================
# compose-proof.bats — verifiable-compose Epic B sprint-3 (RFC #57).
# =============================================================================
# The isolated proof-of-operation writer (compose-proof-capture.py):
#   AC1  — a DECLARING stage produces an attempted-marker + a signed, correlated
#          receipt; a NON-declaring stage produces neither (no-op).
#   [B5] — the receipt sig verifies under the gatekeeper public key; a receipt
#          tampered / verified without the right key fails.
#   [B7] — the id->family map resolves opus+sonnet to ONE (anthropic) family;
#          genuine cross-vendor resolves to two; unmapped ids do not count.
# Reuses the existing audit-signing-helper.py (gatekeeper Ed25519 — no new
# primitive). Keys are minted ephemerally per test. TMP=BATS_TEST_TMPDIR
# (auto-cleaned by bats — no manual cleanup).
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    CAP="$ROOT/scripts/compose-proof-capture.py"
    [[ -f "$CAP" ]] || skip "compose-proof-capture.py not found"
    command -v python3 >/dev/null || skip "python3 required"
    python3 -c "import cryptography" 2>/dev/null || skip "python cryptography not installed"
    python3 -c "import yaml" 2>/dev/null || skip "PyYAML not installed"
    TMP="$BATS_TEST_TMPDIR"
    KEYDIR="$TMP/keys"; mkdir -p "$KEYDIR"
    KEYID="gatekeeper-test"
    _mint_key "$KEYDIR" "$KEYID"
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

_modelinv() {  # $1=path, then ids written as MODELINV-ish records
    : > "$1"; local path="$1"; shift
    local i=0
    for id in "$@"; do
        printf '{"final_model_id":"%s","provider":"%s","invocation_id":"inv-%d","provider_response_hash":"sha256:%d","timestamp":"2026-06-19T00:00:0%dZ"}\n' \
            "$id" "${id%%:*}" "$i" "$i" "$i" >> "$path"
        i=$((i+1))
    done
}

@test "[B7]: opus + sonnet resolve to ONE family (anthropic)" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "anthropic:claude-sonnet-4-6"
    run python3 "$CAP" families --modelinv "$TMP/mi.jsonl"
    [[ "$status" -eq 0 ]] || fail "$output"
    echo "$output" | jq -e '.family_count == 1 and .families == ["anthropic"]' >/dev/null || fail "expected 1 anthropic family: $output"
}

@test "[B7]: genuine cross-vendor (opus + gpt) resolves to TWO families" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:gpt-5.5"
    run python3 "$CAP" families --modelinv "$TMP/mi.jsonl"
    echo "$output" | jq -e '.family_count == 2' >/dev/null || fail "expected 2 families: $output"
}

@test "[B7/SB6]: an unmapped id does not count toward a family slot" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "mystery-model-9000"
    run python3 "$CAP" families --modelinv "$TMP/mi.jsonl"
    echo "$output" | jq -e '.family_count == 1 and (.unmapped | index("mystery-model-9000"))' >/dev/null || fail "unmapped id must not count: $output"
}

@test "[B5]: captured receipt verifies under the gatekeeper public key" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:gpt-5.5"
    run python3 "$CAP" capture --run-dir "$TMP/run" --run-id "r1" --stage-index 4 \
        --stage-id synthesize --operation multimodal-review --envelope-hash "sha256:abc" \
        --modelinv "$TMP/mi.jsonl" --key-id "$KEYID" --key-dir "$KEYDIR"
    [[ "$status" -eq 0 ]] || fail "capture failed: $output"
    [[ -f "$TMP/run/receipts/4.json" ]] || fail "receipt not written"
    run python3 "$CAP" verify-receipt --receipt "$TMP/run/receipts/4.json" --pubkey-dir "$KEYDIR"
    [[ "$status" -eq 0 ]] || fail "valid receipt should verify: $output"
}

@test "[B5]: a tampered receipt payload fails verification (forgery)" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:gpt-5.5"
    python3 "$CAP" capture --run-dir "$TMP/run" --run-id "r1" --stage-index 4 \
        --stage-id synthesize --operation multimodal-review --envelope-hash "sha256:abc" \
        --modelinv "$TMP/mi.jsonl" --key-id "$KEYID" --key-dir "$KEYDIR"
    jq '.payload.envelope_hash = "sha256:FORGED"' "$TMP/run/receipts/4.json" > "$TMP/forged.json"
    run python3 "$CAP" verify-receipt --receipt "$TMP/forged.json" --pubkey-dir "$KEYDIR"
    [[ "$status" -eq 3 ]] || fail "tampered receipt must fail verification, got $status: $output"
}

@test "[B5]: a receipt verified against a DIFFERENT key fails" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:gpt-5.5"
    python3 "$CAP" capture --run-dir "$TMP/run" --run-id "r1" --stage-index 4 \
        --stage-id synthesize --operation multimodal-review --envelope-hash "sha256:abc" \
        --modelinv "$TMP/mi.jsonl" --key-id "$KEYID" --key-dir "$KEYDIR"
    local OTHER="$TMP/otherkeys"; mkdir -p "$OTHER"; _mint_key "$OTHER" "$KEYID"
    run python3 "$CAP" verify-receipt --receipt "$TMP/run/receipts/4.json" --pubkey-dir "$OTHER"
    [[ "$status" -eq 3 ]] || fail "wrong-key verification must fail, got $status"
}

@test "AC1: mark writes the attempted marker into a 0700 dir" {
    run python3 "$CAP" mark --run-dir "$TMP/run" --stage-index 4
    [[ "$status" -eq 0 ]] || fail "$output"
    [[ -f "$TMP/run/attempted/4" ]] || fail "attempted marker not written"
    perms=$(stat -f '%Lp' "$TMP/run/attempted" 2>/dev/null || stat -c '%a' "$TMP/run/attempted")
    [[ "$perms" == "700" ]] || fail "attempted dir not 0700 (got $perms)"
}

@test "AC1: should-verify gates on the verify declaration (declaring vs not)" {
    cat > "$TMP/declaring.yaml" <<'YML'
capabilities:
  verify:
    operation: multimodal-review
    receipt: model-invoke.jsonl
    min_model_families: 2
YML
    cat > "$TMP/plain.yaml" <<'YML'
capabilities:
  model_tier: cheap
YML
    run python3 "$CAP" should-verify --spec "$TMP/declaring.yaml"
    [[ "$status" -eq 0 ]] || fail "declaring construct should gate IN: $output"
    run python3 "$CAP" should-verify --spec "$TMP/plain.yaml"
    [[ "$status" -eq 1 ]] || fail "non-declaring construct should gate OUT (no-op), got $status"
}

@test "AC1: receipt payload binds the correlation fields (run/stage/op/hash)" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:gpt-5.5"
    python3 "$CAP" capture --run-dir "$TMP/run" --run-id "r1" --stage-index 4 \
        --stage-id synthesize --operation multimodal-review --envelope-hash "sha256:abc" \
        --modelinv "$TMP/mi.jsonl" --key-id "$KEYID" --key-dir "$KEYDIR"
    run jq -e '.payload | (.compose_run_id=="r1" and .stage_index==4 and .stage_id=="synthesize" and .operation=="multimodal-review" and .envelope_hash=="sha256:abc" and .family_count==2)' "$TMP/run/receipts/4.json"
    [[ "$status" -eq 0 ]] || fail "correlation fields not bound: $(cat "$TMP/run/receipts/4.json")"
}

@test "[BB#2]: provider-prefix spoof (anthropic:gpt-5.5) does NOT count as anthropic" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "anthropic:gpt-5.5"
    run python3 "$CAP" families --modelinv "$TMP/mi.jsonl"
    # gpt-5.5 under an anthropic prefix is a mismatch -> unmapped -> only 1 real family
    echo "$output" | jq -e '.family_count == 1 and (.unmapped | index("anthropic:gpt-5.5"))' >/dev/null || fail "prefix spoof must not satisfy a slot: $output"
}

@test "[BB#2]: a legit provider:model still resolves; openai:claude-* is rejected" {
    _modelinv "$TMP/mi.jsonl" "anthropic:claude-opus-4-8" "openai:claude-opus-4-8"
    run python3 "$CAP" families --modelinv "$TMP/mi.jsonl"
    echo "$output" | jq -e '.family_count == 1 and .families == ["anthropic"] and (.unmapped | index("openai:claude-opus-4-8"))' >/dev/null || fail "model-name authority broken: $output"
}
