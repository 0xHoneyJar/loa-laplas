#!/usr/bin/env bats
# =============================================================================
# form-c-dispatch.bats — cycle-053 Form C (compose-as-CC-workflow) acceptance.
# =============================================================================
# Covers: the cut algorithm (every is_seam branch + co-location), the segment
# emitter (syntax + determinism + injection-safety + room-packet injection +
# agentType + cap_reached/converged distinction), the compiler path in
# compose-dispatch.sh --form-c (validate-before-spend, manifest, room packets),
# the typed handoff wrap+validate, and the clew-at-seam capture.
#
# Uses REPO-RELATIVE paths (this pack's own scripts/), so it runs in standalone
# dev as well as when installed. State is isolated under a temp LOA_PROJECT_ROOT.
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    DISPATCH="$SUBSTRATE_ROOT/scripts/compose-dispatch.sh"
    CUT="$SUBSTRATE_ROOT/scripts/lib/compose-cut.py"
    EMIT="$SUBSTRATE_ROOT/scripts/lib/segment-emitter.py"
    SYNTAX="$SUBSTRATE_ROOT/scripts/lib/workflow-syntax-check.js"
    HARNESS="$SUBSTRATE_ROOT/scripts/lib/run-emitted-segment.js"
    HWRAP="$SUBSTRATE_ROOT/scripts/compose-handoff-wrap.sh"
    SEAMCLEW="$SUBSTRATE_ROOT/scripts/compose-seam-clew.sh"
    PILOT="$SUBSTRATE_ROOT/compositions/code-implement-and-review.yaml"
    FX="$SUBSTRATE_ROOT/tests/fixtures/form-c"

    [[ -f "$DISPATCH" ]] || skip "compose-dispatch.sh not found"
    [[ -f "$CUT" ]] || skip "compose-cut.py not found"
    [[ -f "$EMIT" ]] || skip "segment-emitter.py not found"

    # Resolve the bridge composition schema: env override, then sibling host repo.
    if [[ -n "${LOA_COMPOSE_SCHEMA:-}" && -f "${LOA_COMPOSE_SCHEMA:-}" ]]; then
        SCHEMA="$LOA_COMPOSE_SCHEMA"
    elif [[ -f "$SUBSTRATE_ROOT/../loa-constructs/.claude/schemas/runtime/composition.schema.json" ]]; then
        SCHEMA="$(cd "$SUBSTRATE_ROOT/../loa-constructs/.claude/schemas/runtime" && pwd)/composition.schema.json"
    else
        SCHEMA=""
    fi

    TMPROOT="$(mktemp -d)"
    # Isolate clew side-effects (ledger + best-effort trajectory) to the temp dir
    # so the seam-clew tests never write into the repo (grimoires/, ~/.loa/).
    export LOA_GRIMOIRE_DIR="$TMPROOT/grimoires"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"

    # Hermetic adapters dir for the construct-resolution validator (bd-ii1m).
    # The pilot's review stage uses the real `fagan` construct; stub its adapter
    # here so resolution doesn't depend on the operator's ~/.claude/agents.
    export LOA_COMPOSE_AGENTS_DIR="$TMPROOT/agents"
    mkdir -p "$LOA_COMPOSE_AGENTS_DIR"
    printf 'name: construct-fagan\n' > "$LOA_COMPOSE_AGENTS_DIR/construct-fagan.md"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

# Convert a YAML composition to JSON on stdout.
_y2j() { python3 -c "import yaml,json,sys; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)" "$1"; }
# Run the cut over a YAML fixture; print the plan JSON.
_cut() { _y2j "$1" | python3 "$CUT" -; }

# -----------------------------------------------------------------------------
# Cut algorithm — is_seam + the walk + co-location
# -----------------------------------------------------------------------------

@test "cut: pilot -> 1 iterating segment [1,2] + 1 terminal craft-gate seam" {
    [[ -f "$PILOT" ]] || skip "pilot composition missing"
    local plan; plan="$(_cut "$PILOT")"
    [[ "$(echo "$plan" | jq -r '.ok')" == "true" ]] || fail "cut not ok: $plan"
    [[ "$(echo "$plan" | jq '.segments|length')" -eq 1 ]] || fail "expected 1 segment"
    [[ "$(echo "$plan" | jq '.seams|length')" -eq 1 ]] || fail "expected 1 seam"
    [[ "$(echo "$plan" | jq -r '.segments[0].kind')" == "iterating" ]] || fail "segment not iterating"
    [[ "$(echo "$plan" | jq -c '.segments[0].iterate')" == "[1,2]" ]] || fail "iterate not [1,2]"
    [[ "$(echo "$plan" | jq -r '.seams[0].kind')" == "craft-gate" ]] || fail "seam not craft-gate"
    [[ "$(echo "$plan" | jq -r '.seams[0].terminal')" == "true" ]] || fail "seam not terminal"
    [[ "$(echo "$plan" | jq -r '.seams[0].autonomous_test_in_segment')" == "true" ]] || fail "gate test should co-locate"
}

@test "cut: feel-image shape -> 2 segments + 1 seam (segment A loops 2-3, B is stage 4)" {
    local plan; plan="$(_cut "$FX/feel-image-shape.yaml")"
    [[ "$(echo "$plan" | jq '.segments|length')" -eq 2 ]] || fail "expected 2 segments: $(echo "$plan"|jq -c '.segments|length')"
    [[ "$(echo "$plan" | jq '.seams|length')" -eq 1 ]] || fail "expected 1 seam"
    [[ "$(echo "$plan" | jq -c '[.segments[0].stages[].stage]')" == "[1,2,3]" ]] || fail "segment A should be [1,2,3]"
    [[ "$(echo "$plan" | jq -c '[.segments[1].stages[].stage]')" == "[4]" ]] || fail "segment B should be [4]"
    [[ "$(echo "$plan" | jq -r '.seams[0].after_segment')" == "0" ]] || fail "seam should follow segment 0"
}

@test "cut: seamless chain -> 1 segment, 0 seams (zero clew surface)" {
    local plan; plan="$(_cut "$FX/seamless.yaml")"
    [[ "$(echo "$plan" | jq '.segments|length')" -eq 1 ]] || fail "expected 1 segment"
    [[ "$(echo "$plan" | jq '.seams|length')" -eq 0 ]] || fail "expected 0 seams"
    [[ "$(echo "$plan" | jq -r '.segments[0].kind')" == "sequential" ]] || fail "should be sequential"
}

@test "cut: hitl_by_nature + hard-stop -> two standalone pure-pause seams (never automated)" {
    local plan; plan="$(_cut "$FX/hitl-and-hardstop.yaml")"
    [[ "$(echo "$plan" | jq '.seams|length')" -eq 2 ]] || fail "expected 2 seams"
    # The hitl stage (2) and hard-stop stage (4) must NOT appear inside any segment.
    local in_seg; in_seg="$(echo "$plan" | jq '[.segments[].stages[].stage] | map(select(. == 2 or . == 4)) | length')"
    [[ "$in_seg" -eq 0 ]] || fail "hitl/hard-stop stages must be pure-pause seams, not in a segment"
    echo "$plan" | jq -e '.seams[] | select(.kind=="hitl-by-nature" and .autonomous_test_in_segment==false)' >/dev/null || fail "missing hitl-by-nature pure-pause seam"
    echo "$plan" | jq -e '.seams[] | select(.kind=="hard-stop")' >/dev/null || fail "missing hard-stop seam"
}

@test "cut: --seam-roles can drop 'gate' from the seam set (configurable)" {
    # A composition whose only gate is role:gate, with seam-roles excluding gate,
    # should produce zero seams (the gate is treated as autonomous).
    local comp plan
    comp='{"schema_version":"1.0","kind":"workflow","name":"gate-only","description":"role gate only probe for seam-roles","intent":"I want to confirm gate role is a configurable seam via --seam-roles.","chain":[{"stage":1,"construct":"artisan","role":"primary"},{"stage":2,"construct":"crucible","role":"gate"}]}'
    plan="$(printf '%s' "$comp" | python3 "$CUT" - --seam-roles "hard-stop,craft-gate")"
    [[ "$(echo "$plan" | jq '.seams|length')" -eq 0 ]] || fail "with gate excluded, expected 0 seams"
    plan="$(printf '%s' "$comp" | python3 "$CUT" -)"  # default includes gate
    [[ "$(echo "$plan" | jq '.seams|length')" -eq 1 ]] || fail "default seam-roles should treat gate as a seam"
}

@test "cut: blocking mode is a seam regardless of role" {
    local comp plan
    comp='{"schema_version":"1.2","kind":"workflow","name":"blocking-probe","description":"blocking mode seam probe regardless of role","intent":"I want to confirm mode:blocking cuts a seam even with role primary.","chain":[{"stage":1,"construct":"artisan","role":"primary"},{"stage":2,"construct":"crucible","role":"primary","mode":"blocking"}]}'
    plan="$(printf '%s' "$comp" | python3 "$CUT" -)"
    [[ "$(echo "$plan" | jq '.seams|length')" -eq 1 ]] || fail "blocking mode should be a seam"
    [[ "$(echo "$plan" | jq -r '.seams[0].kind')" == "blocking" ]] || fail "seam kind should be blocking"
}

