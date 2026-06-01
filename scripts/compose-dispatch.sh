#!/usr/bin/env bash
# =============================================================================
# compose-dispatch.sh — Composition runner with native-agent dispatch
# =============================================================================
# Cycle: simstim-20260509-aead9136 (Sprint 2, S2-T2)
# PRD: FR-5 (composition visibility)
# SDD: §2.6 (composition runner integration)
#
# Orchestrates multi-stage construct compositions. Two execution modes:
#
#   INTERACTIVE (Form A): writes dispatch prompts the operator pastes into
#     their Claude Code session. The operator's session uses @-mention
#     typeahead to spawn project agents. Subagents are visible in the main UI.
#     Required for T4 acceptance (visible chain).
#
#   HEADLESS (Form B audit-substrate path): invokes `claude -p` per stage.
#     Produces handoff packets but subagents are NOT visible in operator's
#     main UI (per Sprint 0 Probe 2). Useful for CI / batch / audit-only runs.
#     Sprint 4 completes this path.
#
# Per-stage flow:
#   1. Construct room activation packet from prior handoff + declared inputs
#   2. Write packet to .run/rooms/<room_id>.json
#   3. Log stage_enter to .run/compose/<run_id>/orchestrator.jsonl
#   4. Dispatch (Form A: emit prompt; Form B: claude -p)
#   5. Validate returned handoff packet
#   6. Write packet to .run/compose/<run_id>/envelopes/<idx>.<slug>.handoff.json
#   7. Log stage_exit
#
# Usage:
#   compose-dispatch.sh <composition.yaml> [options]
#
# Options:
#   --interactive    Force interactive mode (Form A)
#   --headless       Force headless mode (Form B; partial — Sprint 4 completes)
#   --run-id ID      Use specific run_id (default: generated)
#   --stage N        Execute only stage N (0-indexed; for resumption)
#   --dry-run        Validate composition + emit packets without dispatching
#   --json           Structured JSON output to stdout
#
# Exit codes:
#   0  All stages dispatched + handoffs validated
#   1  Composition validation failed
#   2  Stage failed (handoff validation or dispatch error)
#   3  Awaiting operator (Form A: prompt emitted, awaiting paste)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Default PROJECT_ROOT is one dir above the substrate (matches how this script
# expects to live at <project>/.claude/scripts/...). For substrate-standalone
# tests, LOA_PROJECT_ROOT env override re-roots .run/ and host-installed paths.
if [[ -n "${LOA_PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$LOA_PROJECT_ROOT"
else
    PROJECT_ROOT="$(cd "$SUBSTRATE_ROOT/.." && pwd)"
fi
# Composition (bridge) schema. Canonical home is the host (loa-constructs); this
# script reads it from the installed PROJECT_ROOT. For substrate-standalone runs /
# CI, LOA_COMPOSE_SCHEMA overrides, and a substrate-local copy is a last resort.
if [[ -n "${LOA_COMPOSE_SCHEMA:-}" ]]; then
    COMPOSE_SCHEMA="$LOA_COMPOSE_SCHEMA"
elif [[ -f "$PROJECT_ROOT/.claude/schemas/runtime/composition.schema.json" ]]; then
    COMPOSE_SCHEMA="$PROJECT_ROOT/.claude/schemas/runtime/composition.schema.json"
elif [[ -f "$SUBSTRATE_ROOT/data/runtime-schemas/composition.schema.json" ]]; then
    COMPOSE_SCHEMA="$SUBSTRATE_ROOT/data/runtime-schemas/composition.schema.json"
else
    COMPOSE_SCHEMA="$PROJECT_ROOT/.claude/schemas/runtime/composition.schema.json"
fi
HANDOFF_VALIDATOR="$PROJECT_ROOT/.claude/scripts/handoff-validate.sh"
ROOM_VALIDATOR="$PROJECT_ROOT/.claude/scripts/room-packet-validate.sh"
# Form C (cycle-053) libs — the cut algorithm + segment emitter + syntax checker.
COMPOSE_CUT_LIB="$SCRIPT_DIR/lib/compose-cut.py"
SEGMENT_EMITTER_LIB="$SCRIPT_DIR/lib/segment-emitter.py"
WORKFLOW_SYNTAX_CHECK="$SCRIPT_DIR/lib/workflow-syntax-check.js"
# Substrate-canonical handoff/room schemas (fallback when host paths absent).
HANDOFF_SCHEMA_SUBSTRATE="$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json"
ROOM_SCHEMA_SUBSTRATE="$SUBSTRATE_ROOT/data/trajectory-schemas/room-activation-packet.schema.json"

# Pair-relay (cycle-craft-cluster Sprint 2 B.4) — substrate-canonical first,
# fall back to host-installed locations.
PAIR_RELAY_SCHEMA_SUBSTRATE="$SUBSTRATE_ROOT/data/trajectory-schemas/pair-relay-composition.schema.json"
PAIR_RELAY_SCHEMA_HOST="$PROJECT_ROOT/.claude/data/trajectory-schemas/pair-relay-composition.schema.json"
PAIR_RELAY_VALIDATOR_SUBSTRATE="$SUBSTRATE_ROOT/scripts/pair-relay-validate.sh"
PAIR_RELAY_VALIDATOR_HOST="$PROJECT_ROOT/.claude/scripts/pair-relay-validate.sh"
SURFACE_ENVELOPE_SUBSTRATE="$SUBSTRATE_ROOT/scripts/surface-envelope.sh"
SURFACE_ENVELOPE_HOST="$PROJECT_ROOT/.claude/scripts/surface-envelope.sh"

usage() {
    cat <<EOF
Usage: compose-dispatch.sh <composition.yaml> [options]

Options:
  --interactive    Force interactive mode (Form A — operator pastes dispatch prompt)
  --headless       Force headless mode (Form B — claude -p; partial in Sprint 2)
  --form-c         Form C (cycle-053): compile the composition into Claude Code
                   dynamic-workflow segments cut at gate seams. Emits one
                   .workflow.js per autonomous segment + room packets + a manifest;
                   the Claude Code main loop runs them via the Workflow tool and
                   drives the seam protocol. (alias: --workflow)
  --seam-roles R   Comma-separated roles treated as seams in the cut
                   (default: hard-stop,craft-gate,gate; env LOA_SEAM_ROLES)
  --run-id ID      Specific run_id (default: generated YYYYMMDD-HEXSHORT)
  --stage N        Execute only stage N (0-indexed)
  --dry-run        Validate composition; emit room packets; do not dispatch
  --json           Structured JSON output

Exit codes:
  0  All stages dispatched + handoffs validated
  1  Composition validation failed
  2  Stage failed
  3  Awaiting operator (Form A interactive) / awaiting main-loop run (Form C)
EOF
}

COMP_PATH=""
MODE=""
RUN_ID=""
ONE_STAGE=""
DRY_RUN=0
OUTPUT_JSON=0
SEAM_ROLES="${LOA_SEAM_ROLES:-hard-stop,craft-gate,gate}"  # Form C cut: seam roles
INJECT_HANDOFFS=()  # cycle-craft-cluster B.4: bats test hook, "<stage>:<path>"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --interactive) MODE="interactive"; shift ;;
        --headless) MODE="headless"; shift ;;
        --form-c|--workflow) MODE="workflow"; shift ;;
        --seam-roles) SEAM_ROLES="$2"; shift 2 ;;
        --run-id) RUN_ID="$2"; shift 2 ;;
        --stage) ONE_STAGE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --json) OUTPUT_JSON=1; shift ;;
        --inject-handoff)
            # cycle-craft-cluster B.4: pre-stage a mock handoff packet so bats
            # tests can exercise the RELAY_LOOP state machine end-to-end without
            # spinning up real construct subagents. Form: "<stage_index>:<path>".
            INJECT_HANDOFFS+=("$2"); shift 2 ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "ERROR: unknown flag '$1'" >&2; exit 1 ;;
        *) if [[ -z "$COMP_PATH" ]]; then COMP_PATH="$1"; else echo "ERROR: extra arg" >&2; exit 1; fi; shift ;;
    esac
