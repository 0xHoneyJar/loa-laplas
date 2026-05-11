#!/usr/bin/env bats
# =============================================================================
# pair-relay-orchestrator.bats — Sprint 2 B.4 acceptance
# =============================================================================
# Cycle: cycle-craft-cluster (simstim-20260511-craftc1c5)
# PRD/SDD: §2.1.2 (RFC #235)
#
# Acceptance contract per grimoires/loa/sprint.md Sprint 2 B.4:
#   - end-to-end run with 2 mock construct fixtures
#   - asserts envelopes + relay-state.json + parallel fallback works
# =============================================================================

fail() {
    echo "FAIL: $*" >&2
    return 1
}

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    DISPATCH="$SUBSTRATE_ROOT/scripts/compose-dispatch.sh"
    PAIR_RELAY_VALID="$SUBSTRATE_ROOT/tests/fixtures/pair-relay/valid/minimal-2-stage.composition.yaml"
    PAIR_RELAY_FIDELITY="$SUBSTRATE_ROOT/tests/fixtures/pair-relay/valid/fidelity-3-stage.composition.yaml"
    PARALLEL_FIXTURE="$SUBSTRATE_ROOT/tests/fixtures/compositions/artisan-observer.composition.yaml"

    [[ -x "$DISPATCH" ]] || fail "compose-dispatch.sh not executable"
    [[ -f "$PAIR_RELAY_VALID" ]] || fail "pair-relay fixture missing"

    TMPROOT="$(mktemp -d)"
    export LOA_PROJECT_ROOT="$TMPROOT"

    # Stage two mock handoff packets for the 2-stage minimal fixture
    for s in 0 1; do
        cat > "$TMPROOT/h-$s.json" <<EOF
{
  "construct_slug": "mock-stage-$s",
  "output_type": "Verdict",
  "verdict": "stage-$s-passed",
  "invocation_mode": "Form-A",
  "cycle_id": "bats",
  "persona": "ALEXANDER",
  "why": {"rationale": "bats mock", "decisions_considered": [], "tools_used": []}
}
EOF
    done
    # And three for the 3-stage fidelity fixture
    for s in 0 1 2; do
        cat > "$TMPROOT/h3-$s.json" <<EOF
{
  "construct_slug": "mock-stage-$s",
  "output_type": "Verdict",
  "verdict": "stage-$s-passed",
  "invocation_mode": "Form-A",
  "cycle_id": "bats",
  "persona": "ALEXANDER",
  "why": {"rationale": "bats mock", "decisions_considered": [], "tools_used": []}
}
EOF
    done
}

teardown() {
    if [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]]; then
        find "$TMPROOT" -delete 2>/dev/null || true
    fi
}

# -----------------------------------------------------------------------------
# Pattern dispatch
# -----------------------------------------------------------------------------

@test "pattern dispatch: pair-relay composition routes into RELAY_LOOP" {
    run "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t1 \
        --inject-handoff "0:$TMPROOT/h-0.json" \
        --inject-handoff "1:$TMPROOT/h-1.json"
    [[ "$status" -eq 0 ]] || fail "expected 0 got $status; out: $output"
    local pattern
    pattern="$(echo "$output" | jq -r '.pattern')"
    [[ "$pattern" == "pair-relay" ]] || fail "expected pattern=pair-relay, got $pattern"
}

@test "pattern dispatch: parallel composition still uses the chain[]-walk (regression)" {
    [[ -f "$PARALLEL_FIXTURE" ]] || skip "parallel fixture missing"
    run "$DISPATCH" "$PARALLEL_FIXTURE" --headless --json --run-id t2
    # The parallel codepath depends on host-installed room-packet-validate.sh.
    # In substrate-standalone test (no .claude/scripts tree) it exits 2 with
    # "room packet validation failed". That's fine — what matters here is
    # that it routed into the PARALLEL branch, not RELAY_LOOP. We confirm
    # by checking the diagnostic for the parallel-specific error path.
    if [[ "$status" -eq 0 || "$status" -eq 3 ]]; then
        # Happy path: output is JSON and must not advertise pair-relay.
        if echo "$output" | jq -e '.pattern == "pair-relay"' >/dev/null 2>&1; then
            fail "parallel composition mis-routed into RELAY_LOOP"
        fi
    else
        # Parallel-path error in stub env: must reference room-packet validation,
        # which only the parallel codepath invokes.
        [[ "$output" == *"room packet validation"* || "$output" == *"room-packet-validate"* ]] || \
            fail "parallel composition seems mis-routed; out: $output"
    fi
}