@test "cut: §1.4 caveat — an iterate pair whose b is mode:blocking does NOT co-locate" {
    # gate-seam-clew-mechanics §1.4: when the iterated gate is mode:blocking (not an
    # autonomous craft-gate test), the loop cannot close headless. The cut must NOT
    # fold it into the segment — it is a standalone pure-pause seam; the preceding
    # stage(s) form the segment; the loop is driven by the operator re-firing.
    local comp plan
    comp='{"schema_version":"1.2","kind":"workflow","name":"blocking-iterate","description":"iterate pair whose b is mode blocking probe for the 1.4 caveat","intent":"I want to confirm a blocking-iterate gate does not co-locate into the segment.","iterate":[[1,2]],"max_iterations":3,"terminate_when":"operator continues","chain":[{"stage":1,"construct":"artisan","role":"primary"},{"stage":2,"construct":"crucible","role":"craft-gate","mode":"blocking","iterates_with":1}]}'
    plan="$(printf '%s' "$comp" | python3 "$CUT" -)"
    [[ "$(echo "$plan" | jq '.segments|length')" -eq 1 ]] || fail "expected 1 segment (only stage 1)"
    [[ "$(echo "$plan" | jq -c '[.segments[0].stages[].stage]')" == "[1]" ]] || fail "segment should be [1], not co-locate the blocking gate"
    [[ "$(echo "$plan" | jq -r '.segments[0].kind')" == "sequential" ]] || fail "segment must be sequential, not iterating (loop cannot close headless)"
    [[ "$(echo "$plan" | jq -r '.seams[0].kind')" == "blocking" ]] || fail "seam kind should be blocking"
    [[ "$(echo "$plan" | jq -r '.seams[0].autonomous_test_in_segment')" == "false" ]] || fail "blocking gate test must NOT co-locate"
}

@test "cut: a craft-gate NOT in any iterate pair is a standalone seam (not co-located)" {
    local comp plan
    comp='{"schema_version":"1.0","kind":"workflow","name":"lone-gate","description":"a craft-gate with no iterate pairing probe","intent":"I want to confirm a non-iterated craft-gate is a standalone seam.","chain":[{"stage":1,"construct":"artisan","role":"primary"},{"stage":2,"construct":"crucible","role":"craft-gate"}]}'
    plan="$(printf '%s' "$comp" | python3 "$CUT" -)"
    [[ "$(echo "$plan" | jq '.segments|length')" -eq 1 ]] || fail "expected 1 segment ([1])"
    [[ "$(echo "$plan" | jq -c '[.segments[0].stages[].stage]')" == "[1]" ]] || fail "segment should be [1]"
    [[ "$(echo "$plan" | jq -r '.seams[0].autonomous_test_in_segment')" == "false" ]] || fail "non-iterated gate must not co-locate"
}

@test "cut: non-chain (pair-relay) composition is rejected by the cut" {
    local comp; comp='{"schema_version":"1.0","pattern":"pair-relay","name":"pr","sequence":[]}'
    run bash -c "printf '%s' '$comp' | python3 '$CUT' -"
    [[ "$status" -eq 1 ]] || fail "expected exit 1 for non-chain composition"
    echo "$output" | jq -e '.ok == false' >/dev/null || fail "expected ok:false"
}

# -----------------------------------------------------------------------------
# Segment emitter — syntax / determinism / injection / room-authority
# -----------------------------------------------------------------------------

_emit_pilot_seg0() {
    # cut the pilot, emit segment 0 with two room packets, print the .js path.
    local plan seg rooms out
    plan="$(_cut "$PILOT")"
    seg="$(echo "$plan" | jq -c '.segments[0]')"
    rooms='{"1":{"room_id":"sha256:1111111111111111111111111111111111111111111111111111111111111111","cycle_id":"c","construct_slug":"codex-rescue","mode":"room","invocation_path":"agent_call","expected_output_type":"Artifact","created_at":"2026-05-31T00:00:00Z","created_by":"t"},"2":{"room_id":"sha256:2222222222222222222222222222222222222222222222222222222222222222","cycle_id":"c","construct_slug":"codex-review","mode":"room","invocation_path":"agent_call","expected_output_type":"Verdict","created_at":"2026-05-31T00:00:00Z","created_by":"t"}}'
    _y2j "$PILOT" > "$TMPROOT/comp.json"
    out="$TMPROOT/seg0.workflow.js"
    printf '%s' "$seg" | python3 "$EMIT" --segment - --composition "$TMPROOT/comp.json" \
        --room-packets "$rooms" --cycle-id c --run-id r --authored-at "2026-05-31T00:00:00Z" > "$out"
    echo "$out"
}

@test "emit: pilot segment passes syntax + determinism check" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    command -v node >/dev/null || skip "node not available"
    local js; js="$(_emit_pilot_seg0)"
    run node "$SYNTAX" "$js"
    [[ "$status" -eq 0 ]] || fail "syntax/determinism check failed: $output"
}

@test "emit: agentType resolves both stages — built-in passthrough + first-class construct (bd-ii1m)" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    local js; js="$(_emit_pilot_seg0)"
    grep -q 'agentType: "general-purpose"' "$js" || fail "implement stage should pass through general-purpose"
    grep -q 'agentType: "construct-fagan"' "$js" || fail "review stage should resolve to the real construct-fagan"
    ! grep -q 'construct-codex' "$js" || fail "retired ghost construct-codex-* must never be emitted"
}

@test "validate: ghost construct (codex-rescue) is flagged before spend, not emitted (bd-ii1m)" {
    # A chain referencing a retired construct must FAIL the emit (validate-before-spend),
    # not silently mint a dead agentType that dies at agent() dispatch.
    cat > "$TMPROOT/ghost-seg.json" <<'JSON'
{"segment_name":"ghost","index":0,"kind":"sequential","stages":[{"stage":1,"name":"x","construct":"codex-rescue","skill":"implement","role":"primary"}]}
JSON
    printf '{"name":"ghost-test","description":"d"}' > "$TMPROOT/ghost-comp.json"
    run python3 "$EMIT" --segment "$TMPROOT/ghost-seg.json" --composition "$TMPROOT/ghost-comp.json" --validate-constructs
    [[ "$status" -ne 0 ]] || fail "ghost construct should fail emit (got exit 0): $output"
    grep -q 'GHOST-CONSTRUCT' <<<"$output" || fail "missing GHOST-CONSTRUCT flag: $output"
    grep -q 'codex-rescue' <<<"$output" || fail "error should name the ghost: $output"
}

@test "emit: built-in agent types pass through unprefixed; constructs stay prefixed (bd-ii1m)" {
    run python3 - "$EMIT" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("se", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cases = {
    "general-purpose": "general-purpose",  # plain implementer/reviewer — the bd-ii1m migration target
    "explore": "Explore",                  # case-insensitive in, canonical Claude Code casing out
    "Plan": "Plan",
    "claude": "claude",
    "k-hole": "construct-k-hole",           # construct slugs still prefix (regression guard)
    "codex-review": "construct-codex-review",
}
for slug, want in cases.items():
    got = m._agent_type(slug)
    assert got == want, f"{slug!r} -> {got!r}, want {want!r}"
print("OK")
PY
    [[ "$status" -eq 0 ]] || fail "agent-type passthrough wrong: $output"
    grep -q OK <<<"$output" || fail "no OK marker: $output"
}

@test "emit: room packet is baked in-prompt (room authority, not studio)" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    local js; js="$(_emit_pilot_seg0)"
    [[ "$(grep -c 'ROOM ACTIVATION PACKET' "$js")" -ge 2 ]] || fail "room packets not injected into both stages"
    grep -q 'invocation_path.*agent_call' "$js" || fail "room packet should carry invocation_path agent_call"
}

@test "emit: cap_reached is distinct from converged (never folded)" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    local js; js="$(_emit_pilot_seg0)"
    grep -q 'outcome: "converged"' "$js" || fail "missing converged outcome"
    grep -q 'outcome: "cap_reached"' "$js" || fail "missing cap_reached outcome"
    grep -q 'auto_approved_at_cap: true' "$js" || fail "cap_reached must carry auto_approved_at_cap"
    grep -q 'outcome: "degraded"' "$js" || fail "missing degraded outcome (StructuredOutput guard)"
}

@test "emit: typed failure sentinel present; never bare null on failure" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    local js; js="$(_emit_pilot_seg0)"
    grep -q '__stage_failed' "$js" || fail "missing __stage_failed sentinel"
}