done

if [[ -z "$COMP_PATH" ]]; then
    usage >&2
    exit 1
fi

if [[ ! -f "$COMP_PATH" ]]; then
    echo "ERROR: composition not found: $COMP_PATH" >&2
    exit 1
fi

# Mode detection if not forced
if [[ -z "$MODE" ]]; then
    if [[ -n "${CLAUDE_CODE_INTERACTIVE_SESSION:-}" ]] || { [[ -t 0 ]] && [[ -z "${CI:-}" ]]; }; then
        MODE="interactive"
    else
        MODE="headless"
    fi
fi

# Generate run_id if not supplied
if [[ -z "$RUN_ID" ]]; then
    RUN_ID="$(date -u +%Y%m%d)-$(openssl rand -hex 3)"
fi

RUN_DIR="$PROJECT_ROOT/.run/compose/$RUN_ID"
ORCHESTRATOR_LOG="$RUN_DIR/orchestrator.jsonl"
ROOMS_DIR="$PROJECT_ROOT/.run/rooms"
ENVELOPES_DIR="$RUN_DIR/envelopes"
PROMPTS_DIR="$RUN_DIR/dispatch-prompts"

mkdir -p "$RUN_DIR" "$ENVELOPES_DIR" "$PROMPTS_DIR" "$ROOMS_DIR"

# Initialize logger
log_event() {
    local event="$1"
    local payload_json="${2:-{\}}"
    local ts
    # macOS date lacks %N; portable RFC 3339 format is sufficient for log ordering
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    jq -nc --arg event "$event" --arg ts "$ts" --arg run_id "$RUN_ID" --argjson payload "$payload_json" \
        '{event: $event, ts: $ts, run_id: $run_id, payload: $payload}' >> "$ORCHESTRATOR_LOG"
}

# =============================================================================
# Form C (cycle-053): compile a composition into Claude Code dynamic-workflow
# segments. This script is the COMPILER; the Claude Code main loop is the
# EXECUTOR (runs each emitted segment via the Workflow tool + the seam protocol).
# =============================================================================

# Build the per-stage room-activation packets (invocation_path=agent_call so the
# construct runs in ROOM AUTHORITY, not studio mode — FINDINGS #2b). Writes each
# packet to ROOMS_DIR and prints a JSON map {"<stage>": <packet>} to stdout.
# Inputs passed via argv (injection-safe — no shell interpolation into Python).
_build_room_packets_map() {
    local cycle_id="$1"
    python3 - "$COMP_JSON" "$cycle_id" "$RUN_ID" "$ROOMS_DIR" <<'PYEOF'
import json, sys, hashlib
try:
    import rfc8785
    def canon(b): return rfc8785.dumps(b)
except Exception:
    # Deterministic fallback so room_id is still content-addressable offline.
    def canon(b): return json.dumps(b, sort_keys=True, separators=(",", ":")).encode()

comp = json.loads(sys.argv[1]); cycle_id = sys.argv[2]; run_id = sys.argv[3]; rooms_dir = sys.argv[4]
out = {}
for st in sorted(comp.get("chain", []), key=lambda s: float(s.get("stage", 0))):
    writes = st.get("writes") or []
    body = {
        "cycle_id": cycle_id,
        "construct_slug": st.get("construct"),
        "persona": (st.get("persona") if st.get("persona") not in ("", None) else None),
        "mode": "room",
        "invocation_path": "agent_call",   # Form C: programmatic agent() spawn
        "inputs": [],
        "expected_output_type": (writes[0] if writes else "Verdict"),
        "expected_handoff_path": None,
        "composition_run_id": run_id,
        "stage_index": None,
        "forbidden_context": [],
        "allowed_skills": ([st.get("skill")] if st.get("skill") else []),
        "created_at": "1970-01-01T00:00:00Z",  # stable for content-addressing; runner stamps logs
        "created_by": "compose-dispatch.sh (form-c)",
    }
    room_id = "sha256:" + hashlib.sha256(canon(body)).hexdigest()
    packet = dict(body); packet["room_id"] = room_id
    path = f"{rooms_dir}/{room_id[len('sha256:'):]}.json"
    with open(path, "w") as f:
        json.dump(packet, f, indent=2)
    out[str(st.get("stage"))] = packet
print(json.dumps(out))
PYEOF
}

