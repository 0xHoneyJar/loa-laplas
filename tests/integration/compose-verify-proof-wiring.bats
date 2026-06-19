#!/usr/bin/env bats
# =============================================================================
# compose-verify-proof-wiring.bats — verifiable-compose Epic B sprint-4 (#57).
# =============================================================================
# End-to-end: `compose-verify-run.sh --proof-of-operation` actually reaches
# Check 6 on a REAL compiled run and maps its verdict:
#   - declared op, no marker/receipt -> broken_run (exit 3) — the gate bites
#   - declared op, marker + valid signed receipt (2 families) -> valid_run (0)
#   - no proof-declared.json -> Check 6 no-op, run still valid_run (0) back-compat
# Reuses the dispatch fixture from compose-verify-run.bats. TMP=BATS_TEST_TMPDIR.
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    DISPATCH="$SUBSTRATE_ROOT/scripts/compose-dispatch.sh"
    VERIFY="$SUBSTRATE_ROOT/scripts/compose-verify-run.sh"
    CAP="$SUBSTRATE_ROOT/scripts/compose-proof-capture.py"
    PILOT="$SUBSTRATE_ROOT/compositions/code-implement-and-review.yaml"
    for f in "$DISPATCH" "$VERIFY" "$CAP" "$PILOT"; do [[ -f "$f" ]] || skip "missing $f"; done
    command -v python3 >/dev/null || skip "python3"; command -v jq >/dev/null || skip "jq"
    python3 -c "import cryptography" 2>/dev/null || skip "cryptography"

    TMPROOT="$BATS_TEST_TMPDIR"
    export LOA_PROJECT_ROOT="$TMPROOT"
    export LOA_GRIMOIRE_DIR="$TMPROOT/grimoires"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"
    if [[ -f "$SUBSTRATE_ROOT/../loa-constructs/.claude/schemas/runtime/composition.schema.json" ]]; then
        export LOA_COMPOSE_SCHEMA="$(cd "$SUBSTRATE_ROOT/../loa-constructs/.claude/schemas/runtime" && pwd)/composition.schema.json"
    fi
    KEYDIR="$TMPROOT/keys"; mkdir -p "$KEYDIR"; KEYID="gatekeeper-test"
    export LOA_AUDIT_KEY_DIR="$KEYDIR"
    python3 - "$KEYDIR" "$KEYID" <<'PY'
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

_compile_run() {
    bash "$DISPATCH" "$PILOT" --form-c --run-id "$1" --json >/dev/null 2>&1
    [[ "$?" -eq 3 ]] || { echo "compile failed" >&2; return 1; }
    echo "$1"
}
_rundir() { echo "$TMPROOT/.run/compose/$1"; }

@test "wiring: --proof-of-operation with a declared op + no marker/receipt -> broken_run (3)" {
    local rid; rid="$(_compile_run rrp-fail)" || fail "compile"
    local rd; rd="$(_rundir "$rid")"
    printf '[{"stage_index":9,"stage_id":"reviewer","operation":"multimodal-review","min_model_families":2}]\n' > "$rd/proof-declared.json"
    run bash "$VERIFY" "$rid" --proof-of-operation --json
    [[ "$status" -eq 3 ]] || fail "gate must bite (broken_run 3), got $status: $output"
    echo "$output" | jq -e '.verdict == "broken_run"' >/dev/null || fail "expected broken_run: $output"
}

@test "wiring: --proof-of-operation with marker + valid signed receipt (2 families) -> valid_run (0)" {
    local rid; rid="$(_compile_run rrp-pass)" || fail "compile"
    local rd; rd="$(_rundir "$rid")"
    printf '[{"stage_index":9,"stage_id":"reviewer","operation":"multimodal-review","min_model_families":2}]\n' > "$rd/proof-declared.json"
    printf '{"final_model_id":"anthropic:claude-opus-4-8","provider":"anthropic"}\n{"final_model_id":"openai:gpt-5.5","provider":"openai"}\n' > "$TMPROOT/mi.jsonl"
    python3 "$CAP" mark --run-dir "$rd" --stage-index 9 >/dev/null
    python3 "$CAP" capture --run-dir "$rd" --run-id "$rid" --stage-index 9 --stage-id reviewer \
        --operation multimodal-review --envelope-hash "sha256:e9" --modelinv "$TMPROOT/mi.jsonl" \
        --key-id "$KEYID" --key-dir "$KEYDIR" >/dev/null
    run bash "$VERIFY" "$rid" --proof-of-operation --json
    [[ "$status" -eq 0 ]] || fail "a proven op must pass (valid_run 0), got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null || fail "expected valid_run: $output"
}

@test "wiring: --proof-of-operation with no declaration is a no-op (valid_run 0, back-compat)" {
    local rid; rid="$(_compile_run rrp-noop)" || fail "compile"
    run bash "$VERIFY" "$rid" --proof-of-operation --json
    [[ "$status" -eq 0 ]] || fail "no declared op must not change the verdict, got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null || fail "expected valid_run: $output"
}