@test "emit: no Date / Math.random (determinism guard)" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    local js; js="$(_emit_pilot_seg0)"
    ! grep -qE '\bDate\b' "$js" || fail "emitted source must not contain Date"
    ! grep -qE 'Math\s*\.\s*random' "$js" || fail "emitted source must not contain Math.random"
}

@test "emit: INJECTION — hostile composition strings are neutralized (no breakout)" {
    command -v node >/dev/null || skip "node not available"
    local plan seg out
    plan="$(_cut "$FX/injection.yaml")"
    seg="$(echo "$plan" | jq -c '.segments[0]')"
    _y2j "$FX/injection.yaml" > "$TMPROOT/inj.json"
    out="$TMPROOT/inj.workflow.js"
    printf '%s' "$seg" | python3 "$EMIT" --segment - --composition "$TMPROOT/inj.json" \
        --room-packets '{}' --cycle-id c --run-id r --authored-at "2026-05-31T00:00:00Z" > "$out"
    # If escaping failed, the hostile quotes/parens would break the parse.
    run node "$SYNTAX" "$out"
    [[ "$status" -eq 0 ]] || fail "injection broke out (syntax check failed): $output"
    # The payload globals must NOT have been emitted as live assignments — they
    # can only appear inside JSON-escaped string literals (\" sequences).
    ! grep -qE '^\s*globalThis\.PWNED' "$out" || fail "PWNED assignment escaped into live code"
    run node -e "process.exit(0)"   # node present sanity
}

# Emit segment N from a composition YAML/JSON to a file; echo the path.
_emit_from() {
    local comp_yaml="$1" idx="${2:-0}" rooms="${3:-{\}}"
    local cj="$TMPROOT/_comp.json" plan="$TMPROOT/_plan.json" seg="$TMPROOT/_seg.json" out="$TMPROOT/_seg-$idx.js"
    python3 -c "import yaml,json,sys; json.dump(yaml.safe_load(open(sys.argv[1])), open(sys.argv[2],'w'))" "$comp_yaml" "$cj"
    python3 "$CUT" "$cj" > "$plan" 2>/dev/null
    python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1]))['segments'][int(sys.argv[2])]))" "$plan" "$idx" > "$seg"
    python3 "$EMIT" --segment "$seg" --composition "$cj" --room-packets "$rooms" --cycle-id c --run-id r --authored-at z > "$out"
    echo "$out"
}

# --- adversarial-review regressions (cycle-053 review wil6tsg7h) ---

@test "emit INJECTION (A): composition name cannot break out of the doc-comment" {
    command -v node >/dev/null || skip "node not available"
    cat > "$TMPROOT/inj-name.yaml" <<'EOF'
schema_version: "1.0"
kind: workflow
name: probe-name-breakout
description: 'desc "}); globalThis.PWNED=1; (function(){return ({x:"'
intent: "I want to confirm a hostile name/description cannot break out of the leading doc-comment or meta."
chain:
  - {stage: 1, construct: artisan, role: primary}
EOF
    # also smuggle a comment-terminator via a stage note (lands in meta.phases detail)
    local js; js="$(_emit_from "$TMPROOT/inj-name.yaml" 0)"
    run node "$SYNTAX" "$js"
    [[ "$status" -eq 0 ]] || fail "name/description injection broke the parse: $output"
    ! grep -qE '^\s*globalThis\.PWNED' "$js" || fail "PWNED escaped into live code"
}

@test "emit INJECTION (B): max_iterations is int-coerced, not raw-interpolated" {
    command -v node >/dev/null || skip "node not available"
    cat > "$TMPROOT/inj-cap.yaml" <<'EOF'
schema_version: "1.0"
kind: workflow
name: probe-cap-injection
description: max_iterations injection probe for the emitter boundary coercion
intent: "I want to confirm a non-integer max_iterations cannot inject code into MAX_ITER."
iterate: [[1, 2]]
max_iterations: "99; globalThis.PWNED=1; while(true){}"
terminate_when: gate approves
chain:
  - {stage: 1, construct: worker, role: primary}
  - {stage: 2, construct: gate, role: craft-gate, iterates_with: 1}
EOF
    local js; js="$(_emit_from "$TMPROOT/inj-cap.yaml" 0)"
    grep -qE 'const MAX_ITER = [0-9]+;' "$js" || fail "MAX_ITER not an integer literal"
    ! grep -q 'while(true)' "$js" || fail "injected while(true) leaked into source"
    ! grep -qE '^\s*globalThis\.PWNED' "$js" || fail "PWNED leaked into live code"
    run node "$SYNTAX" "$js"; [[ "$status" -eq 0 ]] || fail "syntax check failed: $output"
}

@test "emit INJECTION (C): clew_example marker is js-escaped — no live agent() splice" {
    command -v node >/dev/null || skip "node not available"
    cat > "$TMPROOT/inj-clew.yaml" <<'EOF'
schema_version: "1.0"
kind: workflow
name: probe-clew-injection
description: clew_example raw-interpolation probe for the gate construct/skill
intent: "I want to confirm the clew marker cannot splice a live agent() call via construct/skill."
iterate: [[1, 2]]
max_iterations: 3
terminate_when: gate approves
chain:
  - {stage: 1, construct: worker, role: primary}
  - {stage: 2, construct: g, skill: 'a"+agent("PWNED")+"', role: craft-gate, iterates_with: 1}
EOF
    local js; js="$(_emit_from "$TMPROOT/inj-clew.yaml" 0)"
    run node "$SYNTAX" "$js"; [[ "$status" -eq 0 ]] || fail "syntax check failed: $output"
    # the LIVE (bare-quote) form must be absent; only the escaped form may appear.
    ! grep -F 'agent("PWNED")' "$js" || fail "live agent(\"PWNED\") spliced into source"
    grep -qF 'agent(\"PWNED\")' "$js" || fail "expected the payload as an escaped literal"
}

@test "emit DETERMINISM (D): 'Date'/'Math.random' in prose compiles (det-escaped, value preserved)" {
    command -v node >/dev/null || skip "node not available"
    cat > "$TMPROOT/date-prose.yaml" <<'EOF'
schema_version: "1.0"
kind: workflow
name: probe-date-prose
description: Validate the release Date metadata and the Math.random sampling docs here.
intent: "I want the Date header validated and Math.random documented; this is benign prose."
chain:
  - {stage: 1, construct: artisan, role: primary, notes: "check the Date format and avoid Math.random for seeds"}
EOF
    local js; js="$(_emit_from "$TMPROOT/date-prose.yaml" 0)"
    run node "$SYNTAX" "$js"
    [[ "$status" -eq 0 ]] || fail "benign Date/Math.random prose was wrongly rejected: $output"
    ! grep -qE '\bDate\b' "$js" || fail "raw Date token present in emitted source"
    ! grep -qE 'Math\s*\.\s*random' "$js" || fail "raw Math.random token present in emitted source"
    # value is preserved: the \\u0044ate escape decodes back to 'Date'
    grep -q 'u0044ate' "$js" || fail "expected the determinism-escaped form of Date"
}

@test "emit BOUNDS (F): a stage before the iterate lower bound is a once-only preamble (not in the loop)" {
    command -v node >/dev/null || skip "node not available"
    # feel-image-shape: iterate [[2,3]], stage 1 (artisan) precedes the loop bound.
    local js; js="$(_emit_from "$FX/feel-image-shape.yaml" 0)"
    run node "$SYNTAX" "$js"; [[ "$status" -eq 0 ]] || fail "syntax check failed: $output"
    local la lw
    la="$(grep -n 'agentType: "construct-artisan"' "$js" | head -1 | cut -d: -f1)"
    lw="$(grep -n 'while (iteration' "$js" | head -1 | cut -d: -f1)"
    [[ -n "$la" && -n "$lw" && "$la" -lt "$lw" ]] || fail "stage 1 (artisan) must be emitted before the while loop (la=$la lw=$lw)"
}

@test "runtime (E): a StructuredOutput miss degrades — never surfaces as converged" {
    command -v node >/dev/null || skip "node not available"
    [[ -f "$HARNESS" ]] || skip "harness missing"
    local js; js="$(_emit_pilot_seg0)"
    # work stage returns {} (incomplete), gate APPROVES — the old bug surfaced converged+empty.
    run node "$HARNESS" "$js" '{"general-purpose":{},"construct-fagan":{"verdict":"APPROVED","findings":[]}}'
    [[ "$status" -eq 0 ]] || fail "harness error: $output"
    local outcome; outcome="$(echo "$output" | jq -r '.outcome')"
    [[ "$outcome" == "degraded" ]] || fail "expected degraded, got $outcome (StructuredOutput miss masked as $outcome)"
    [[ "$(echo "$output" | jq -r '.degraded.reason')" == "structured-output-miss" ]] || fail "wrong degrade reason"
}