_run_form_c() {
    local comp_name cycle_id wf_dir plan schema_arg authored_at
    comp_name="$(echo "$COMP_JSON" | jq -r '.name // "composition"')"
    cycle_id="${LOA_CYCLE_ID:-cycle-053}"
    wf_dir="$RUN_DIR/workflows"

    # 1. VALIDATE (offline-robust) + CUT — before any token OR artifact is spent
    # (NFR-2 cost-ordering: an invalid composition emits NOTHING).
    schema_arg=()
    [[ -f "$COMPOSE_SCHEMA" ]] && schema_arg=(--schema "$COMPOSE_SCHEMA")
    plan="$(printf '%s' "$COMP_JSON" | python3 "$COMPOSE_CUT_LIB" - "${schema_arg[@]}" --seam-roles "$SEAM_ROLES" 2>/dev/null)"
    if [[ -z "$plan" ]] || [[ "$(echo "$plan" | jq -r '.ok // false')" != "true" ]]; then
        echo "ERROR: Form C validate/cut failed for '$comp_name':" >&2
        echo "${plan:-<no output>}" | jq -r '.errors[]? | "  - \(.path | tojson): \(.msg)"' 2>/dev/null >&2 || echo "  $plan" >&2
        log_event "form_c.cut_failed" "$(echo "${plan:-{\}}" | jq -c '. // {}')"
        return 1
    fi

    # Surface non-fatal cut warnings (#11): e.g. a construct-bearing stage cut to a
    # PURE seam, which will NOT run as an agent — the author may not realize their
    # construct was turned into an operator pause. Loud (stderr) but non-blocking.
    # Redirection order matters (see the #8 fix): `>&2 2>/dev/null` sends jq's stdout
    # to the real stderr, THEN drops jq's own stderr — `2>/dev/null >&2` would discard
    # the warning by pointing stdout at the already-/dev/null'd fd2.
    echo "$plan" | jq -r '.warnings[]? | "  ⚠ compose: \(.)"' >&2 2>/dev/null || true

    # Validation passed — only NOW create the emit dir + persist the composition.
    mkdir -p "$wf_dir"
    printf '%s' "$COMP_JSON" | jq . > "$RUN_DIR/composition.json"

    local n_segs n_seams
    n_segs="$(echo "$plan" | jq '.segments | length')"
    n_seams="$(echo "$plan" | jq '.seams | length')"
    log_event "compose.start" "$(jq -n --arg name "$comp_name" --arg mode "workflow" --arg cycle "$cycle_id" --argjson segs "$n_segs" --argjson seams "$n_seams" \
        '{composition: $name, mode: $mode, cycle_id: $cycle, segments: $segs, seams: $seams}')"
    log_event "form_c.cut" "$(echo "$plan" | jq -c '{segments: [.segments[] | {index, segment_name, kind, iterate, ends_at_seam}], seams: [.seams[] | {after_segment, kind, terminal}]}')"
    [[ "$OUTPUT_JSON" == "1" ]] || echo "[compose-dispatch] Form C '$comp_name' — cut into $n_segs segment(s) + $n_seams seam(s) — run_id=$RUN_ID"

    # 2. ROOM PACKETS (agent_call → room authority).
    local rooms_map
    rooms_map="$(_build_room_packets_map "$cycle_id")"
    if [[ -z "$rooms_map" ]] || ! echo "$rooms_map" | jq -e 'type == "object"' >/dev/null 2>&1; then
        echo "ERROR: Form C room-packet construction failed" >&2
        log_event "form_c.room_packets_failed" "{}"
        return 2
    fi
    # Validate each written room packet. Resolve the validator: host install first,
    # then substrate-canonical (standalone / CI). Same for the schema path.
    local room_validator="$ROOM_VALIDATOR"
    [[ -x "$room_validator" ]] || room_validator="$SUBSTRATE_ROOT/scripts/room-packet-validate.sh"
    local room_schema_arg=()
    if [[ -f "$PROJECT_ROOT/.claude/data/trajectory-schemas/room-activation-packet.schema.json" ]]; then
        room_schema_arg=(--schema "$PROJECT_ROOT/.claude/data/trajectory-schemas/room-activation-packet.schema.json")
    elif [[ -f "$ROOM_SCHEMA_SUBSTRATE" ]]; then
        room_schema_arg=(--schema "$ROOM_SCHEMA_SUBSTRATE")
    fi
    if [[ -x "$room_validator" ]]; then
        while IFS= read -r rp_path; do
            [[ -f "$rp_path" ]] || continue
            if ! "$room_validator" "$rp_path" "${room_schema_arg[@]}" --json >/dev/null 2>&1; then
                echo "ERROR: Form C room packet failed validation: $rp_path" >&2
                "$room_validator" "$rp_path" "${room_schema_arg[@]}" >&2 2>&1 || true
                log_event "form_c.room_packet_invalid" "$(jq -n --arg p "$rp_path" '{packet: $p}')"
                return 2
            fi
        done < <(echo "$rooms_map" | jq -r '.[].room_id' | while read -r rid; do echo "$ROOMS_DIR/${rid#sha256:}.json"; done)
    fi

    # 3. EMIT each segment + syntax/determinism check (fail-closed before spend).
    authored_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    local emitted_files="[]"
    local si
    for ((si=0; si<n_segs; si++)); do
        local seg seg_name out_file
        seg="$(echo "$plan" | jq -c ".segments[$si]")"
        seg_name="$(echo "$seg" | jq -r '.segment_name')"
        out_file="$wf_dir/${seg_name}.workflow.js"
        if ! printf '%s' "$seg" | python3 "$SEGMENT_EMITTER_LIB" --segment - \
                --composition "$RUN_DIR/composition.json" \
                --room-packets "$rooms_map" \
                --cycle-id "$cycle_id" --run-id "$RUN_ID" --authored-at "$authored_at" \
                > "$out_file"; then
            echo "ERROR: Form C emit failed for segment $si ($seg_name)" >&2
            log_event "form_c.emit_failed" "$(jq -n --argjson idx "$si" --arg name "$seg_name" '{index: $idx, segment: $name}')"
            return 2
        fi
        # Syntax + determinism gate (matches the runtime's Date/Math.random guard).
        if command -v node >/dev/null 2>&1 && [[ -f "$WORKFLOW_SYNTAX_CHECK" ]]; then
            if ! node "$WORKFLOW_SYNTAX_CHECK" "$out_file" >/dev/null 2>&1; then
                echo "ERROR: emitted segment failed syntax/determinism check: $out_file" >&2
                node "$WORKFLOW_SYNTAX_CHECK" "$out_file" >&2 || true
                log_event "form_c.segment_invalid" "$(jq -n --arg f "$out_file" '{file: $f}')"
                return 2
            fi
        fi
        emitted_files="$(echo "$emitted_files" | jq --arg f "$out_file" '. + [$f]')"
        log_event "form_c.segment_emitted" "$(jq -n --argjson idx "$si" --arg name "$seg_name" --arg file "$out_file" \
            '{index: $idx, segment: $name, workflow_file: $file}')"
        [[ "$OUTPUT_JSON" == "1" ]] || echo "[compose-dispatch]   segment $si → $out_file"
    done

    # 4. MANIFEST — the contract the main loop's seam protocol consumes.
    local manifest="$RUN_DIR/form-c-manifest.json"
    echo "$plan" | jq \
        --arg run_id "$RUN_ID" --arg comp "$comp_name" --arg cycle "$cycle_id" \
        --argjson files "$emitted_files" --argjson rooms "$rooms_map" \
        --arg seam_doc "docs/compose-as-cc-workflow.md" \
        '{
            run_id: $run_id, composition: $comp, cycle_id: $cycle, mode: "workflow",
            schema_version: .composition.schema_version, seam_roles: .composition.seam_roles,
            segments: [ .segments[] as $s | $s + { workflow_file: $files[$s.index],
                agent_types: [ $s.stages[] | "construct-" + .construct ] } ],
            seams: [ .seams[] | . + { clew_targets: ( if .seam_stage then
                [ { construct: .seam_stage.construct, skill: (.seam_stage.skill // "") } ] else [] end ) } ],
            room_packets: $rooms,
            seam_protocol: $seam_doc,
            clew_capture: "scripts/clew/loa-clew-capture.sh"
        }' > "$manifest"
    log_event "form_c.manifest" "$(jq -n --arg m "$manifest" --argjson segs "$n_segs" --argjson seams "$n_seams" '{manifest: $m, segments: $segs, seams: $seams}')"
    log_event "compose.awaiting_main_loop" "$(jq -n --argjson segs "$n_segs" '{segments: $segs, runner: "Claude Code Workflow tool"}')"

    # 5. OUTPUT.
    if [[ "$OUTPUT_JSON" == "1" ]]; then
        jq -n --arg run_id "$RUN_ID" --arg comp "$comp_name" --argjson segs "$n_segs" --argjson seams "$n_seams" --arg manifest "$manifest" \
            '{run_id: $run_id, composition: $comp, mode: "workflow", segments: $segs, seams: $seams, manifest: $manifest, awaiting_main_loop: true, exit_code: 3}'
    else
        echo "[compose-dispatch] Form C compiled — run each segment via the Workflow tool per: $manifest"
    fi
    return 3
}

# -----------------------------------------------------------------------------
# Step 1: Validate composition YAML against schema
# -----------------------------------------------------------------------------
COMP_JSON="$(python3 - "$COMP_PATH" <<'PYEOF'
import json, sys, yaml
try:
    with open(sys.argv[1]) as f:
        data = yaml.safe_load(f)
    print(json.dumps(data))
except Exception as e:
    print(json.dumps({"_error": str(e)}))
PYEOF
)"

if [[ "$(echo "$COMP_JSON" | jq -r '._error // ""')" != "" ]]; then
    echo "ERROR: composition YAML parse failed: $(echo "$COMP_JSON" | jq -r '._error')" >&2
    exit 1
fi

# Form C (cycle-053): compile the composition into CC dynamic-workflow segments.
# Runs its OWN offline-robust validate+cut (compose-cut.py) and exits — it does
# not fall through to the Form A/B chain walk or the network-fragile inline
# validator below. The main loop then runs the emitted segments + seam protocol.
if [[ "$MODE" == "workflow" ]]; then
    _run_form_c
    exit $?
fi

# cycle-craft-cluster B.4 (RFC #235): read composition pattern at
# COMPOSITION_VALIDATE; default 'parallel' for backward compatibility with the
# existing chain[]-walking flow. 'pair-relay' routes into RELAY_LOOP below.
PATTERN="$(echo "$COMP_JSON" | jq -r '.pattern // "parallel"')"

if [[ "$PATTERN" == "pair-relay" ]]; then
    # Dispatch to the pair-relay branch (defined later in this script).
    # Schema validation, sequence walk, cycle loop, and envelope surfacing
    # all live in _run_pair_relay below.
    PAIR_RELAY_FLOW=1
else
    PAIR_RELAY_FLOW=0
fi

if [[ "$PAIR_RELAY_FLOW" == "0" ]]; then

# Validate against composition schema if available.
# Pass JSON + schema-path via argv to avoid Python-heredoc injection (BB review F001).
# Using argv is safe because Python receives sys.argv strings as raw — no shell
# metachars or quote-breaking can survive into Python source.
if [[ -f "$COMPOSE_SCHEMA" ]]; then
    VALIDATE_RESULT="$(python3 - "$COMP_JSON" "$COMPOSE_SCHEMA" <<'PYEOF'
import json, sys
try:
    import jsonschema
except ImportError:
    print(json.dumps({"ok": False, "reason": "jsonschema_not_installed"}))
    sys.exit(0)
comp = json.loads(sys.argv[1])
schema_path = sys.argv[2]
with open(schema_path) as f:
    schema = json.load(f)
validator = jsonschema.Draft202012Validator(schema)
errors = sorted(validator.iter_errors(comp), key=lambda e: list(e.absolute_path))
if errors:
    print(json.dumps({"ok": False, "errors": [{"path": list(e.absolute_path), "msg": e.message} for e in errors[:5]]}))
else:
    print(json.dumps({"ok": True}))
PYEOF
)"

    if [[ "$(echo "$VALIDATE_RESULT" | jq -r '.ok')" != "true" ]]; then
        echo "ERROR: composition validation failed:" >&2
        echo "$VALIDATE_RESULT" | jq -r '.errors[]? | "  - \(.path | tojson): \(.msg)"' >&2
        log_event "compose.validation_failed" "$VALIDATE_RESULT"
        exit 1
    fi
fi

COMP_NAME="$(echo "$COMP_JSON" | jq -r '.name // "unnamed"')"
NUM_STAGES="$(echo "$COMP_JSON" | jq '.chain | length')"
CYCLE_ID="${LOA_CYCLE_ID:-simstim-20260509-aead9136}"

log_event "compose.start" "$(jq -n --arg name "$COMP_NAME" --argjson stages "$NUM_STAGES" --arg mode "$MODE" --arg cycle "$CYCLE_ID" \
    '{composition: $name, stages: $stages, mode: $mode, cycle_id: $cycle}')"

[[ "$OUTPUT_JSON" == "1" ]] || echo "[compose-dispatch] Composition '$COMP_NAME' — $NUM_STAGES stages — mode=$MODE — run_id=$RUN_ID"

# -----------------------------------------------------------------------------
# Step 2: Iterate stages
# -----------------------------------------------------------------------------
PRIOR_HANDOFF_PATH=""
STAGES_DISPATCHED=0
PENDING_OPERATOR=0

for ((i=0; i<NUM_STAGES; i++)); do
    if [[ -n "$ONE_STAGE" ]] && [[ "$i" != "$ONE_STAGE" ]]; then
        continue
    fi

    STAGE_JSON="$(echo "$COMP_JSON" | jq ".chain[$i]")"
    STAGE_CONSTRUCT="$(echo "$STAGE_JSON" | jq -r '.construct')"
    STAGE_SKILL="$(echo "$STAGE_JSON" | jq -r '.skill // ""')"
    STAGE_PERSONA="$(echo "$STAGE_JSON" | jq -r '.persona // ""')"
    STAGE_READS="$(echo "$STAGE_JSON" | jq -c '.reads // []')"
    STAGE_WRITES="$(echo "$STAGE_JSON" | jq -c '.writes // []')"

    [[ "$OUTPUT_JSON" == "1" ]] || echo "[compose-dispatch] stage $i: construct-$STAGE_CONSTRUCT (skill=$STAGE_SKILL)"

    # Build room activation packet body
    ROOM_INPUTS="[]"
    if [[ -n "$PRIOR_HANDOFF_PATH" ]]; then
        # Echo prior handoff's output_refs as this stage's inputs
        ROOM_INPUTS="$(jq -c '.output_refs // []' "$PRIOR_HANDOFF_PATH" 2>/dev/null || echo "[]")"
    fi

    EXPECTED_OUTPUT="$(echo "$STAGE_WRITES" | jq -r '.[0] // "Verdict"')"

    ROOM_BODY="$(jq -n \
        --arg cycle_id "$CYCLE_ID" \
        --arg construct_slug "$STAGE_CONSTRUCT" \
        --arg persona "$STAGE_PERSONA" \
        --arg invocation_path "at_mention" \
        --argjson inputs "$ROOM_INPUTS" \
        --arg expected_output "$EXPECTED_OUTPUT" \
        --arg run_id "$RUN_ID" \
        --argjson stage_index "$i" \
        --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg created_by "compose-dispatch.sh" \
        '{
            cycle_id: $cycle_id,
            construct_slug: $construct_slug,
            persona: (if $persona == "" then null else $persona end),
            mode: "room",
            invocation_path: $invocation_path,
            inputs: $inputs,
            expected_output_type: $expected_output,
            expected_handoff_path: null,
            composition_run_id: $run_id,
            stage_index: $stage_index,
            forbidden_context: [],
            allowed_skills: [],
            created_at: $created_at,
            created_by: $created_by
        }')"

    # Compute room_id
    ROOM_ID="$(python3 -c "
import json, sys, hashlib, rfc8785
body = json.loads(sys.argv[1])
print('sha256:' + hashlib.sha256(rfc8785.dumps(body)).hexdigest())
" "$ROOM_BODY")"

    ROOM_PACKET="$(echo "$ROOM_BODY" | jq --arg id "$ROOM_ID" '. + {room_id: $id}')"
    ROOM_PATH="$ROOMS_DIR/${ROOM_ID#sha256:}.json"
    echo "$ROOM_PACKET" | jq . > "$ROOM_PATH"

    # Validate room packet
    if ! "$ROOM_VALIDATOR" "$ROOM_PATH" --json > /dev/null 2>&1; then
        echo "ERROR: stage $i room packet validation failed" >&2
        "$ROOM_VALIDATOR" "$ROOM_PATH" >&2 || true
        log_event "stage.room_packet_invalid" "$(jq -n --arg path "$ROOM_PATH" --argjson stage "$i" '{stage: $stage, packet: $path}')"
        exit 2
    fi

    log_event "stage_enter" "$(jq -n --argjson stage "$i" --arg construct "$STAGE_CONSTRUCT" --arg room_id "$ROOM_ID" --arg room_path "$ROOM_PATH" \
        '{stage: $stage, construct: $construct, room_id: $room_id, room_path: $room_path}')"

    HANDOFF_PATH="$ENVELOPES_DIR/$(printf '%02d' $i).$STAGE_CONSTRUCT.handoff.json"

    if [[ "$DRY_RUN" == "1" ]]; then
        [[ "$OUTPUT_JSON" == "1" ]] || echo "[compose-dispatch] DRY-RUN: stage $i would dispatch via $MODE; room packet at $ROOM_PATH"
        log_event "stage_dry_run" "$(jq -n --argjson stage "$i" '{stage: $stage}')"
        continue
    fi

    case "$MODE" in
        interactive)
            # Form A: write dispatch prompt for operator to paste
            PROMPT_PATH="$PROMPTS_DIR/stage-$i.prompt.md"
            skill_hint="${STAGE_SKILL:-construct default}"
            {
                echo "@agent-construct-$STAGE_CONSTRUCT please run a room invocation per this packet:"
                echo "- Room packet: $ROOM_PATH"
                echo "- Cycle: $CYCLE_ID"
                echo "- Composition run: $RUN_ID"
                echo "- Stage index: $i"
                echo "- Skill suggested: $skill_hint"
                echo "- Expected output type: $EXPECTED_OUTPUT"
                echo ""
                echo "Inputs echoed from prior stage output_refs (may be empty for stage 0):"
                echo '```json'
                echo "$ROOM_INPUTS"
                echo '```'
                echo ""
                echo "When you finish, write your handoff packet to:"
                echo "  $HANDOFF_PATH"
                echo ""
                echo "Required packet fields per FR-3.1: construct_slug, output_type, verdict, invocation_mode, cycle_id."
                echo "Recommended: persona, output_refs, evidence."
                echo "Schema: .claude/data/trajectory-schemas/construct-handoff.schema.json"
                echo ""
                echo "Return a one-line summary: stage $i complete <packet path>"
            } > "$PROMPT_PATH"
            [[ "$OUTPUT_JSON" == "1" ]] || cat <<EOF
[compose-dispatch] OPERATOR ACTION REQUIRED — stage $i Form A dispatch:
  $(cat "$PROMPT_PATH")

Once stage $i's subagent has written the handoff packet, re-run with:
  compose-dispatch.sh "$COMP_PATH" --run-id "$RUN_ID" --stage $((i+1))
EOF
            log_event "stage_dispatch_pending_operator" "$(jq -n --argjson stage "$i" --arg prompt "$PROMPT_PATH" --arg expected_handoff "$HANDOFF_PATH" \
                '{stage: $stage, prompt: $prompt, expected_handoff: $expected_handoff}')"
            PENDING_OPERATOR=1
            # Continue iterating to emit all stage prompts; don't exit yet
            ;;

        headless)
            # Form B: claude -p invocation. Sprint 4 completes this path; Sprint 2 stub:
            log_event "stage_dispatch_headless_stub" "$(jq -n --argjson stage "$i" '{stage: $stage, status: "sprint_4_completes_this"}')"
            [[ "$OUTPUT_JSON" == "1" ]] || echo "[compose-dispatch] WARN: headless dispatch is Sprint-4 stubbed; stage $i not actually executed"
            # In real implementation: claude -p with a similar prompt, then extract handoff packet from output
            ;;
    esac

    # Validate handoff packet (only if it exists — operator hasn't yet pasted/Sprint 4 hasn't run)
    if [[ -f "$HANDOFF_PATH" ]]; then
        if ! "$HANDOFF_VALIDATOR" "$HANDOFF_PATH" --json > /dev/null 2>&1; then
            echo "ERROR: stage $i handoff packet validation failed" >&2
            "$HANDOFF_VALIDATOR" "$HANDOFF_PATH" >&2 || true
            log_event "stage.handoff_invalid" "$(jq -n --argjson stage "$i" --arg path "$HANDOFF_PATH" '{stage: $stage, path: $path}')"
            exit 2
        fi
        log_event "stage_exit" "$(jq -n --argjson stage "$i" --arg construct "$STAGE_CONSTRUCT" --arg handoff "$HANDOFF_PATH" \
            '{stage: $stage, construct: $construct, handoff: $handoff}')"
        PRIOR_HANDOFF_PATH="$HANDOFF_PATH"
        STAGES_DISPATCHED=$((STAGES_DISPATCHED + 1))
    fi
