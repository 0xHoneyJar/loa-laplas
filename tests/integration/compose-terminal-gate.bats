#!/usr/bin/env bats
# =============================================================================
# compose-terminal-gate.bats — the gradient-flip wiring (bd-26x).
# =============================================================================
# The proof-of-run gate (compose-verify-run.sh) only bites if the executor
# ACTUALLY runs it. This suite covers the wiring that makes the governed path the
# path of least resistance and every fake path worthless:
#
#   1. compose-dispatch.sh --form-c HANDS the executor the exact TERMINAL-gate
#      command (run_id baked, --require-executed) as both a copy-paste `cmd` and a
#      structured `argv`, in human + --json output, and breadcrumbs the
#      expectation (`form_c.terminal_gate_pending`) into the orchestrator trail.
#   2. The handed command distinguishes COMPILED from RUN: a compile-only run is
#      `compiled_run` (exit 2); after a segment executes (a validated handoff
#      envelope) the same command is `valid_run` (exit 0). "Compiled" cannot pass
#      as "completed".
#   2b. run_id is validated at the dispatch root: a metacharacter / `..` run_id is
#      rejected before any path access — no injection, no traversal, no side effect.
#   3. The gradient flip holds end-to-end: a governed run verifies; an
#      inline-approximated fake (a fabricated run_id, no dispatch) is not_a_run.
#
# Additive — it never mutates existing dispatch/emit behavior (run_id validation
# only rejects ids that were already path-unsafe). The exhaustive verdict
# semantics (tamper/forgery/envelopes) live in compose-verify-run.bats.
#
# Repo-relative paths; state isolated under a temp LOA_PROJECT_ROOT.
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
    [[ -f "$HWRAP" ]] || skip "compose-handoff-wrap.sh not found"
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
    export LOA_GRIMOIRE_DIR="$TMPROOT/grimoires"
    export LOA_CLEW_LEDGER_ROOT="$TMPROOT/ledger"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

# Compile a real Form C run for the pilot; capture STDOUT-only JSON into
# $COMPOSE_OUT and the exit code into $COMPOSE_RC. --form-c exits 3 on success,
# so the dispatch call is guarded (`&& ... || COMPOSE_RC=$?`) and the helper
# always `return 0` — otherwise bats' strict mode reads the expected exit-3 as a
# test failure (the same reason the sibling helper ends on `echo`).
_compile_json() {
    local run_id="${1:-tg1}"
    # Capture stderr (not /dev/null) so an UNEXPECTED dispatch failure (missing
    # dep, schema load, perms) is diagnosable rather than surfacing as an empty
    # COMPOSE_OUT (BB-23 F-003). Callers assert COMPOSE_RC == 3 (the success code).
    bash "$DISPATCH" "$PILOT" --form-c --run-id "$run_id" --json \
        >"$TMPROOT/dispatch.json" 2>"$TMPROOT/dispatch.err" \
        && COMPOSE_RC=0 || COMPOSE_RC=$?
    COMPOSE_OUT="$(cat "$TMPROOT/dispatch.json")"
    if [[ "$COMPOSE_RC" -ne 3 ]]; then
        echo "FAIL: unexpected dispatch exit $COMPOSE_RC (expected 3). stderr:" >&2
        cat "$TMPROOT/dispatch.err" >&2
    fi
    return 0
}

# Wrap a handoff seed into a validated envelope for $run_id (simulates a segment
# having executed). Mirrors compose-verify-run.bats's helper.
_wrap_envelope() {
    local run_id="$1" slug="${2:-codex-rescue}" stage="${3:-1}"
    local seed
    seed="$(jq -nc --arg s "$slug" --argjson i "$stage" \
        '{construct_slug:$s, persona:($s|ascii_upcase), output_type:"Artifact", invocation_mode:"room", stage_index:$i, verdict:{output:"diff", rationale:"why"}}')"
    printf '%s' "$seed" | bash "$HWRAP" --seed - --cycle-id cycle-053 --run-id "$run_id" >/dev/null 2>&1
}

# -----------------------------------------------------------------------------
# 1. Dispatch hands the executor the terminal gate.
# -----------------------------------------------------------------------------