@test "runtime (mandate 6): a stage that throws becomes a sentinel -> degraded, never crashes or converges" {
    command -v node >/dev/null || skip "node not available"
    [[ -f "$HARNESS" ]] || skip "harness missing"
    local js; js="$(_emit_pilot_seg0)"
    run node "$HARNESS" "$js" '{"general-purpose":"__THROW__","construct-fagan":{"verdict":"APPROVED","findings":[]}}'
    [[ "$status" -eq 0 ]] || fail "a thrown stage crashed the workflow (should be caught): $output"
    [[ "$(echo "$output" | jq -r '.outcome')" == "degraded" ]] || fail "thrown stage should degrade, got $(echo "$output" | jq -r '.outcome')"
}

@test "runtime: cap_reached is a distinct outcome with auto_approved_at_cap (never folded into converged)" {
    command -v node >/dev/null || skip "node not available"
    [[ -f "$HARNESS" ]] || skip "harness missing"
    local js; js="$(_emit_pilot_seg0)"
    run node "$HARNESS" "$js" '{"general-purpose":{"output":"d","rationale":"w"},"construct-fagan":{"verdict":"CHANGES_REQUIRED","findings":[]}}'
    [[ "$status" -eq 0 ]] || fail "harness error: $output"
    [[ "$(echo "$output" | jq -r '.outcome')" == "cap_reached" ]] || fail "expected cap_reached"
    [[ "$(echo "$output" | jq -r '.converged')" == "false" ]] || fail "cap_reached must not be converged"
    [[ "$(echo "$output" | jq -r '.auto_approved_at_cap')" == "true" ]] || fail "missing auto_approved_at_cap"
}

@test "runtime: a clean operator-skip (agent->null) is distinct from a stage failure" {
    command -v node >/dev/null || skip "node not available"
    [[ -f "$HARNESS" ]] || skip "harness missing"
    local js; js="$(_emit_pilot_seg0)"
    # no scripted response for the work stage -> agent() returns null -> operator-skip
    run node "$HARNESS" "$js" '{"construct-fagan":{"verdict":"APPROVED","findings":[]}}'
    [[ "$status" -eq 0 ]] || fail "harness error: $output"
    [[ "$(echo "$output" | jq -r '.degraded.reason')" == "operator-skip" ]] || fail "null should be operator-skip, got $(echo "$output" | jq -r '.degraded.reason')"
}

# -----------------------------------------------------------------------------
# Compiler path — compose-dispatch.sh --form-c
# -----------------------------------------------------------------------------

@test "form-c: compose-dispatch.sh --form-c compiles the pilot (exit 3, manifest, segment)" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    export LOA_PROJECT_ROOT="$TMPROOT"
    [[ -n "$SCHEMA" ]] && export LOA_COMPOSE_SCHEMA="$SCHEMA"
    run bash "$DISPATCH" "$PILOT" --form-c --run-id fc1 --json
    [[ "$status" -eq 3 ]] || fail "expected exit 3 (awaiting main loop), got $status: $output"
    echo "$output" | jq -e '.mode == "workflow" and .segments == 1 and .seams == 1 and .awaiting_main_loop == true' >/dev/null || fail "bad json: $output"
    local rd="$TMPROOT/.run/compose/fc1"
    [[ -f "$rd/form-c-manifest.json" ]] || fail "manifest missing"
    [[ -f "$rd/workflows/code-implement-and-review.segment-1.workflow.js" ]] || fail "segment workflow missing"
    # manifest contract
    jq -e '.segments[0].agent_types == ["general-purpose","construct-fagan"]' "$rd/form-c-manifest.json" >/dev/null || fail "bad agent_types in manifest (expected general-purpose + first-class construct-fagan)"
    jq -e '.seams[0].kind == "craft-gate" and .seams[0].terminal == true' "$rd/form-c-manifest.json" >/dev/null || fail "bad seam in manifest"
    jq -e '.seams[0].clew_targets[0].construct == "fagan"' "$rd/form-c-manifest.json" >/dev/null || fail "missing clew target"
}