done

if [[ "$PENDING_OPERATOR" == "1" ]]; then
    log_event "compose.awaiting_operator" "$(jq -n --argjson dispatched "$STAGES_DISPATCHED" --argjson total "$NUM_STAGES" '{dispatched: $dispatched, total: $total}')"
    if [[ "$OUTPUT_JSON" == "1" ]]; then
        jq -n --arg run_id "$RUN_ID" --argjson stages "$NUM_STAGES" --arg mode "$MODE" --argjson dispatched "$STAGES_DISPATCHED" \
            '{run_id: $run_id, mode: $mode, stages: $stages, awaiting_operator: true, dispatched: $dispatched, exit_code: 3}'
    fi
    exit 3
fi

log_event "compose.complete" "$(jq -n --argjson dispatched "$STAGES_DISPATCHED" --argjson total "$NUM_STAGES" '{dispatched: $dispatched, total: $total}')"

if [[ "$OUTPUT_JSON" == "1" ]]; then
    jq -n --arg run_id "$RUN_ID" --argjson stages "$NUM_STAGES" --arg mode "$MODE" --argjson dispatched "$STAGES_DISPATCHED" \
        '{run_id: $run_id, mode: $mode, stages: $stages, dispatched: $dispatched, exit_code: 0}'
else
    echo "[compose-dispatch] complete — $STAGES_DISPATCHED of $NUM_STAGES stages dispatched"