# -----------------------------------------------------------------------------
# RELAY_LOOP execution + state machine
# -----------------------------------------------------------------------------

@test "RELAY_LOOP: cycle 1 with 2 injected handoffs completes both stages" {
    run "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t3 \
        --inject-handoff "0:$TMPROOT/h-0.json" \
        --inject-handoff "1:$TMPROOT/h-1.json"
    [[ "$status" -eq 0 ]] || fail "expected 0 got $status"
    local dispatched
    dispatched="$(echo "$output" | jq -r '.stages_dispatched')"
    [[ "$dispatched" -ge 2 ]] || fail "expected >=2 stages dispatched, got $dispatched"
}

@test "RELAY_LOOP: relay-state.json is written + updated through the run" {
    "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t4 \
        --inject-handoff "0:$TMPROOT/h-0.json" \
        --inject-handoff "1:$TMPROOT/h-1.json" >/dev/null
    local state="$TMPROOT/.run/compose/t4/relay-state.json"
    [[ -f "$state" ]] || fail "relay-state.json missing at $state"
    local pattern artifact max_cycles seq_len completed conv
    pattern="$(jq -r '.pattern' "$state")"
    artifact="$(jq -r '.artifact_name' "$state")"
    max_cycles="$(jq -r '.max_cycles' "$state")"
    seq_len="$(jq -r '.sequence_length' "$state")"
    completed="$(jq -r '.completed_cycles | length' "$state")"
    conv="$(jq -r '.convergence_state' "$state")"
    [[ "$pattern" == "pair-relay" ]] || fail "expected pattern=pair-relay, got $pattern"
    [[ "$artifact" == "minimal-relay-output" ]] || fail "wrong artifact name: $artifact"
    [[ "$max_cycles" -eq 2 ]] || fail "expected max_cycles=2, got $max_cycles"
    [[ "$seq_len" -eq 2 ]] || fail "expected seq_len=2, got $seq_len"
    [[ "$completed" -ge 1 ]] || fail "expected >=1 completed cycle, got $completed"
    [[ -n "$conv" && "$conv" != "null" ]] || fail "convergence_state empty: $conv"
}

@test "RELAY_LOOP: envelopes are written under <run_dir>/envelopes per cycle/stage" {
    "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t5 \
        --inject-handoff "0:$TMPROOT/h-0.json" \
        --inject-handoff "1:$TMPROOT/h-1.json" >/dev/null
    local env_dir="$TMPROOT/.run/compose/t5/envelopes"
    [[ -d "$env_dir" ]] || fail "envelopes dir missing"
    local n_envelopes
    n_envelopes="$(find "$env_dir" -name "c*.handoff.json" | wc -l | tr -d ' ')"
    [[ "$n_envelopes" -ge 2 ]] || fail "expected >=2 envelopes, got $n_envelopes"
    # Names follow c<cycle>.<stage>.<slug>.handoff.json
    [[ -f "$env_dir/c1.00.artisan.handoff.json" ]] || fail "missing cycle-1 stage-0 envelope"
    [[ -f "$env_dir/c1.01.crucible.handoff.json" ]] || fail "missing cycle-1 stage-1 envelope"
}

@test "RELAY_LOOP: orchestrator.jsonl contains relay.cycle_start + relay.cycle_complete + envelope.surfaced" {
    "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t6 \
        --inject-handoff "0:$TMPROOT/h-0.json" \
        --inject-handoff "1:$TMPROOT/h-1.json" >/dev/null
    local log="$TMPROOT/.run/compose/t6/orchestrator.jsonl"
    [[ -f "$log" ]] || fail "orchestrator log missing"
    grep -q '"event":"compose.start"' "$log" || fail "missing compose.start"
    grep -q '"event":"relay.cycle_start"' "$log" || fail "missing relay.cycle_start"
    grep -q '"event":"relay.cycle_complete"' "$log" || fail "missing relay.cycle_complete"
    grep -q '"event":"envelope.surfaced"' "$log" || fail "missing envelope.surfaced"
    grep -q '"event":"compose.complete"' "$log" || fail "missing compose.complete"
}