@test "form-c --json emits a terminal_gate block with gate=compose-verify-run, required=true" {
    _compile_json tg-json
    [[ "$COMPOSE_RC" -eq 3 ]] || fail "expected compile exit 3, got $COMPOSE_RC: $COMPOSE_OUT"
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.gate == "compose-verify-run"' >/dev/null \
        || fail "terminal_gate.gate missing/wrong: $COMPOSE_OUT"
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.required == true' >/dev/null \
        || fail "terminal_gate.required should be true: $COMPOSE_OUT"
}

@test "form-c --json bakes the run_id into the terminal_gate (run_id + cmd + argv) in TERMINAL mode" {
    _compile_json tg-runid
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.run_id == "tg-runid"' >/dev/null \
        || fail "terminal_gate.run_id not baked: $COMPOSE_OUT"
    # The handed command is the TERMINAL gate (--require-executed), run_id baked.
    # (--legba may be inserted between --require-executed and --json by the gradient
    # flip when node + the bridge are present, so the flags are not asserted adjacent.)
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.cmd | test("compose-verify-run.sh tg-runid --require-executed")' >/dev/null \
        || fail "terminal_gate.cmd should be the baked TERMINAL gate command: $COMPOSE_OUT"
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.cmd | test("--json")' >/dev/null \
        || fail "terminal_gate.cmd should carry --json: $COMPOSE_OUT"
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.require_executed == true' >/dev/null \
        || fail "terminal_gate.require_executed should be true: $COMPOSE_OUT"
    # Structured argv (machine-safe; no shell-string ambiguity): [script, run_id, --require-executed, ..., --json].
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.argv | (type=="array") and (index("tg-runid")!=null) and (index("--require-executed")!=null) and (index("--json")!=null)' >/dev/null \
        || fail "terminal_gate.argv should be a structured array carrying the run_id + flags: $COMPOSE_OUT"
}

@test "form-c gradient flip: --legba is baked into the terminal gate when node + bridge are present" {
    # The flip is infra-gated: dispatch omits --legba when node is absent (no-op,
    # not breakage). Skip rather than assert in environments without node (Codex
    # P2) — matches the repo's other node-dependent guards.
    command -v node >/dev/null 2>&1 || skip "node not available — --legba is correctly omitted"
    _compile_json tg-legba
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.legba == true' >/dev/null \
        || fail "terminal_gate.legba should be true when node + the bridge are present: $COMPOSE_OUT"
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.cmd | test("--legba")' >/dev/null \
        || fail "terminal_gate.cmd should carry --legba: $COMPOSE_OUT"
    echo "$COMPOSE_OUT" | jq -e '.terminal_gate.argv | index("--legba") != null' >/dev/null \
        || fail "terminal_gate.argv should carry --legba: $COMPOSE_OUT"
}

@test "form-c human output prints the TERMINAL GATE line with the verify command" {
    run bash "$DISPATCH" "$PILOT" --form-c --run-id tg-human
    [[ "$status" -eq 3 ]] || fail "expected exit 3, got $status: $output"
    echo "$output" | grep -q "TERMINAL GATE" || fail "human output missing TERMINAL GATE line: $output"
    echo "$output" | grep -q "compose-verify-run.sh tg-human" || fail "TERMINAL GATE line missing the baked command: $output"
}

@test "form-c breadcrumbs form_c.terminal_gate_pending into the orchestrator trail" {
    _compile_json tg-trail
    local orch="$TMPROOT/.run/compose/tg-trail/orchestrator.jsonl"
    [[ -f "$orch" ]] || fail "orchestrator.jsonl absent"
    # The breadcrumb must be present, carry THIS run_id, and name the gate.
    grep -q '"event":"form_c.terminal_gate_pending"' "$orch" \
        || fail "no terminal_gate_pending breadcrumb: $(cat "$orch")"
    jq -e 'select(.event=="form_c.terminal_gate_pending") | .run_id == "tg-trail" and .payload.gate == "compose-verify-run"' "$orch" >/dev/null \
        || fail "breadcrumb run_id/gate wrong: $(cat "$orch")"
}

# -----------------------------------------------------------------------------
# 2. The handed command works AND distinguishes compiled-only from executed.
# -----------------------------------------------------------------------------

