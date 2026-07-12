#!/usr/bin/env bats
# =============================================================================
# clew-capture-validates-skill.bats — the capture hook must set the schema's
# `confirmed` flag HONESTLY: true only when <skill> resolves to a real skill of
# the construct's pack; false (QUARANTINED, schema FR-2) otherwise — and it must
# STILL capture (mis-homed beats lost). Closes the silent dead-letter where a
# typo'd / non-existent <skill> was stamped confirmed:true and drained to nowhere.
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
    OP_HOOK="$SUBSTRATE_ROOT/scripts/clew/loa-clew-capture.sh"
    [[ -f "$OP_HOOK" ]] || skip "loa-clew-capture.sh not found"
    TMPROOT="$(mktemp -d)"
    PACKS="$TMPROOT/packs"
    # A fake pack with ONE real skill dir.
    mkdir -p "$PACKS/widgetco/skills/forge"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

_confirmed_of() {  # read the confirmed flag of the last ledger line for a construct
    python3 -c 'import json,sys
line=open(sys.argv[1]).read().strip().splitlines()[-1]
print(str(json.loads(line)["target"]["confirmed"]).lower())' "$1"
}

@test "explicit + existing skill → confirmed:true and captured" {
    run env LOA_CLEW_LEDGER_ROOT="$PACKS" LOA_GRIMOIRE_DIR="$TMPROOT/grim" \
        bash "$OP_HOOK" <<< '{"prompt":">>clew@widgetco/forge: pin the pattern before forging"}'
    [[ "$status" -eq 0 ]] || fail "hook did not exit 0: $output"
    [[ -f "$PACKS/widgetco/LEARNINGS.jsonl" ]] || fail "no ledger written"
    [[ "$(_confirmed_of "$PACKS/widgetco/LEARNINGS.jsonl")" == "true" ]] \
        || fail "a real skill should be confirmed:true"
}

@test "explicit + non-existent skill → confirmed:false, nudge lists real skills, STILL captured" {
    run env LOA_CLEW_LEDGER_ROOT="$PACKS" LOA_GRIMOIRE_DIR="$TMPROOT/grim" \
        bash "$OP_HOOK" <<< '{"prompt":">>clew@widgetco/tx-forensics: trace the funding source not the holder"}'
    [[ "$status" -eq 0 ]] || fail "hook did not exit 0: $output"
    [[ -f "$PACKS/widgetco/LEARNINGS.jsonl" ]] || fail "a quarantined clew must still be captured (mis-homed beats lost)"
    [[ "$(_confirmed_of "$PACKS/widgetco/LEARNINGS.jsonl")" == "false" ]] \
        || fail "an unknown skill must be quarantined (confirmed:false)"
    [[ "$output" == *"not a skill of 'widgetco'"* ]] || fail "missing the quarantine nudge: $output"
    [[ "$output" == *"forge"* ]] || fail "nudge should list the construct's real skills: $output"
    grep -qF 'trace the funding source not the holder' "$PACKS/widgetco/LEARNINGS.jsonl" \
        || fail "the verbatim trigger was lost"
}

@test "bare form (no /skill) → confirmed:false and an unconfirmed nudge" {
    run env LOA_CLEW_LEDGER_ROOT="$PACKS" LOA_GRIMOIRE_DIR="$TMPROOT/grim" \
        bash "$OP_HOOK" <<< '{"prompt":">>clew@widgetco: a correction with no skill named"}'
    [[ "$status" -eq 0 ]] || fail "hook did not exit 0: $output"
    [[ "$(_confirmed_of "$PACKS/widgetco/LEARNINGS.jsonl")" == "false" ]] \
        || fail "a skill-less capture cannot be a confirmed home"
    [[ "$output" == *"named no /<skill>"* ]] || fail "missing the unconfirmed nudge: $output"
}