@test "form-c: emitted room packets use agent_call + room mode and validate" {
    [[ -f "$PILOT" ]] || skip "pilot missing"
    export LOA_PROJECT_ROOT="$TMPROOT"
    [[ -n "$SCHEMA" ]] && export LOA_COMPOSE_SCHEMA="$SCHEMA"
    bash "$DISPATCH" "$PILOT" --form-c --run-id fc2 --json >/dev/null 2>&1 || true
    local n=0
    for rp in "$TMPROOT"/.run/rooms/*.json; do
        [[ -f "$rp" ]] || continue
        jq -e '.mode == "room" and .invocation_path == "agent_call"' "$rp" >/dev/null || fail "room packet not agent_call/room: $rp"
        run bash "$SUBSTRATE_ROOT/scripts/room-packet-validate.sh" "$rp" --schema "$SUBSTRATE_ROOT/data/trajectory-schemas/room-activation-packet.schema.json" --json
        [[ "$status" -eq 0 ]] || fail "room packet failed validation (schema + content-addressable id): $rp"
        n=$((n+1))
    done
    [[ "$n" -ge 2 ]] || fail "expected >=2 room packets, got $n"
}

@test "form-c: validate-before-spend — invalid composition fails the cut, emits no segment" {
    [[ -n "$SCHEMA" ]] || skip "host composition schema not resolvable"
    export LOA_PROJECT_ROOT="$TMPROOT"
    export LOA_COMPOSE_SCHEMA="$SCHEMA"
    # iterate without max_iterations is a schema violation (FR-7.2).
    cat > "$TMPROOT/bad.yaml" <<'EOF'
schema_version: "1.0"
kind: workflow
name: bad-no-cap
description: iterate present but no max_iterations should fail validation before any emit
intent: "I want to confirm validate-before-spend blocks an invalid composition."
iterate:
  - [1, 2]
chain:
  - stage: 1
    construct: artisan
    role: primary
  - stage: 2
    construct: crucible
    role: craft-gate
    iterates_with: 1
EOF
    run bash "$DISPATCH" "$TMPROOT/bad.yaml" --form-c --run-id fc3
    [[ "$status" -eq 1 ]] || fail "expected exit 1 (validation failed), got $status"
    [[ ! -d "$TMPROOT/.run/compose/fc3/workflows" ]] || fail "no segment should be emitted for an invalid composition"
}

# -----------------------------------------------------------------------------
# Typed handoff wrap + validate
# -----------------------------------------------------------------------------

@test "handoff-wrap: a valid stage seed wraps into a schema-valid construct-handoff" {
    [[ -f "$HWRAP" ]] || skip "handoff-wrap missing"
    export LOA_PROJECT_ROOT="$TMPROOT"
    local seed='{"construct_slug":"codex-rescue","persona":"CODEX-RESCUE","output_type":"Artifact","invocation_mode":"room","stage_index":1,"verdict":{"output":"diff","rationale":"why"}}'
    run bash -c "printf '%s' '$seed' | bash '$HWRAP' --seed - --cycle-id cycle-053 --run-id hw1 --json"
    [[ "$status" -eq 0 ]] || fail "handoff-wrap failed: $output"
    echo "$output" | jq -e '.ok == true' >/dev/null || fail "expected ok: $output"
    [[ -f "$TMPROOT/.run/compose/hw1/envelopes/01.codex-rescue.handoff.json" ]] || fail "envelope not written"
}

@test "handoff-wrap: missing required field fails validation (exit 2, never silently accepted)" {
    [[ -f "$HWRAP" ]] || skip "handoff-wrap missing"
    export LOA_PROJECT_ROOT="$TMPROOT"
    run bash -c "printf '%s' '{\"output_type\":\"Verdict\",\"verdict\":{\"verdict\":\"APPROVED\"}}' | bash '$HWRAP' --seed - --cycle-id cycle-053 --run-id hw2"
    [[ "$status" -eq 2 ]] || fail "expected exit 2 for missing construct_slug, got $status"
}

# -----------------------------------------------------------------------------
# Clew at the seam (injection-safe)
# -----------------------------------------------------------------------------

@test "seam-clew: a >>clew marker is captured to the construct ledger" {
    [[ -f "$SEAMCLEW" ]] || skip "seam-clew missing"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"
    run bash "$SEAMCLEW" ">>clew@codex-review/reviewing-diffs: tighten off-by-one detection"
    [[ "$status" -eq 0 ]] || fail "capture failed: $output"
    [[ -f "$TMPROOT/ledger/codex-review/LEARNINGS.jsonl" ]] || fail "ledger not written"
    jq -e '.target.construct == "codex-review" and .target.skill_slug == "reviewing-diffs"' "$TMPROOT/ledger/codex-review/LEARNINGS.jsonl" >/dev/null || fail "bad ledger entry"
}

@test "seam-clew: INJECTION — shell metachars in the steer are stored literally, never executed" {
    [[ -f "$SEAMCLEW" ]] || skip "seam-clew missing"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"
    local marker; marker='>>clew@artisan: $(touch '"$TMPROOT"'/PWNED); `id`; rm -rf x'
    run bash -c "printf '%s' \"\$1\" | bash '$SEAMCLEW' --stdin" _ "$marker"
    [[ "$status" -eq 0 ]] || fail "capture should not fail: $output"
    [[ ! -e "$TMPROOT/PWNED" ]] || fail "INJECTION EXECUTED — command substitution ran"
    grep -q 'touch' "$TMPROOT/ledger/artisan/LEARNINGS.jsonl" || fail "literal payload not captured"
}

@test "seam-clew: a steer without a marker records nothing (opt-in, silent)" {
    [[ -f "$SEAMCLEW" ]] || skip "seam-clew missing"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"
    run bash "$SEAMCLEW" "ship it, looks great"
    [[ "$status" -eq 0 ]] || fail "no-marker steer should exit 0"
    [[ ! -d "$TMPROOT/ledger" ]] || fail "nothing should be recorded without a marker"
}

# -----------------------------------------------------------------------------
# Bridge schema (hitl_by_nature, v1.3) — additive, non-breaking
# -----------------------------------------------------------------------------

@test "schema: hitl_by_nature validates under v1.3; pre-1.3 compositions unaffected" {
    [[ -n "$SCHEMA" ]] || skip "host composition schema not resolvable"
    run python3 - "$SCHEMA" <<'PY'
import json, sys, jsonschema
from referencing import Registry, Resource
schema = json.load(open(sys.argv[1]))
reg = Registry(retrieve=lambda u: Resource.from_contents({"$schema":"https://json-schema.org/draft/2020-12/schema"}))
V = jsonschema.Draft202012Validator(schema, registry=reg)
assert "hitl_by_nature" in schema["$defs"]["Stage"]["properties"], "field missing"
assert "1.3" in schema["properties"]["schema_version"]["enum"], "v1.3 missing"
good = {"schema_version":"1.3","kind":"workflow","name":"hitl-ok","description":"hitl_by_nature additive probe for v1.3","intent":"I want to confirm the new optional field validates additively.","chain":[{"stage":1,"construct":"the-mint","role":"primary","hitl_by_nature":True}]}
assert not list(V.iter_errors(good)), "v1.3 + hitl_by_nature should validate"
v12 = {"schema_version":"1.2","kind":"workflow","name":"pre-one-three","description":"pre-1.3 composition unaffected by the additive field","intent":"I want to confirm absence of the field still validates under v1.2.","chain":[{"stage":1,"construct":"artisan","role":"primary"}]}
assert not list(V.iter_errors(v12)), "pre-1.3 composition must still validate"
print("schema-ok")
PY
    [[ "$status" -eq 0 ]] || fail "schema check failed: $output"
    [[ "$output" == *"schema-ok"* ]] || fail "unexpected: $output"
}

# -----------------------------------------------------------------------------
# Per-segment intelligence routing (2026-06-03-intelligence-router-coherence)
# A stage declares intelligence_tier (cheap|standard|deep); the emitter resolves
# it (or a default-by-role) to a Claude model ALIAS (haiku|sonnet|opus) injected at
# the agent() opts. The conservative guard (GATE-NEVER-HAIKU) is LOAD-BEARING.
# -----------------------------------------------------------------------------

# Resolve a stage dict (JSON on argv) to its model alias via the emitter's resolver.
_resolve_model() {
    python3 - "$EMIT" "$1" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("se", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._resolve_model(json.loads(sys.argv[2])))
PY
}

# Resolve a stage dict to its model alias AND its stderr (R-F004 warning channel).
# Prints two lines: the model alias, then the captured stderr (may be empty).
_resolve_model_stderr() {
    python3 - "$EMIT" "$1" <<'PY' 2>/dev/null
import importlib.util, json, sys, io
spec = importlib.util.spec_from_file_location("se", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
buf = io.StringIO(); real = sys.stderr; sys.stderr = buf
try:
    model = m._resolve_model(json.loads(sys.argv[2]))
finally:
    sys.stderr = real
sys.stdout.write(model + "\n")
sys.stdout.write("STDERR:" + buf.getvalue().replace("\n", " ").strip() + "\n")
PY
}

@test "intel: explicit intelligence_tier cheap->sonnet (SoT), standard->sonnet, deep->opus, tiny->haiku" {
    # cheap ≡ sonnet per the hounfour SoT reconciliation (2026-06-07, arrakis-d72w);
    # tiny is the explicit haiku route (home vocabulary).
    [[ "$(_resolve_model '{"intelligence_tier":"cheap","role":"primary"}')" == "sonnet" ]] || fail "cheap must map to sonnet (hounfour SoT)"
    [[ "$(_resolve_model '{"intelligence_tier":"standard","role":"primary"}')" == "sonnet" ]] || fail "standard should map to sonnet"
    [[ "$(_resolve_model '{"intelligence_tier":"deep","role":"primary"}')" == "opus" ]] || fail "deep should map to opus"
    [[ "$(_resolve_model '{"intelligence_tier":"tiny","role":"primary"}')" == "haiku" ]] || fail "tiny should map to haiku"
}

@test "intel: default-by-role — gather/explore->haiku, gate/craft-gate/judge->opus, primary/work->sonnet" {
    [[ "$(_resolve_model '{"role":"gather"}')" == "haiku" ]] || fail "gather (no tier) should default to haiku"
    [[ "$(_resolve_model '{"role":"explore"}')" == "haiku" ]] || fail "explore (no tier) should default to haiku"
    [[ "$(_resolve_model '{"role":"gate"}')" == "opus" ]] || fail "gate (no tier) should default to opus"
    [[ "$(_resolve_model '{"role":"craft-gate"}')" == "opus" ]] || fail "craft-gate (no tier) should default to opus"
    [[ "$(_resolve_model '{"role":"judge"}')" == "opus" ]] || fail "judge (no tier) should default to opus"
    [[ "$(_resolve_model '{"role":"primary"}')" == "sonnet" ]] || fail "primary (no tier) should default to sonnet"
    [[ "$(_resolve_model '{"role":"work"}')" == "sonnet" ]] || fail "work (no tier) should default to sonnet"
}

@test "intel: unrecognized/missing role with no tier -> sonnet (conservative default)" {
    [[ "$(_resolve_model '{"role":"frobnicate"}')" == "sonnet" ]] || fail "unrecognized role must conservatively default to sonnet, never haiku"
    [[ "$(_resolve_model '{}')" == "sonnet" ]] || fail "missing role must conservatively default to sonnet"
    [[ "$(_resolve_model '{"role":null}')" == "sonnet" ]] || fail "null role must conservatively default to sonnet"
}

@test "intel: GATE-NEVER-HAIKU — craft-gate + explicit intelligence_tier cheap still resolves to opus" {
    # The conservative guard: an explicit cheaper tier may NOT silently downgrade a
    # gate-class stage. The worst failure mode (a quality gate dropped to a cheap
    # model) is structurally impossible.
    [[ "$(_resolve_model '{"role":"craft-gate","intelligence_tier":"cheap"}')" == "opus" ]] || fail "craft-gate+cheap MUST floor at opus (GATE-NEVER-HAIKU)"
    [[ "$(_resolve_model '{"role":"review","intelligence_tier":"standard"}')" == "opus" ]] || fail "review+standard MUST floor at opus"
    [[ "$(_resolve_model '{"role":"audit","intelligence_tier":"cheap"}')" == "opus" ]] || fail "audit+cheap MUST floor at opus"
    # an explicit tier may UPGRADE a non-gate stage
    [[ "$(_resolve_model '{"role":"work","intelligence_tier":"deep"}')" == "opus" ]] || fail "work+deep should upgrade to opus"
}

@test "intel: cut carries intelligence_tier into the stage-plan (compose-cut.py)" {
    local comp plan
    comp='{"schema_version":"1.4","kind":"workflow","name":"intel-cut","description":"cut carries intelligence_tier into the stage view","intent":"I want to confirm compose-cut carries the new field.","chain":[{"stage":1,"construct":"explorer","role":"gather","intelligence_tier":"cheap"},{"stage":2,"construct":"worker","role":"primary"}]}'
    plan="$(printf '%s' "$comp" | python3 "$CUT" -)"
    [[ "$(echo "$plan" | jq -r '.segments[0].stages[0].intelligence_tier')" == "cheap" ]] || fail "intelligence_tier not carried into the cut stage-plan"
    [[ "$(echo "$plan" | jq -r '.segments[0].stages[1].intelligence_tier')" == "null" ]] || fail "absent intelligence_tier should carry as null"
}

@test "intel: emitted sequential .workflow.js injects model: at each agent() site" {
    command -v node >/dev/null || skip "node not available"
    cat > "$TMPROOT/intel-seq.yaml" <<'EOF'
schema_version: "1.4"
kind: workflow
name: intel-seq-emit
description: per-segment model routing sequential emit probe
intent: "I want to confirm the emitter injects model: at each sequential agent() site."
chain:
  - {stage: 1, construct: explorer, role: gather}
  - {stage: 2, construct: worker, role: work, intelligence_tier: deep}
  - {stage: 3, construct: finisher, role: primary}
EOF
    local js; js="$(_emit_from "$TMPROOT/intel-seq.yaml" 0)"
    run node "$SYNTAX" "$js"; [[ "$status" -eq 0 ]] || fail "syntax check failed: $output"
    # one model: per stage (3), each a quoted alias literal next to agentType.
    [[ "$(grep -c 'model: "' "$js")" -eq 3 ]] || fail "expected one model: per agent() site (3), got $(grep -c 'model: "' "$js")"
    grep -q 'agentType: "construct-explorer", model: "haiku"' "$js" || fail "gather role should emit model:haiku"
    grep -q 'agentType: "construct-worker", model: "opus"' "$js" || fail "explicit deep should emit model:opus (upgrade)"
    grep -q 'agentType: "construct-finisher", model: "sonnet"' "$js" || fail "primary role should emit model:sonnet (conservative default)"
}

@test "intel: emitted iterating .workflow.js injects model: in preamble/work/gate — gate floored at opus" {
    command -v node >/dev/null || skip "node not available"
    # preamble stage (read=cheap), loop work (work=sonnet), craft-gate carrying an
    # EXPLICIT cheap tier — which MUST still emit model:opus (the conservative guard
    # surfaced in the emitted source, not just the resolver).
    cat > "$TMPROOT/intel-iter.yaml" <<'EOF'
schema_version: "1.4"
kind: workflow
name: intel-iter-emit
description: per-segment model routing iterating emit probe
intent: "I want to confirm the emitter injects model: in preamble, loop work, and the gate."
iterate: [[2, 3]]
max_iterations: 3
terminate_when: gate approves
chain:
  - {stage: 1, construct: reader, role: read}
  - {stage: 2, construct: worker, role: work}
  - {stage: 3, construct: reviewer, role: craft-gate, iterates_with: 2, intelligence_tier: cheap}
EOF
    local js; js="$(_emit_from "$TMPROOT/intel-iter.yaml" 0)"
    run node "$SYNTAX" "$js"; [[ "$status" -eq 0 ]] || fail "syntax check failed: $output"
    [[ "$(grep -c 'model: "' "$js")" -eq 3 ]] || fail "expected 3 model: sites (preamble+work+gate), got $(grep -c 'model: "' "$js")"
    grep -q 'agentType: "construct-reader", model: "haiku"' "$js" || fail "preamble read role should emit model:haiku"
    grep -q 'agentType: "construct-worker", model: "sonnet"' "$js" || fail "loop work role should emit model:sonnet"
    grep -q 'agentType: "construct-reviewer", model: "opus"' "$js" || fail "craft-gate+cheap MUST emit model:opus (GATE-NEVER-HAIKU in emitted source)"
    ! grep -q 'agentType: "construct-reviewer", model: "haiku"' "$js" || fail "gate must NEVER be emitted on haiku"
}

# --- BB review on #20: token-match (no substring collisions) + invalid-tier warn ---
# R-F002: role classification is TOKEN-EXACT, not substring. The three collision
# classes the substring matcher produced are now GONE — every collision role matches
# NEITHER set and falls to the conservative sonnet default.

@test "intel R-F002: 'thread-merge' (no tier) -> sonnet (NOT haiku via the old 'read' substring)" {
    # "thread-merge" tokenizes to {thread, merge}; neither is a CHEAP token. The old
    # substring matcher saw 'read' inside 'thREAD' and wrongly downgraded to haiku —
    # the DANGEROUS false-cheap class. Token-exact resolves it to sonnet.
    [[ "$(_resolve_model '{"role":"thread-merge"}')" == "sonnet" ]] || fail "thread-merge must be sonnet, never haiku via 'read' substring"
    [[ "$(_resolve_model '{"role":"thread-merge"}')" != "haiku" ]] || fail "thread-merge wrongly downgraded to haiku (substring collision)"
}

@test "intel R-F002: 'navigate-flow' (no tier) -> sonnet (NOT opus via the old 'gate' substring)" {
    # "navigate-flow" tokenizes to {navigate, flow}; neither is a DEEP token. The old
    # substring matcher saw 'gate' inside 'naviGATE' and over-promoted to opus.
    # Over-promotion is merely wasteful (not unsafe), but assert the precise result.
    [[ "$(_resolve_model '{"role":"navigate-flow"}')" == "sonnet" ]] || fail "navigate-flow must be sonnet, never opus via 'gate' substring"
    # also the original BB phrasing "navigate-x":
    [[ "$(_resolve_model '{"role":"navigate-x"}')" == "sonnet" ]] || fail "navigate-x must be sonnet, never opus via 'gate' substring"
}

@test "intel R-F002: 'preview-pane' (no tier) -> sonnet (NOT opus via the old 'review' substring)" {
    # "preview-pane" tokenizes to {preview, pane}; neither is a DEEP token. The old
    # substring matcher saw 'review' inside 'pREVIEW' and over-promoted to opus.
    [[ "$(_resolve_model '{"role":"preview-pane"}')" == "sonnet" ]] || fail "preview-pane must be sonnet, never opus via 'review' substring"
}

@test "intel R-F004: invalid intelligence_tier on a non-deep role -> role default (sonnet) + stderr warning" {
    # An invalid (set-but-unrecognized) tier is an authoring error: warn (naming the
    # bad value + valid tiers) and fall through to the role default — never silently
    # ignore, never raise.
    run _resolve_model_stderr '{"role":"primary","intelligence_tier":"medium"}'
    [[ "$status" -eq 0 ]] || fail "resolver errored: $output"
    [[ "$(echo "$output" | head -1)" == "sonnet" ]] || fail "invalid tier on primary must fall to sonnet, got $(echo "$output" | head -1)"
    echo "$output" | grep -q 'STDERR:.*invalid intelligence_tier' || fail "expected a stderr warning naming the invalid tier; got: $output"
    echo "$output" | grep -q "medium" || fail "warning should name the invalid value 'medium'"
    echo "$output" | grep -qE 'cheap.*standard.*deep' || fail "warning should list the valid tiers"
}

@test "intel R-F004: invalid tier does NOT lift the gate floor — craft-gate+invalid still opus + warning" {
    # The conservative floor is unconditional: an invalid tier on a gate-class role
    # warns but the bottom guard still floors it at opus (GATE-NEVER-HAIKU holds even
    # for malformed tiers).
    run _resolve_model_stderr '{"role":"craft-gate","intelligence_tier":"medium"}'
    [[ "$status" -eq 0 ]] || fail "resolver errored: $output"
    [[ "$(echo "$output" | head -1)" == "opus" ]] || fail "craft-gate+invalid tier must still floor at opus"
    echo "$output" | grep -q 'STDERR:.*invalid intelligence_tier' || fail "expected a stderr warning for the invalid tier"
}

@test "intel R-F002: re-confirm GATE-NEVER-HAIKU — craft-gate + intelligence_tier cheap -> opus (unchanged by token matching)" {
    # The token-matching refactor must NOT weaken the conservative safety floor. The
    # canonical GATE-NEVER-HAIKU invariant still holds after R-F002/R-F003/R-F004.
    [[ "$(_resolve_model '{"role":"craft-gate","intelligence_tier":"cheap"}')" == "opus" ]] || fail "craft-gate+cheap MUST floor at opus (GATE-NEVER-HAIKU)"
    [[ "$(_resolve_model '{"role":"craft-gate","intelligence_tier":"cheap"}')" != "haiku" ]] || fail "GATE-NEVER-HAIKU violated"
}


@test "emit: output_schema is emitted instead of WORK_SCHEMA when defined" {
    command -v node >/dev/null || skip "node not available"
    cat > "$TMPROOT/custom-schema.yaml" <<'EOY'
schema_version: "1.4"
kind: workflow
name: probe-custom-schema
description: 'test'
intent: "test"
chain:
  - stage: 1
    construct: the-mint
    role: primary
    output_schema: {"type": "object", "properties": {"hello": {"type": "string"}}}
EOY
    local js; js="$(_emit_from "$TMPROOT/custom-schema.yaml" 0)"
    run node "$SYNTAX" "$js"
    [[ "$status" -eq 0 ]] || fail "custom schema injection broke syntax: $output"
    # BYTE-EXACT pinned fixture [blocker-5 / IMP-002]: the declared output_schema is
    # serialized via json.dumps(sort_keys=True, ensure_ascii=True, separators=(",",":")),
    # so keys sort alphabetically (properties < type) and there are NO separator spaces.
    grep -qF 'schema: {"properties":{"hello":{"type":"string"}},"type":"object"}' "$js" || fail "output_schema not emitted in pinned byte-exact form"
    ! grep -q "schema: WORK_SCHEMA" "$js" || fail "WORK_SCHEMA still emitted"
}

@test "emit: WORK_SCHEMA fallback used when output_schema is undefined" {
    command -v node >/dev/null || skip "node not available"
    cat > "$TMPROOT/fallback-schema.yaml" <<'EOY'
schema_version: "1.4"
kind: workflow
name: probe-fallback-schema
description: 'test'
intent: "test"
chain:
  - stage: 1
    construct: the-mint
    role: primary
EOY
    local js; js="$(_emit_from "$TMPROOT/fallback-schema.yaml" 0)"
    run node "$SYNTAX" "$js"
    [[ "$status" -eq 0 ]] || fail "fallback schema broke syntax: $output"
    grep -q 'schema: WORK_SCHEMA' "$js" || fail "WORK_SCHEMA not emitted"
}

@test "emit: output_schema string (\$ref) FAILS LOUD — never coerced (V1 inline-only)" {
    # V1 is inline-object-only. A $ref path is valid YAML (parses as a str), so the
    # emitter MUST type-check and refuse it with a non-zero exit, never stringify it
    # into a schema (the silent-wrong outcome this chapter killed). $ref is V2.
    cat > "$TMPROOT/_ref-comp.json" <<'JSON'
{"name":"probe-ref","description":"d","intent":"i"}
JSON
    cat > "$TMPROOT/_ref-seg.json" <<'JSON'
{"index":0,"segment_name":"probe-ref.segment-1","kind":"sequential","stages":[{"stage":1,"construct":"the-mint","role":"primary","output_schema":"./external-schema.json"}]}
JSON
    run python3 "$EMIT" --segment "$TMPROOT/_ref-seg.json" --composition "$TMPROOT/_ref-comp.json" --cycle-id c --run-id r
    [[ "$status" -ne 0 ]] || fail "string output_schema must fail loud, got exit 0"
    [[ "$output" == *"OUTPUT-SCHEMA-INVALID"* ]] || fail "missing OUTPUT-SCHEMA-INVALID marker: $output"
}

@test "emit: declared output_schema is DETERMINISTIC + byte-pinned (sort_keys, compact)" {
    # Emit the same composition twice -> byte-identical (sort_keys closes cross-Python
    # key-order drift). And the emitted literal equals the pinned json.dumps form.
    cat > "$TMPROOT/det-schema.yaml" <<'EOY'
schema_version: "1.4"
kind: workflow
name: probe-det-schema
description: 'test'
intent: "test"
chain:
  - stage: 1
    construct: the-mint
    role: primary
    output_schema: {"type": "object", "zeta": {"a": 1}, "alpha": {"b": 2}}
EOY
    local a b; a="$(_emit_from "$TMPROOT/det-schema.yaml" 0)"
    cp "$a" "$TMPROOT/_det-a.js"
    b="$(_emit_from "$TMPROOT/det-schema.yaml" 0)"
    diff -q "$TMPROOT/_det-a.js" "$b" || fail "emitted output_schema is not deterministic across runs"
    # alpha sorts before type before zeta -> proves sort_keys, compact separators
    grep -qF 'schema: {"alpha":{"b":2},"type":"object","zeta":{"a":1}}' "$b" || fail "schema not in pinned sorted/compact form"
}

@test "emit: withRetry 'required' tracks declared output_schema.required (FAGAN regression)" {
    # A typed handoff carries the SCHEMA's keys, never output/rationale. The retry/conformance
    # layer (conforms(r, required)) MUST check those keys — else it rejects every valid typed
    # handoff against WORK_REQUIRED and degrades it to structured-output-miss. The schema: arg
    # and the withRetry required arg MUST move together. [FAGAN council finding, 2026-06-08]
    cat > "$TMPROOT/req-schema.yaml" <<'EOY'
schema_version: "1.4"
kind: workflow
name: probe-required-tracks
description: 'test'
intent: "test"
chain:
  - stage: 1
    construct: the-mint
    role: primary
    output_schema: {"type": "object", "required": ["seams", "verdict"], "properties": {"seams": {"type": "array"}, "verdict": {"type": "string"}}}
EOY
    local js; js="$(_emit_from "$TMPROOT/req-schema.yaml" 0)"
    run node "$SYNTAX" "$js"
    [[ "$status" -eq 0 ]] || fail "required-tracks broke syntax: $output"
    grep -qF 'withRetry("the-mint", ["seams","verdict"],' "$js" || fail "withRetry required does not track output_schema.required (still WORK_REQUIRED?)"
    ! grep -qF 'withRetry("the-mint", WORK_REQUIRED' "$js" || fail "typed stage still validated against WORK_REQUIRED — FAGAN bug regressed"
    # third leg: the prompt instruction must also describe the declared schema, not WORK
    grep -qF "DECLARED output_schema (required keys: seams, verdict)" "$js" || fail "prompt instruction does not name the declared schema"
    ! grep -qF 'per the WORK schema' "$js" || fail "typed stage prompt still says 'per the WORK schema'"
}

@test "emit: withRetry falls back to WORK_REQUIRED when output_schema absent" {
    cat > "$TMPROOT/req-fallback.yaml" <<'EOY'
schema_version: "1.4"
kind: workflow
name: probe-required-fallback
description: 'test'
intent: "test"
chain:
  - stage: 1
    construct: the-mint
    role: primary
EOY
    local js; js="$(_emit_from "$TMPROOT/req-fallback.yaml" 0)"
    grep -qF 'withRetry("the-mint", WORK_REQUIRED,' "$js" || fail "absent output_schema must fall back to WORK_REQUIRED"
}

@test "emit: malformed output_schema.required (non-string array) FAILS LOUD, not a TypeError" {
    # The prompt instruction joins required[] before the conformance arg validates it; a
    # malformed array (e.g. [123]) must surface OUTPUT-SCHEMA-INVALID, never a raw Python
    # TypeError traceback. One shared validator guarantees the loud error. [FAGAN, 2026-06-08]
    cat > "$TMPROOT/_badreq-comp.json" <<'JSON'
{"name":"probe-badreq","description":"d","intent":"i"}
JSON
    cat > "$TMPROOT/_badreq-seg.json" <<'JSON'
{"index":0,"segment_name":"probe-badreq.segment-1","kind":"sequential","stages":[{"stage":1,"construct":"the-mint","role":"primary","output_schema":{"type":"object","required":[123],"properties":{}}}]}
JSON
    run python3 "$EMIT" --segment "$TMPROOT/_badreq-seg.json" --composition "$TMPROOT/_badreq-comp.json" --cycle-id c --run-id r
    [[ "$status" -ne 0 ]] || fail "malformed required must fail loud, got exit 0"
    [[ "$output" == *"OUTPUT-SCHEMA-INVALID"* ]] || fail "missing OUTPUT-SCHEMA-INVALID marker: $output"
    [[ "$output" != *"Traceback"* ]] || fail "raw Python traceback leaked instead of clean error"
}

@test "emit: non-object output_schema (type != object) FAILS LOUD (handoff path needs an object)" {
    # isinstance(dict) is not enough — a {"type":"array"} schema is a dict but the Form C
    # handoff path reads named object keys, so it would silently degrade. V1 = inline OBJECT;
    # enforce type: object so the validator matches its own contract. [FAGAN, 2026-06-08]
    cat > "$TMPROOT/_nonobj-comp.json" <<'JSON'
{"name":"probe-nonobj","description":"d","intent":"i"}
JSON
    cat > "$TMPROOT/_nonobj-seg.json" <<'JSON'
{"index":0,"segment_name":"probe-nonobj.segment-1","kind":"sequential","stages":[{"stage":1,"construct":"the-mint","role":"primary","output_schema":{"type":"array","items":{"type":"string"}}}]}
JSON
    run python3 "$EMIT" --segment "$TMPROOT/_nonobj-seg.json" --composition "$TMPROOT/_nonobj-comp.json" --cycle-id c --run-id r
    [[ "$status" -ne 0 ]] || fail "non-object output_schema must fail loud, got exit 0"
    [[ "$output" == *"OUTPUT-SCHEMA-INVALID"* && "$output" == *"type: object"* ]] || fail "missing object-type guidance: $output"
}

@test "emit: __proto__ in output_schema property/required FAILS LOUD (prototype-pollution guard)" {
    # __proto__ has special JS object-literal semantics — emitted as a literal it would
    # silently re-shape the schema (emitted-JS != declared-JSON). Reject the pollution trio
    # at the source, fail-loud, never silently. [FAGAN, 2026-06-08]
    printf '{"name":"probe-proto","description":"d","intent":"i"}' > "$TMPROOT/_proto-comp.json"
    cat > "$TMPROOT/_proto-seg.json" <<'JSON'
{"index":0,"segment_name":"probe-proto.segment-1","kind":"sequential","stages":[{"stage":1,"construct":"the-mint","role":"primary","output_schema":{"type":"object","properties":{"__proto__":{"type":"string"}}}}]}
JSON
    run python3 "$EMIT" --segment "$TMPROOT/_proto-seg.json" --composition "$TMPROOT/_proto-comp.json" --cycle-id c --run-id r
    [[ "$status" -ne 0 ]] || fail "__proto__ property must fail loud, got exit 0"
    [[ "$output" == *"OUTPUT-SCHEMA-INVALID"* && "$output" != *"Traceback"* ]] || fail "expected clean OUTPUT-SCHEMA-INVALID: $output"
}

@test "emit: __proto__ as an output_schema.required ELEMENT FAILS LOUD (pollution guard, required path)" {
    # The pollution guard also rejects prototype-magic keys listed in required[] — those
    # collide with JS Object.prototype members and would pass conforms() vacuously. The
    # property-name test above does not exercise this path. [BB F-006, 2026-06-09]
    printf '{"name":"probe-proto-req","description":"d","intent":"i"}' > "$TMPROOT/_protoreq-comp.json"
    cat > "$TMPROOT/_protoreq-seg.json" <<'JSON'
{"index":0,"segment_name":"probe-proto-req.segment-1","kind":"sequential","stages":[{"stage":1,"construct":"the-mint","role":"primary","output_schema":{"type":"object","required":["__proto__"],"properties":{}}}]}
JSON
    run python3 "$EMIT" --segment "$TMPROOT/_protoreq-seg.json" --composition "$TMPROOT/_protoreq-comp.json" --cycle-id c --run-id r
    [[ "$status" -ne 0 ]] || fail "__proto__ in required must fail loud, got exit 0"
    [[ "$output" == *"OUTPUT-SCHEMA-INVALID"* && "$output" != *"Traceback"* ]] || fail "expected clean OUTPUT-SCHEMA-INVALID: $output"
}

# =============================================================================
# PR #32 regression block — args guard + conformance gate (issues #28/#29 +
# council findings). The preamble tests EXECUTE the emitted JS under each args
# shape; static greps cover the gate prompt contract.
# =============================================================================

_run_preamble() {
    # $1 = JS expression bound to `args`. Extracts the emitted args preamble
    # and executes it, printing {task, scope, warned}.
    local js; js="$(_emit_pilot_seg0)"
    local pre="$TMPROOT/preamble.js"
    sed -n '/@preamble-start/,/@preamble-end/p' "$js" > "$pre"
    [[ -s "$pre" ]] || fail "could not extract args preamble from emitted segment"
    node -e "
        const logs = [];
        const log = (m) => logs.push(m);
        const args = $1;
        $(cat "$pre")
        console.log(JSON.stringify({ task, scope, warned: logs.length > 0 }));
    "
}

@test "args guard: object args — task and scope honored (issue #28)" {
    command -v node >/dev/null || skip "node not available"
    run _run_preamble '({ task: "T-OBJ", scope: "S-OBJ" })'
    [[ "$status" -eq 0 ]] || fail "preamble exec failed: $output"
    grep -q '"task":"T-OBJ"' <<<"$output" || fail "object task lost: $output"
    grep -q '"scope":"S-OBJ"' <<<"$output" || fail "object scope lost: $output"
}

@test "args guard: stringified args are parsed — task survives (issue #28 root cause)" {
    command -v node >/dev/null || skip "node not available"
    run _run_preamble 'JSON.stringify({ task: "T-STR" })'
    [[ "$status" -eq 0 ]] || fail "preamble exec failed: $output"
    grep -q '"task":"T-STR"' <<<"$output" || fail "stringified task fell to placeholder: $output"
}

@test "args guard: DOUBLE-encoded args are unwrapped — task survives (council: cursor)" {
    command -v node >/dev/null || skip "node not available"
    run _run_preamble 'JSON.stringify(JSON.stringify({ task: "T-DBL" }))'
    [[ "$status" -eq 0 ]] || fail "preamble exec failed: $output"
    grep -q '"task":"T-DBL"' <<<"$output" || fail "double-encoded task fell to placeholder: $output"
}

@test "args guard: array-shaped args rejected, loud warning fires (council: cursor+claude)" {
    command -v node >/dev/null || skip "node not available"
    run _run_preamble '["not","an","object"]'
    [[ "$status" -eq 0 ]] || fail "preamble exec failed: $output"
    grep -q '"warned":true' <<<"$output" || fail "array args must warn loudly: $output"
    ! grep -q '"task":"not"' <<<"$output" || fail "array leaked into input"
}

@test "args guard: unparseable string warns and falls back, never throws (issue #28)" {
    command -v node >/dev/null || skip "node not available"
    run _run_preamble '"{not json"'
    [[ "$status" -eq 0 ]] || fail "unparseable args must not throw: $output"
    grep -q '"warned":true' <<<"$output" || fail "unparseable args must warn: $output"
}

@test "gate prompt: carries TASK + SCOPE and conformance supersedes re-review relaxation (issue #29)" {
    local js; js="$(_emit_pilot_seg0)"
    grep -q 'TASK the work stage was asked to implement' "$js" || fail "gate prompt missing TASK"
    grep -q '"SCOPE: " + JSON.stringify(scope)' "$js" || fail "gate prompt missing SCOPE"
    grep -q 'CONFORMANCE — supersedes the re-review relaxation' "$js" || fail "conformance must supersede the iteration>=2 relaxation"
    grep -q 'does not age into acceptance across iterations' "$js" || fail "standing-miss clause missing"
}

@test "sequential segment: scope extracted and threaded into stage prompts (council: gemini)" {
    cat > "$TMPROOT/seq-seg.json" <<'JSON'
{"segment_name":"seq","index":0,"kind":"sequential","stages":[{"stage":1,"name":"x","construct":"general-purpose","skill":"implement","role":"primary"}]}
JSON
    printf '{"name":"seq-test","description":"d","intent":"seq intent"}' > "$TMPROOT/seq-comp.json"
    run python3 "$EMIT" --segment "$TMPROOT/seq-seg.json" --composition "$TMPROOT/seq-comp.json"
    [[ "$status" -eq 0 ]] || fail "sequential emit failed: $output"
    grep -q 'const scope = input.scope' <<<"$output" || fail "sequential body missing scope extraction"
    grep -q '"SCOPE: " + JSON.stringify(scope)' <<<"$output" || fail "sequential stage prompt missing SCOPE"
    grep -q 'Array.isArray' <<<"$output" || fail "sequential body missing array guard (shared preamble drifted)"
}

@test "emitted segments carry no issue-tracker literals (council: claude — strings rot when issues close)" {
    local js; js="$(_emit_pilot_seg0)"
    ! grep -q 'issue #2[89]' "$js" || fail "emitted JS embeds tracker IDs: $(grep -n 'issue #2' "$js")"
}

# =============================================================================
# max-tier / fable regression block (2026-06-10 intel-routing review).
# The unified hounfour ladder {tiny,cheap,mid,max} + the rank-based gate floor.
# =============================================================================

@test "intel max-tier: work stage with intelligence_tier max -> fable" {
    [[ "$(_resolve_model '{"role":"primary","intelligence_tier":"max"}')" == "fable" ]] || fail "max must route to fable on a work stage"
}

@test "intel max-tier: mid routes to sonnet (hounfour ladder unified)" {
    [[ "$(_resolve_model '{"role":"primary","intelligence_tier":"mid"}')" == "sonnet" ]] || fail "mid must route to sonnet"
}

@test "intel max-tier: gate-class stage with explicit max -> fable (opt-in UPGRADE allowed)" {
    # The old guard was an unconditional pin (model = opus) and would have
    # DOWNGRADED an explicit fable gate. Floor semantics allow the upgrade.
    [[ "$(_resolve_model '{"role":"craft-gate","intelligence_tier":"max"}')" == "fable" ]] || fail "explicit max on a gate is an allowed upgrade, not pinned back to opus"
}

@test "intel max-tier: gate-class stage with NO tier stays opus (no auto-float to fable)" {
    # GYGAX verdict: auto-floating the broad gate class to the top tier is the
    # largest cost-runaway vector. The floor is a named constant pinned at opus.
    [[ "$(_resolve_model '{"role":"craft-gate"}')" == "opus" ]] || fail "default gate must stay at the opus floor, never auto-float to fable"
    [[ "$(_resolve_model '{"role":"gate","intelligence_tier":"cheap"}')" == "opus" ]] || fail "cheap on a gate still floors UP to opus"
}

@test "intel max-tier: tiny on a gate still floors to opus (GATE-NEVER-HAIKU preserved)" {
    [[ "$(_resolve_model '{"role":"review","intelligence_tier":"tiny"}')" == "opus" ]] || fail "tiny on a gate-class stage must floor to opus"
}

@test "intel max-tier: invalid tier still falls back by role (R-F004 unchanged)" {
    [[ "$(_resolve_model '{"role":"primary","intelligence_tier":"mega"}')" == "sonnet" ]] || fail "invalid tier must fall back to role default"
}