fi

exit 0
fi  # end PAIR_RELAY_FLOW==0 branch

# =============================================================================
# Pair-relay branch (cycle-craft-cluster Sprint 2 B.4 / RFC #235)
# =============================================================================
# Implements the RELAY_LOOP state machine from SDD §2.1.2:
#
#   INIT → COMPOSITION_VALIDATE → RELAY_LOOP → DONE
#                                  ↓
#                              per cycle:
#                                ROOM_ACTIVATE → DISPATCH
#                                → HANDOFF_VALIDATE → ENVELOPE_WRITE
#                                → ENVELOPE_SURFACE → next cycle
#
# Bookkeeping: <RUN_DIR>/relay-state.json tracks cycle_count, current_cycle,
# completed_cycles[], convergence_state.
# =============================================================================

# Resolve pair-relay schema path: substrate-canonical first, then host-installed.
if [[ -f "$PAIR_RELAY_SCHEMA_SUBSTRATE" ]]; then
    PAIR_RELAY_SCHEMA="$PAIR_RELAY_SCHEMA_SUBSTRATE"
elif [[ -f "$PAIR_RELAY_SCHEMA_HOST" ]]; then
    PAIR_RELAY_SCHEMA="$PAIR_RELAY_SCHEMA_HOST"
else
    echo "ERROR: pair-relay schema not found (tried $PAIR_RELAY_SCHEMA_SUBSTRATE, $PAIR_RELAY_SCHEMA_HOST)" >&2
    exit 1
