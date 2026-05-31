#!/usr/bin/env bats
# =============================================================================
# adapter-gen-env-override.bats — adapter-generator.py LOA_ADAPTER_* overrides
# =============================================================================
# The generator defaults to a single PROJECT_ROOT/.claude/{constructs/packs,
# agents,scripts/templates} layout. The live estate is SPLIT (packs in
# ~/.loa/constructs/packs, adapters in ~/.claude/agents), which that default
# cannot express — so cycle-053 added LOA_ADAPTER_{PROJECT_ROOT,PACKS_DIR,
# AGENTS_DIR,TEMPLATE} overrides. This suite exercises them with a self-contained
# temp fixture, so unlike the installed-mode pilot-adapter-discovery suite it
# RUNS in the standalone repo.
#
# It also pins the cycle-053 reconciliation: an adapter generated from the
# current template carries NO `why` handoff field (the canonical handoff schema
# is additionalProperties:false and has none) and asks for exactly the 5 required
# fields — so its handoffs validate.
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    GEN="$SUBSTRATE_ROOT/scripts/lib/adapter-generator.py"
    TEMPLATE="$SUBSTRATE_ROOT/templates/construct-adapter.template.md"
    [[ -f "$GEN" ]] || skip "adapter-generator.py not found"
    [[ -f "$TEMPLATE" ]] || skip "adapter template not found"
    TMPROOT="$(mktemp -d)"
    # minimal fixture pack under the override PACKS_DIR
    mkdir -p "$TMPROOT/packs/probe-construct" "$TMPROOT/agents"
    cat > "$TMPROOT/packs/probe-construct/construct.yaml" <<'EOF'
schema_version: 4
slug: probe-construct
name: Probe Construct
description: Minimal fixture construct for the adapter-generator env-override suite.
type: expertise-pack
skills: []
reads: []
writes: []
EOF
}

teardown() { [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"; return 0; }

_gen() {
    LOA_ADAPTER_PROJECT_ROOT="$TMPROOT" \
    LOA_ADAPTER_PACKS_DIR="$TMPROOT/packs" \
    LOA_ADAPTER_AGENTS_DIR="$TMPROOT/agents" \
    LOA_ADAPTER_TEMPLATE="$TEMPLATE" \
      python3 "$GEN" --slug probe-construct "$@"
}

@test "env-override: generates into LOA_ADAPTER_AGENTS_DIR from LOA_ADAPTER_PACKS_DIR" {
    run _gen
    [[ "$status" -eq 0 ]] || fail "generator failed: $output"
    [[ -f "$TMPROOT/agents/construct-probe-construct.md" ]] || fail "adapter not written to the override AGENTS_DIR"
}

@test "env-override: adapter frontmatter name is construct-<slug>" {
    _gen >/dev/null 2>&1
    grep -q "^name: construct-probe-construct" "$TMPROOT/agents/construct-probe-construct.md" || fail "wrong/missing adapter name"
}

@test "reconciliation: regenerated adapter has NO why handoff field (cycle-053)" {
    _gen >/dev/null 2>&1
    ! grep -qE '\bwhy\b' "$TMPROOT/agents/construct-probe-construct.md" || fail "adapter still mandates a why field (stale template?)"
}

@test "reconciliation: adapter asks for exactly the 5 canonical required handoff fields" {
    _gen >/dev/null 2>&1
    grep -q 'construct_slug`, `output_type`, `verdict`, `invocation_mode`, `cycle_id`' "$TMPROOT/agents/construct-probe-construct.md" \
        || fail "adapter does not name the 5 canonical required handoff fields"
}

@test "env-override: a handoff per the regenerated adapter validates against the canonical schema" {
    local schema="$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json"
    [[ -f "$schema" ]] || skip "handoff schema not present"
    local pkt="$TMPROOT/h.json"
    # the adapter's own minimal example shape: 5 required + the 3 recommended.
    printf '%s' '{"construct_slug":"probe-construct","output_type":"Verdict","verdict":{"summary":"x"},"invocation_mode":"room","cycle_id":"c","persona":null,"output_refs":[],"evidence":[]}' > "$pkt"
    run bash "$SUBSTRATE_ROOT/scripts/handoff-validate.sh" "$pkt" --schema "$schema"
    # exit 0 = clean; exit 1 = required-missing/schema-violation (the real failure). Must NOT be 1.
    [[ "$status" -ne 1 ]] || fail "handoff rejected as schema-invalid (exit 1): $output"
}
