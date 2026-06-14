#!/usr/bin/env bats
# =============================================================================
# clew-distill-retag.bats — `--retag` is the SAFE re-home op for mis-captured
# clews (wrong skill, or wrong construct). It rewrites target.{construct,skill_slug}
# + re-derives `confirmed` against the real pack, schema-validated, and on a
# cross-construct move it append-to-target-THEN-removes-from-source so a crash
# duplicates (recoverable) rather than losing the clew.
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
    DISTILL="$SUBSTRATE_ROOT/scripts/clew/loa-clew-distill.sh"
    [[ -f "$DISTILL" ]] || skip "loa-clew-distill.sh not found"
    TMPROOT="$(mktemp -d)"
    PACKS="$TMPROOT/packs"
    # source construct 'srcco' holds one mis-homed clew; both constructs expose a real skill.
    mkdir -p "$PACKS/srcco/skills/realskill" "$PACKS/dstco/skills/txskill"
    CID="lrn-20260601-srcco-aaa111"
    printf '%s\n' '{"id":"'"$CID"'","tier":"construct","type":"correction","trigger":"trace the funding source","target":{"skill_slug":"ghost","construct":"srcco","confirmed":true},"verified":false,"distilled_at":null,"distill_status":"pending"}' \
        > "$PACKS/srcco/LEARNINGS.jsonl"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

_target() {  # _target <ledger> <clew-id> <field>
    python3 -c 'import json,sys
for l in open(sys.argv[1]):
    if not l.strip(): continue
    d=json.loads(l)
    if d.get("id")==sys.argv[2]: print(d["target"][sys.argv[3]]); break' "$1" "$2" "$3"
}

_run() { env LOA_CONSTRUCTS_PACKS="$PACKS" LOA_CLEW_LEDGER_ROOT="$PACKS" bash "$DISTILL" "$@"; }

@test "within-construct retag rewrites skill_slug and re-derives confirmed:true" {
    run _run srcco --retag "$CID" --to-skill realskill
    [[ "$status" -eq 0 ]] || fail "retag failed: $output"
    [[ "$(_target "$PACKS/srcco/LEARNINGS.jsonl" "$CID" skill_slug)" == "realskill" ]] || fail "skill_slug not rewritten"
    [[ "$(_target "$PACKS/srcco/LEARNINGS.jsonl" "$CID" confirmed)" == "True" ]] || fail "confirmed not re-derived true for a real skill"
}

@test "cross-construct retag MOVES the line to the target ledger and removes it from source" {
    run _run srcco --retag "$CID" --to-skill txskill --to-construct dstco
    [[ "$status" -eq 0 ]] || fail "cross retag failed: $output"
    # gone from source
    run grep -c "$CID" "$PACKS/srcco/LEARNINGS.jsonl"
    [[ "$output" == "0" ]] || fail "clew not removed from source ledger"
    # present in target with the new construct + confirmed:true
    [[ -f "$PACKS/dstco/LEARNINGS.jsonl" ]] || fail "target ledger not created"
    [[ "$(_target "$PACKS/dstco/LEARNINGS.jsonl" "$CID" construct)" == "dstco" ]] || fail "target.construct not updated"
    [[ "$(_target "$PACKS/dstco/LEARNINGS.jsonl" "$CID" confirmed)" == "True" ]] || fail "confirmed not true for a real target skill"
}

@test "retag to a non-existent skill still performs but quarantines (confirmed:false + warning)" {
    run _run srcco --retag "$CID" --to-skill nope
    [[ "$status" -eq 0 ]] || fail "retag should still perform: $output"
    [[ "$(_target "$PACKS/srcco/LEARNINGS.jsonl" "$CID" confirmed)" == "False" ]] || fail "unknown skill must quarantine (confirmed:false)"
    [[ "$output" == *"QUARANTINED"* ]] || fail "missing the quarantine warning: $output"
}

@test "retag of an unknown clew-id fails and leaves the ledger untouched" {
    local before; before="$(cat "$PACKS/srcco/LEARNINGS.jsonl")"
    run _run srcco --retag "lrn-20260601-srcco-zzz999" --to-skill realskill
    [[ "$status" -ne 0 ]] || fail "unknown clew-id should fail"
    [[ "$(cat "$PACKS/srcco/LEARNINGS.jsonl")" == "$before" ]] || fail "ledger mutated on a not-found retag"
}