fi

# Resolve surface-envelope: substrate-canonical first, then host-installed.
if [[ -x "$SURFACE_ENVELOPE_SUBSTRATE" ]]; then
    SURFACE_ENVELOPE="$SURFACE_ENVELOPE_SUBSTRATE"
elif [[ -x "$SURFACE_ENVELOPE_HOST" ]]; then
    SURFACE_ENVELOPE="$SURFACE_ENVELOPE_HOST"
else
    echo "ERROR: surface-envelope.sh not found (tried $SURFACE_ENVELOPE_SUBSTRATE, $SURFACE_ENVELOPE_HOST)" >&2
    exit 1
fi

# Schema validation against pair-relay schema.
PR_VALIDATE_RESULT="$(python3 - "$COMP_JSON" "$PAIR_RELAY_SCHEMA" <<'PYEOF'
import json, sys
try:
    import jsonschema
except ImportError:
    print(json.dumps({"ok": False, "reason": "jsonschema_not_installed"}))
    sys.exit(0)
comp = json.loads(sys.argv[1])
with open(sys.argv[2]) as f:
    schema = json.load(f)
validator = jsonschema.Draft202012Validator(schema)
errors = sorted(validator.iter_errors(comp), key=lambda e: list(e.absolute_path))
if errors:
    print(json.dumps({"ok": False, "errors": [{"path": list(e.absolute_path), "msg": e.message} for e in errors[:5]]}))
else:
    print(json.dumps({"ok": True}))
PYEOF
)"

if [[ "$(echo "$PR_VALIDATE_RESULT" | jq -r '.ok')" != "true" ]]; then
    echo "ERROR: pair-relay composition validation failed:" >&2
    echo "$PR_VALIDATE_RESULT" | jq -r '.errors[]? | "  - \(.path | tojson): \(.msg)"' >&2
    log_event "compose.pair_relay_validation_failed" "$PR_VALIDATE_RESULT"
    exit 1
fi

# Extract composition fields.
PR_ARTIFACT_NAME="$(echo "$COMP_JSON" | jq -r '.artifact_name')"
PR_SEQ_LEN="$(echo "$COMP_JSON" | jq '.sequence | length')"
PR_MAX_CYCLES="$(echo "$COMP_JSON" | jq -r '.max_cycles // 2')"
PR_SURFACE_MODE="$(echo "$COMP_JSON" | jq -r '.surface_mode')"
PR_DOMAIN="$(echo "$COMP_JSON" | jq -r '.domain // "<no-domain>"')"
PR_CYCLE_ID="${LOA_CYCLE_ID:-cycle-craft-cluster}"

# Cross-field semantic check (mirrors pair-relay-validate.sh exit-2 rule).
if [[ "$PR_MAX_CYCLES" -lt "$PR_SEQ_LEN" ]]; then
    echo "ERROR: max_cycles ($PR_MAX_CYCLES) < sequence.length ($PR_SEQ_LEN); at least one full walk must complete" >&2
    log_event "compose.pair_relay_max_cycles_too_low" "$(jq -n --argjson max "$PR_MAX_CYCLES" --argjson seq "$PR_SEQ_LEN" '{max_cycles: $max, sequence_length: $seq}')"
    exit 1
