#!/usr/bin/env bats
# =============================================================================
# clew-hook-never-blocks.bats — Bridgebuilder F-002 (PR #21): the clew capture
# hooks MUST exit 0 on every early-failure path so they can never block their
# host event (Stop / UserPromptSubmit).
# =============================================================================
# Both loa-clew-capture-agent.sh (Stop hook) and loa-clew-capture.sh
# (UserPromptSubmit hook) run `source ledger-append.sh` at top level under
# `set -euo pipefail`. Without the trap + explicit source-guard, a missing or
# parse-error sibling would propagate a non-zero exit and BLOCK the host event.
# The fix: `trap 'exit 0' ERR` + `... || exit 0` on the source (the ERR trap
# alone does NOT fire for a failed `source` builtin — a bash quirk).
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
    AGENT_HOOK="$SUBSTRATE_ROOT/scripts/clew/loa-clew-capture-agent.sh"
    OP_HOOK="$SUBSTRATE_ROOT/scripts/clew/loa-clew-capture.sh"
    [[ -f "$AGENT_HOOK" ]] || skip "loa-clew-capture-agent.sh not found"
    [[ -f "$OP_HOOK" ]] || skip "loa-clew-capture.sh not found"
    TMPROOT="$(mktemp -d)"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

# Copy a hook into an isolated dir, optionally with a broken/missing ledger-append.sh
# sibling, then run it. $1 = source hook path, $2 = sibling state (present|missing|broken).
_run_isolated() {
    local hook="$1" sibling="$2"
    local dir="$TMPROOT/iso-$RANDOM"
    mkdir -p "$dir"
    cp "$hook" "$dir/hook.sh"
    case "$sibling" in
        present) cp "$SUBSTRATE_ROOT/scripts/clew/ledger-append.sh" "$dir/ledger-append.sh"
                 cp "$SUBSTRATE_ROOT/scripts/clew/clew-lock.sh" "$dir/clew-lock.sh" 2>/dev/null || true ;;
        missing) : ;;  # no sibling written
        broken)  printf 'this is not valid bash ((( \n' > "$dir/ledger-append.sh" ;;
    esac
    echo "$dir/hook.sh"
}

@test "F-002 agent (Stop) hook: missing ledger-append.sh source — still exits 0" {
    local h; h="$(_run_isolated "$AGENT_HOOK" missing)"
    run bash "$h" <<< '{"transcript_path":"/nonexistent"}'
    [[ "$status" -eq 0 ]] || fail "Stop hook blocked (exit $status) on a missing source: $output"
}

@test "F-002 agent (Stop) hook: parse-error ledger-append.sh source — still exits 0" {
    local h; h="$(_run_isolated "$AGENT_HOOK" broken)"
    run bash "$h" <<< '{"transcript_path":"/nonexistent"}'
    [[ "$status" -eq 0 ]] || fail "Stop hook blocked (exit $status) on a parse-error source: $output"
}

@test "F-002 agent (Stop) hook: happy path (no transcript) exits 0" {
    run env LOA_CLEW_AGENT_STATE="$TMPROOT/state.txt" bash "$AGENT_HOOK" <<< '{"transcript_path":"/nonexistent"}'
    [[ "$status" -eq 0 ]] || fail "Stop hook did not exit 0 on the happy path: $output"
}

@test "F-002 operator (UserPromptSubmit) hook: missing source — still exits 0" {
    local h; h="$(_run_isolated "$OP_HOOK" missing)"
    run bash "$h" <<< '{"prompt":">>clew@artisan: x"}'
    [[ "$status" -eq 0 ]] || fail "UserPromptSubmit hook blocked (exit $status) on a missing source: $output"
}

@test "F-002 operator hook: happy path still CAPTURES to an isolated ledger and exits 0" {
    local root="$TMPROOT/oproot"
    mkdir -p "$root"
    run env LOA_CLEW_LEDGER_ROOT="$root" LOA_GRIMOIRE_DIR="$TMPROOT/grim" \
        bash "$OP_HOOK" <<< '{"prompt":">>clew@artisan: prefer calm load-ins over toasts"}'
    [[ "$status" -eq 0 ]] || fail "operator hook did not exit 0 on capture: $output"
    [[ -f "$root/artisan/LEARNINGS.jsonl" ]] || fail "operator hook did not write the ledger (capture broken by the fix)"
    grep -qF 'prefer calm load-ins over toasts' "$root/artisan/LEARNINGS.jsonl" \
        || fail "the captured trigger is missing from the ledger"
}