@test "the handed terminal_gate.cmd is compiled_run before execution, valid_run after" {
    _compile_json tg-roundtrip
    local cmd; cmd="$(echo "$COMPOSE_OUT" | jq -r '.terminal_gate.cmd')"
    [[ -n "$cmd" && "$cmd" != "null" ]] || fail "no terminal_gate.cmd to run: $COMPOSE_OUT"

    # Before any segment runs, the TERMINAL gate (--require-executed) must NOT call
    # this complete: it is compiled, not run. This is the closure of the subtler
    # defection (mint the compile, skip the work, claim done).
    run bash -c "$cmd"
    [[ "$status" -eq 4 ]] || fail "compile-only must be compiled_run (exit 4, distinct from not_a_run's 2), got $status: $output"
    echo "$output" | jq -e '.verdict == "compiled_run"' >/dev/null \
        || fail "compile-only should verify compiled_run: $output"

    # Now a segment executed (one validated handoff envelope) → valid_run.
    _wrap_envelope tg-roundtrip codex-rescue 1 || fail "could not wrap envelope"
    run bash -c "$cmd"
    [[ "$status" -eq 0 ]] || fail "executed run must be valid_run (exit 0), got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null \
        || fail "executed run should verify valid_run: $output"
}

@test "compiled_run (exit 4) and not_a_run (exit 2) are distinguishable by exit code alone (BB-23 F-001)" {
    # A real compile with --require-executed → compiled_run, exit 4.
    _compile_json tg-codes
    run bash "$VERIFY" tg-codes --require-executed --json
    [[ "$status" -eq 4 ]] || fail "compiled_run must be exit 4, got $status: $output"
    # A fabricated run_id with --require-executed → not_a_run, exit 2 (NOT 4).
    run bash "$VERIFY" tg-never-existed --require-executed --json
    [[ "$status" -eq 2 ]] || fail "not_a_run must be exit 2 (distinct from compiled_run's 4), got $status: $output"
    echo "$output" | jq -e '.verdict == "not_a_run"' >/dev/null || fail "expected not_a_run: $output"
}

# -----------------------------------------------------------------------------
# 2b. Run-id is validated at the dispatch root (no shell-injection / traversal).
# -----------------------------------------------------------------------------

@test "dispatch rejects a metacharacter run_id and runs no injected command (no side effect)" {
    local marker="$TMPROOT/PWNED"
    [[ -e "$marker" ]] && fail "marker pre-exists"
    # A run_id carrying shell metacharacters must be rejected BEFORE any path
    # access — never mkdir'd, never emitted as an executable command.
    run bash "$DISPATCH" "$PILOT" --form-c --run-id "x; touch $marker" --json
    [[ "$status" -ne 0 ]] || fail "an injection run_id must be rejected, got $status"
    [[ "$status" -ne 3 ]] || fail "an injection run_id must NOT compile (exit 3): $output"
    [[ ! -e "$marker" ]] || fail "injection executed — marker was created!"
    echo "$output" | grep -qi "invalid --run-id" || fail "expected an invalid-run-id error: $output"
}

@test "dispatch rejects a path-traversal run_id (..)" {
    run bash "$DISPATCH" "$PILOT" --form-c --run-id "../../etc/escape" --json
    [[ "$status" -ne 0 && "$status" -ne 3 ]] || fail "a ../-bearing run_id must be rejected: $status $output"
    echo "$output" | grep -qi "invalid --run-id" || fail "expected an invalid-run-id error: $output"
}

# -----------------------------------------------------------------------------
# 3. The gradient flip, end-to-end.
# -----------------------------------------------------------------------------

@test "gradient flip: a governed compiled run is valid_run, an inline fake is not_a_run" {
    # Governed: dispatch compiled it → real provenance → valid_run.
    _compile_json tg-governed
    run bash "$VERIFY" tg-governed --json
    [[ "$status" -eq 0 ]] || fail "governed run must verify valid_run, got $status: $output"
    echo "$output" | jq -e '.verdict == "valid_run"' >/dev/null || fail "expected valid_run: $output"

    # Inline fake: a run_id that was never dispatched (role-played in the main loop)
    # leaves no manifest → not_a_run. The fake is worthless.
    run bash "$VERIFY" tg-inline-roleplay-never-dispatched --json
    [[ "$status" -ne 0 ]] || fail "an undispatched (inline) run_id must NOT verify"
    echo "$output" | jq -e '.verdict == "not_a_run"' >/dev/null || fail "expected not_a_run for the fake: $output"
}