fi

# Pre-stage any --inject-handoff fixtures so the RELAY_LOOP picks them up at
# the expected paths. Used by bats integration tests. Two accepted formats:
#   <stage>:<path>            — shorthand, defaults to cycle 1
#   <cycle>:<stage>:<path>    — explicit cycle (1-indexed)
mkdir -p "$ENVELOPES_DIR"
for spec in "${INJECT_HANDOFFS[@]:-}"; do
    [[ -z "$spec" ]] && continue
    # Count colons to detect format.
    colons="${spec//[^:]/}"
    if [[ "${#colons}" -ge 2 ]]; then
        inj_cycle="${spec%%:*}"
        rest="${spec#*:}"
        inj_stage="${rest%%:*}"
        inj_path="${rest#*:}"
    else
        inj_cycle=1
        inj_stage="${spec%%:*}"
        inj_path="${spec#*:}"
    fi
    if [[ ! -f "$inj_path" ]]; then
        echo "ERROR: --inject-handoff fixture missing: $inj_path" >&2
        exit 1
    fi
    inj_construct="$(echo "$COMP_JSON" | jq -r ".sequence[$inj_stage].construct // empty")"
    if [[ -z "$inj_construct" ]]; then
        echo "ERROR: --inject-handoff stage $inj_stage out of range (sequence length $PR_SEQ_LEN)" >&2
        exit 1
    fi
    inj_target="$ENVELOPES_DIR/$(printf 'c%d.%02d' "$inj_cycle" "$inj_stage").$inj_construct.handoff.json"
    cp "$inj_path" "$inj_target"
done

log_event "compose.start" "$(jq -n --arg artifact "$PR_ARTIFACT_NAME" --argjson seq "$PR_SEQ_LEN" --argjson maxc "$PR_MAX_CYCLES" --arg mode "$PR_SURFACE_MODE" --arg domain "$PR_DOMAIN" \
    '{pattern: "pair-relay", artifact_name: $artifact, sequence_length: $seq, max_cycles: $maxc, surface_mode: $mode, domain: $domain}')"

[[ "$OUTPUT_JSON" == "1" ]] || echo "[compose-dispatch] pair-relay '$PR_ARTIFACT_NAME' — ${PR_SEQ_LEN}-stage sequence, up to ${PR_MAX_CYCLES} cycles, surface=$PR_SURFACE_MODE — run_id=$RUN_ID"

RELAY_STATE_PATH="$RUN_DIR/relay-state.json"
_write_relay_state() {
    local current_cycle="$1"
    local current_stage="$2"
    local completed_json="$3"
    local convergence_state="$4"
    jq -n \
        --arg run_id "$RUN_ID" \
        --arg artifact "$PR_ARTIFACT_NAME" \
        --argjson max_cycles "$PR_MAX_CYCLES" \
        --argjson seq_len "$PR_SEQ_LEN" \
        --argjson current_cycle "$current_cycle" \
        --argjson current_stage "$current_stage" \
        --argjson completed "$completed_json" \
        --arg convergence_state "$convergence_state" \
        --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{
            run_id: $run_id,
            pattern: "pair-relay",
            artifact_name: $artifact,
            max_cycles: $max_cycles,
            sequence_length: $seq_len,
            current_cycle: $current_cycle,
            current_stage: $current_stage,
            completed_cycles: $completed,
            convergence_state: $convergence_state,
            updated_at: $ts
        }' > "$RELAY_STATE_PATH"
}

COMPLETED_CYCLES_JSON='[]'
PR_CONVERGENCE_STATE="running"
PR_TOTAL_STAGES_DISPATCHED=0
PR_PENDING_OPERATOR=0
_write_relay_state 0 -1 "$COMPLETED_CYCLES_JSON" "$PR_CONVERGENCE_STATE"