@test "RELAY_LOOP: max_cycles caps iteration when handoffs run out" {
    # Provide handoffs only for cycle 1. RELAY_LOOP should mark cycle 2 as
    # halted-no-handoff and terminate without exceeding max_cycles.
    run "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t7 \
        --inject-handoff "0:$TMPROOT/h-0.json" \
        --inject-handoff "1:$TMPROOT/h-1.json"
    [[ "$status" -eq 0 ]] || fail "expected 0 got $status; out: $output"
    local conv completed
    conv="$(echo "$output" | jq -r '.convergence_state')"
    completed="$(echo "$output" | jq -r '.completed_cycles | length')"
    [[ "$conv" == "halted-no-handoff" ]] || fail "expected halted-no-handoff, got $conv"
    [[ "$completed" -eq 1 ]] || fail "expected exactly 1 completed cycle, got $completed"
}

@test "RELAY_LOOP: multi-cycle completion when all cycles have injected handoffs" {
    # minimal-2-stage has max_cycles=2; inject handoffs for both cycles.
    run "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t8 \
        --inject-handoff "1:0:$TMPROOT/h-0.json" \
        --inject-handoff "1:1:$TMPROOT/h-1.json" \
        --inject-handoff "2:0:$TMPROOT/h-0.json" \
        --inject-handoff "2:1:$TMPROOT/h-1.json"
    [[ "$status" -eq 0 ]] || fail "expected 0 got $status; out: $output"
    local conv completed
    conv="$(echo "$output" | jq -r '.convergence_state')"
    completed="$(echo "$output" | jq -r '.completed_cycles | length')"
    [[ "$conv" == "completed-max-cycles" ]] || fail "expected completed-max-cycles, got $conv"
    [[ "$completed" -eq 2 ]] || fail "expected 2 completed cycles, got $completed"
}

# -----------------------------------------------------------------------------
# Validation gates
# -----------------------------------------------------------------------------

@test "validation gate: malformed pair-relay composition is rejected before RELAY_LOOP" {
    # surface_mode 'noisy' violates the schema enum
    run "$DISPATCH" "$SUBSTRATE_ROOT/tests/fixtures/pair-relay/invalid/04-bad-surface-mode.composition.yaml" \
        --headless --json --run-id t9
    [[ "$status" -eq 1 ]] || fail "expected 1 got $status; out: $output"
    [[ "$output" == *"pair-relay composition validation failed"* ]] || fail "expected validation error msg: $output"
}

@test "validation gate: max_cycles < sequence.length rejected before any dispatch" {
    run "$DISPATCH" "$SUBSTRATE_ROOT/tests/fixtures/pair-relay/invalid/05-max-cycles-too-low.composition.yaml" \
        --headless --json --run-id t10
    [[ "$status" -eq 1 ]] || fail "expected 1 got $status"
    [[ "$output" == *"max_cycles"* ]] || fail "expected max_cycles msg: $output"
}

# -----------------------------------------------------------------------------
# 3-stage reference shape
# -----------------------------------------------------------------------------

@test "RELAY_LOOP: 3-stage fidelity composition completes cycle 1 with 3 handoffs" {
    run "$DISPATCH" "$PAIR_RELAY_FIDELITY" --headless --json --run-id t11 \
        --inject-handoff "0:$TMPROOT/h3-0.json" \
        --inject-handoff "1:$TMPROOT/h3-1.json" \
        --inject-handoff "2:$TMPROOT/h3-2.json"
    [[ "$status" -eq 0 ]] || fail "expected 0 got $status; out: $output"
    local seq_len dispatched
    seq_len="$(echo "$output" | jq -r '.sequence_length')"
    dispatched="$(echo "$output" | jq -r '.stages_dispatched')"
    [[ "$seq_len" -eq 3 ]] || fail "expected seq_len=3, got $seq_len"
    [[ "$dispatched" -ge 3 ]] || fail "expected >=3 dispatched, got $dispatched"
}

# -----------------------------------------------------------------------------
# Surface mode interaction
# -----------------------------------------------------------------------------

@test "RELAY_LOOP: blocked_ms is populated in envelope.surfaced rows" {
    "$DISPATCH" "$PAIR_RELAY_VALID" --headless --json --run-id t12 \
        --inject-handoff "0:$TMPROOT/h-0.json" \
        --inject-handoff "1:$TMPROOT/h-1.json" >/dev/null
    local log="$TMPROOT/.run/compose/t12/orchestrator.jsonl"
    local blocked
    blocked="$(grep '"event":"envelope.surfaced"' "$log" | head -1 | jq -r '.blocked_ms // .payload.blocked_ms // "absent"')"
    [[ "$blocked" != "absent" && "$blocked" != "null" ]] || fail "envelope.surfaced has no blocked_ms field: $(grep envelope.surfaced "$log" | head -1)"
}