for (( cycle=1; cycle<=PR_MAX_CYCLES; cycle++ )); do
    log_event "relay.cycle_start" "$(jq -n --argjson c "$cycle" '{cycle: $c}')"
    _write_relay_state "$cycle" 0 "$COMPLETED_CYCLES_JSON" "$PR_CONVERGENCE_STATE"

    CYCLE_STAGES_OK=0
    for (( s=0; s<PR_SEQ_LEN; s++ )); do
        STAGE_JSON="$(echo "$COMP_JSON" | jq ".sequence[$s]")"
        STAGE_CONSTRUCT="$(echo "$STAGE_JSON" | jq -r '.construct')"
        STAGE_ROLE="$(echo "$STAGE_JSON" | jq -r '.role')"
        STAGE_PERSONA="$(echo "$STAGE_JSON" | jq -r '.persona // ""')"

        _write_relay_state "$cycle" "$s" "$COMPLETED_CYCLES_JSON" "$PR_CONVERGENCE_STATE"

        HANDOFF_PATH="$ENVELOPES_DIR/$(printf 'c%d.%02d' "$cycle" "$s").$STAGE_CONSTRUCT.handoff.json"

        log_event "stage_enter" "$(jq -n --argjson c "$cycle" --argjson s "$s" --arg construct "$STAGE_CONSTRUCT" --arg role "$STAGE_ROLE" --arg expected "$HANDOFF_PATH" \
            '{cycle: $c, stage: $s, construct: $construct, role: $role, expected_handoff: $expected}')"

        if [[ "$DRY_RUN" == "1" ]]; then
            log_event "stage_dry_run" "$(jq -n --argjson c "$cycle" --argjson s "$s" '{cycle: $c, stage: $s}')"
            continue
        fi

        # If a handoff is already at the expected path (e.g. injected via
        # --inject-handoff for tests, or written by a prior interactive paste),
        # validate it and proceed. Otherwise emit a dispatch prompt and mark
        # pending-operator.
        if [[ ! -f "$HANDOFF_PATH" ]]; then
            # In test/headless mode without injection, the relay can't proceed
            # past a stage that lacks a handoff packet. Emit a prompt for
            # operator paste (interactive mode) or a stub log (headless).
            case "$MODE" in
                interactive)
                    PROMPT_PATH="$PROMPTS_DIR/cycle$cycle-stage$s.prompt.md"
                    {
                        echo "@agent-construct-$STAGE_CONSTRUCT please run a relay invocation per this stage:"
                        echo "- Cycle: $cycle of $PR_MAX_CYCLES"
                        echo "- Stage: $s ($STAGE_ROLE)"
                        echo "- Composition run: $RUN_ID"
                        echo "- Persona: ${STAGE_PERSONA:-<none>}"
                        echo ""
                        echo "Write your handoff packet to: $HANDOFF_PATH"
                    } > "$PROMPT_PATH"
                    log_event "stage_dispatch_pending_operator" "$(jq -n --argjson c "$cycle" --argjson s "$s" --arg prompt "$PROMPT_PATH" '{cycle: $c, stage: $s, prompt: $prompt}')"
                    PR_PENDING_OPERATOR=1
                    ;;
                headless)
                    log_event "stage_dispatch_headless_stub" "$(jq -n --argjson c "$cycle" --argjson s "$s" '{cycle: $c, stage: $s, status: "sprint_4_completes_this"}')"
                    ;;
            esac
            # Without a real handoff packet, the relay cannot advance further
            # in this cycle. Persist state and exit with pending-operator code.
            _write_relay_state "$cycle" "$s" "$COMPLETED_CYCLES_JSON" "blocked-on-stage"
            if [[ "$PR_PENDING_OPERATOR" == "1" ]]; then
                if [[ "$OUTPUT_JSON" == "1" ]]; then
                    jq -n --arg run_id "$RUN_ID" --argjson cycle "$cycle" --argjson stage "$s" \
                        '{run_id: $run_id, pattern: "pair-relay", cycle: $cycle, stage: $stage, awaiting_operator: true, exit_code: 3}'
                fi
                exit 3
            fi
            # Headless without a handoff in Sprint 2: cannot complete this cycle;
            # log and skip remaining stages of this cycle.
            break
        fi

        # Validate the packet at HANDOFF_PATH. If the host validator is missing
        # (substrate-standalone test environment), accept any valid JSON object.
        if [[ -x "$HANDOFF_VALIDATOR" ]]; then
            if ! "$HANDOFF_VALIDATOR" "$HANDOFF_PATH" --json > /dev/null 2>&1; then
                echo "ERROR: cycle $cycle stage $s handoff packet validation failed" >&2
                "$HANDOFF_VALIDATOR" "$HANDOFF_PATH" >&2 || true
                log_event "stage.handoff_invalid" "$(jq -n --argjson c "$cycle" --argjson s "$s" --arg path "$HANDOFF_PATH" '{cycle: $c, stage: $s, path: $path}')"
                _write_relay_state "$cycle" "$s" "$COMPLETED_CYCLES_JSON" "handoff-invalid"
                exit 2
            fi
        else
            if ! jq -e 'type == "object"' "$HANDOFF_PATH" >/dev/null 2>&1; then
                echo "ERROR: cycle $cycle stage $s handoff packet is not a JSON object" >&2
                exit 2
            fi
        fi

        log_event "stage_exit" "$(jq -n --argjson c "$cycle" --argjson s "$s" --arg construct "$STAGE_CONSTRUCT" --arg handoff "$HANDOFF_PATH" \
            '{cycle: $c, stage: $s, construct: $construct, handoff: $handoff}')"

        # Surface the envelope according to the composition's surface_mode.
        # Bats tests pass surface_mode=silent or =summary so the FIFO branch
        # doesn't block. Interactive surface_mode is exercised by the
        # surface-envelope.bats suite directly.
        if ! "$SURFACE_ENVELOPE" "$HANDOFF_PATH" --run-dir "$RUN_DIR" --cycle "$cycle" --mode "$PR_SURFACE_MODE" 2>/dev/null; then
            envelope_exit=$?
            log_event "envelope.surface_failed" "$(jq -n --argjson c "$cycle" --argjson s "$s" --argjson ec "$envelope_exit" '{cycle: $c, stage: $s, exit_code: $ec}')"
            # Surfacing failures (timeout = exit 2) are NOT fatal to the relay
            # itself; they just mean the operator didn't respond. Continue.
        fi

        CYCLE_STAGES_OK=$((CYCLE_STAGES_OK + 1))
        PR_TOTAL_STAGES_DISPATCHED=$((PR_TOTAL_STAGES_DISPATCHED + 1))
    done

    if [[ "$CYCLE_STAGES_OK" -eq "$PR_SEQ_LEN" ]]; then
        COMPLETED_CYCLES_JSON="$(echo "$COMPLETED_CYCLES_JSON" | jq --argjson c "$cycle" '. + [$c]')"
        log_event "relay.cycle_complete" "$(jq -n --argjson c "$cycle" --argjson stages_ok "$CYCLE_STAGES_OK" '{cycle: $c, stages_completed: $stages_ok}')"
    else
        log_event "relay.cycle_incomplete" "$(jq -n --argjson c "$cycle" --argjson stages_ok "$CYCLE_STAGES_OK" '{cycle: $c, stages_completed: $stages_ok}')"
        # Without a way to satisfy the remaining stages (no handoffs available),
        # break out of the cycle loop entirely.
        PR_CONVERGENCE_STATE="halted-no-handoff"
        break
    fi

    _write_relay_state "$cycle" $((PR_SEQ_LEN - 1)) "$COMPLETED_CYCLES_JSON" "$PR_CONVERGENCE_STATE"
done

# Terminal state.
if [[ "$PR_CONVERGENCE_STATE" == "running" ]]; then
    PR_CONVERGENCE_STATE="completed-max-cycles"
fi
_write_relay_state "$PR_MAX_CYCLES" $((PR_SEQ_LEN - 1)) "$COMPLETED_CYCLES_JSON" "$PR_CONVERGENCE_STATE"

log_event "compose.complete" "$(jq -n --argjson dispatched "$PR_TOTAL_STAGES_DISPATCHED" --argjson cycles "$(echo "$COMPLETED_CYCLES_JSON" | jq 'length')" --arg state "$PR_CONVERGENCE_STATE" '{pattern: "pair-relay", stages_dispatched: $dispatched, cycles_completed: $cycles, convergence_state: $state}')"

if [[ "$OUTPUT_JSON" == "1" ]]; then
    jq -n --arg run_id "$RUN_ID" --arg artifact "$PR_ARTIFACT_NAME" \
        --argjson max_cycles "$PR_MAX_CYCLES" --argjson seq_len "$PR_SEQ_LEN" \
        --argjson dispatched "$PR_TOTAL_STAGES_DISPATCHED" \
        --argjson completed "$COMPLETED_CYCLES_JSON" \
        --arg state "$PR_CONVERGENCE_STATE" \
        '{run_id: $run_id, pattern: "pair-relay", artifact_name: $artifact, max_cycles: $max_cycles, sequence_length: $seq_len, stages_dispatched: $dispatched, completed_cycles: $completed, convergence_state: $state, exit_code: 0}'
else
    echo "[compose-dispatch] pair-relay complete — $PR_TOTAL_STAGES_DISPATCHED stages across $(echo "$COMPLETED_CYCLES_JSON" | jq 'length') cycles — state=$PR_CONVERGENCE_STATE"
fi

exit 0
exit 0
