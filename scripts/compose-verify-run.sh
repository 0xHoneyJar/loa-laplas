#!/usr/bin/env bash
# =============================================================================
# compose-verify-run.sh — proof-of-run gate (the FIRST tooth).
# =============================================================================
# A composition is SUPPOSED to run through the Form C runtime:
# `compose-dispatch.sh --form-c` compiles it into
# `.run/compose/<run_id>/{form-c-manifest.json, workflows/*.workflow.js,
# orchestrator.jsonl}`, and when the main loop executes each segment via the
# Workflow tool + `compose-handoff-wrap.sh`, validated handoff ENVELOPES are
# written to `.run/compose/<run_id>/envelopes/`.
#
# The failure mode this guards: an agent can SKIP all of that and ROLE-PLAY the
# composition inline — emitting composition-looking prose with NO runtime
# provenance. This script distinguishes a real governed run from an inline fake:
# inline-approximation leaves no manifest / no segment / no orchestrator trail,
# so it FAILS the gate. A real run leaves a self-consistent provenance trail, so
# it PASSES.
#
# READ-ONLY + ADDITIVE: this script reads the run dir and never mutates any
# existing artifact or changes any existing dispatch/emit behavior.
#
# What it verifies (all locally checkable in construct-rooms-substrate):
#   1. MANIFEST — `.run/compose/<run_id>/form-c-manifest.json` exists, parses,
#      and its `run_id` matches the argument (a forged/copied manifest with a
#      mismatched run_id is rejected).
#   2. SEGMENTS — every segment workflow file the manifest references resolves
#      on disk (checked as `workflows/<basename>` RELATIVE to the run dir, so a
#      moved/copied run dir is still verifiable despite the absolute path baked
#      into the manifest at emit time).
#   3. ORCHESTRATOR — `orchestrator.jsonl` exists, parses line-by-line, and
#      records THIS run (every line's `run_id` matches; the `form_c.manifest`
#      event is present — i.e. the compiler actually reached the manifest step).
#   4. ENVELOPES (only if any segment executed) — every envelope in
#      `envelopes/` is valid JSON, passes the existing `handoff-validate.sh`
#      gate, carries `composition_run_id == <run_id>`, has a `stage_index` that
#      belongs to a manifest segment, and is content-addressable: its id is
#      recomputed via the EXISTING hash core (`construct-handoff-lib.sh
#      compute-id`), never reinvented here. The per-envelope ids are folded (in
#      stage order) into an `envelope_digest` a downstream consumer can pin.
#
# NOT a hash CHAIN in this repo: the construct-rooms-substrate Form C handoff
# format (`construct-handoff.schema.json`, additionalProperties:false) carries
# NO inter-envelope `prev_hash`/self-`hash` chain fields — that chain core lives
# in loa-constructs (`audit_envelope.py` / `construct-handoff-v0.schema.json`)
# and is NOT present/callable here. So this verifier checks the integrity that
# IS locally provable (content-addressable per-envelope id + set linkage), and
# does NOT fabricate a `prev_hash` chain against a format that lacks one. When
# the v0 chained envelope format lands here, extend check 4 with
# audit_verify_chain.
#
# Usage:
#   compose-verify-run.sh <run_id> [--json] [--base-dir DIR]
#
# Exit codes:
#   0  valid governed run — proof-of-run holds
#   2  NOT a real run — no manifest / no emit dir (inline-fake or fabricated id)
#   3  broken / forged run — manifest, segments, orchestrator, or an envelope is
#      missing, unparseable, or internally inconsistent
#   1  usage error
#
# --json verdict (machine-gateable):
#   {"verdict":"valid_run"|"not_a_run"|"broken_run", "run_id":..., "reason":...,
#    "checks":{manifest,segments_present,orchestrator,envelopes},
#    "segment_count":N, "envelope_count":N, "envelope_digest":"sha256:..."|null}
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# PROJECT_ROOT resolution mirrors compose-dispatch.sh exactly: LOA_PROJECT_ROOT
# override, else one dir above the substrate (the installed <project>/ layout).
if [[ -n "${LOA_PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$LOA_PROJECT_ROOT"
else
    PROJECT_ROOT="$(cd "$SUBSTRATE_ROOT/.." && pwd)"
fi

# Reusable cores (host install first, substrate fallback) — never reinvented.
HANDOFF_VALIDATOR="$PROJECT_ROOT/.claude/scripts/handoff-validate.sh"
[[ -x "$HANDOFF_VALIDATOR" ]] || HANDOFF_VALIDATOR="$SUBSTRATE_ROOT/scripts/handoff-validate.sh"
HANDOFF_LIB="$PROJECT_ROOT/.claude/scripts/lib/construct-handoff-lib.sh"
[[ -f "$HANDOFF_LIB" ]] || HANDOFF_LIB="$SUBSTRATE_ROOT/scripts/lib/construct-handoff-lib.sh"
# Handoff schema (mirrors compose-handoff-wrap.sh resolution: host first, then
# substrate-canonical). The substrate-standalone validator can't self-resolve the
# schema from its own SCRIPT_DIR, so we pass it explicitly via --schema.
HANDOFF_SCHEMA=""
if [[ -f "$PROJECT_ROOT/.claude/data/trajectory-schemas/construct-handoff.schema.json" ]]; then
    HANDOFF_SCHEMA="$PROJECT_ROOT/.claude/data/trajectory-schemas/construct-handoff.schema.json"
elif [[ -f "$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json" ]]; then
    HANDOFF_SCHEMA="$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json"
fi
if [[ -z "${LOA_COMPOSE_BASE_DIR:-}" ]]; then
    BASE_DIR="$PROJECT_ROOT/.run/compose"
else
    BASE_DIR="$LOA_COMPOSE_BASE_DIR"
fi

usage() {
    cat <<EOF
Usage: compose-verify-run.sh <run_id> [options]

Verify that <run_id> is a real governed Form C composition run (proof-of-run),
not an inline-approximated fake. READ-ONLY.

Options:
  --json            Emit a structured verdict on stdout (gateable).
  --base-dir DIR    Override the compose run base dir (default: <root>/.run/compose).
  -h, --help        Show this help.

Exit codes:
  0  valid_run    — proof-of-run holds
  2  not_a_run    — no manifest / no emit dir (inline-fake or fabricated id)
  3  broken_run   — present but missing/forged/inconsistent provenance
  1  usage error
EOF
}

RUN_ID=""
OUTPUT_JSON=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) OUTPUT_JSON=1; shift ;;
        --base-dir) BASE_DIR="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "ERROR: unknown flag '$1'" >&2; usage >&2; exit 1 ;;
        *) if [[ -z "$RUN_ID" ]]; then RUN_ID="$1"; else echo "ERROR: extra arg '$1'" >&2; exit 1; fi; shift ;;
    esac
done

if [[ -z "$RUN_ID" ]]; then
    echo "ERROR: run_id required" >&2
    usage >&2
    exit 1
fi

RUN_DIR="$BASE_DIR/$RUN_ID"
MANIFEST="$RUN_DIR/form-c-manifest.json"
ORCHESTRATOR="$RUN_DIR/orchestrator.jsonl"
ENVELOPES_DIR="$RUN_DIR/envelopes"

# Track which checks have passed for the structured verdict.
CHK_MANIFEST=false
CHK_SEGMENTS=false
CHK_ORCH=false
CHK_ENVELOPES=false
SEGMENT_COUNT=0
ENVELOPE_COUNT=0
ENVELOPE_DIGEST=""

# Emit the verdict + exit. $1=verdict $2=exit_code $3=reason
_verdict() {
    local verdict="$1" code="$2" reason="$3"
    if [[ "$OUTPUT_JSON" == "1" ]]; then
        jq -n \
            --arg verdict "$verdict" \
            --arg run_id "$RUN_ID" \
            --arg reason "$reason" \
            --argjson manifest "$CHK_MANIFEST" \
            --argjson segments "$CHK_SEGMENTS" \
            --argjson orch "$CHK_ORCH" \
            --argjson envelopes "$CHK_ENVELOPES" \
            --argjson seg_count "$SEGMENT_COUNT" \
            --argjson env_count "$ENVELOPE_COUNT" \
            --arg env_digest "$ENVELOPE_DIGEST" \
            '{
                verdict: $verdict,
                run_id: $run_id,
                reason: $reason,
                checks: {
                    manifest: $manifest,
                    segments_present: $segments,
                    orchestrator: $orch,
                    envelopes: $envelopes
                },
                segment_count: $seg_count,
                envelope_count: $env_count,
                envelope_digest: (if $env_digest == "" then null else $env_digest end)
            }'
    else
        if [[ "$code" -eq 0 ]]; then
            echo "[compose-verify-run] $RUN_ID — VALID governed run ($reason)"
        else
            echo "[compose-verify-run] $RUN_ID — $verdict: $reason" >&2
        fi
    fi
    exit "$code"
}

# -----------------------------------------------------------------------------
# Check 1: MANIFEST exists, parses, run_id matches.
# Absent manifest / absent emit dir == NOT a run (inline-fake leaves nothing).
# -----------------------------------------------------------------------------
if [[ ! -d "$RUN_DIR" ]]; then
    _verdict "not_a_run" 2 "no emit dir for run_id '$RUN_ID' (no manifest — inline-approximated or fabricated run_id)"
fi
if [[ ! -f "$MANIFEST" ]]; then
    _verdict "not_a_run" 2 "no manifest for run_id '$RUN_ID' (form-c-manifest.json absent — no runtime provenance)"
fi
if ! jq -e 'type == "object"' "$MANIFEST" >/dev/null 2>&1; then
    _verdict "broken_run" 3 "manifest does not parse as a JSON object (corrupt: cannot prove run)"
fi
MANIFEST_RUN_ID="$(jq -r '.run_id // ""' "$MANIFEST")"
if [[ "$MANIFEST_RUN_ID" != "$RUN_ID" ]]; then
    _verdict "broken_run" 3 "manifest run_id '$MANIFEST_RUN_ID' != requested run_id '$RUN_ID' (forged/copied manifest)"
fi
CHK_MANIFEST=true

# -----------------------------------------------------------------------------
# Check 2: every manifest segment's workflow file resolves on disk.
# The manifest bakes an ABSOLUTE workflow_file at emit time; we resolve it
# relative to THIS run dir (workflows/<basename>) so a moved run dir still
# verifies. A composition with zero segments is impossible for a valid emit.
# -----------------------------------------------------------------------------
SEGMENT_COUNT="$(jq '.segments | length' "$MANIFEST" 2>/dev/null || echo 0)"
if [[ "$SEGMENT_COUNT" -lt 1 ]]; then
    _verdict "broken_run" 3 "manifest declares 0 segments (a valid Form C run emits >=1 segment)"
fi
missing_seg=""
while IFS= read -r wf; do
    [[ -z "$wf" ]] && { missing_seg="<null workflow_file in manifest>"; break; }
    base="$(basename "$wf")"
    resolved="$RUN_DIR/workflows/$base"
    if [[ ! -f "$resolved" ]]; then
        missing_seg="$base"
        break
    fi
done < <(jq -r '.segments[].workflow_file // ""' "$MANIFEST")
if [[ -n "$missing_seg" ]]; then
    _verdict "broken_run" 3 "segment workflow file missing on disk: $missing_seg (run dir does not contain the emitted segment)"
fi
CHK_SEGMENTS=true

# Collect the set of valid stage_indexes from the manifest (for envelope check).
MANIFEST_STAGES="$(jq -r '[.segments[].stages[]?.stage] | unique | .[]' "$MANIFEST" 2>/dev/null || true)"

# -----------------------------------------------------------------------------
# Check 3: orchestrator.jsonl exists, parses, records THIS run.
# Every line must be valid JSON whose run_id matches; the form_c.manifest event
# must be present (proves the compiler actually reached the manifest step — a
# trail that stops earlier is an incomplete/aborted run).
# -----------------------------------------------------------------------------
if [[ ! -f "$ORCHESTRATOR" ]]; then
    _verdict "broken_run" 3 "orchestrator.jsonl absent (no run trail — cannot prove the runtime drove this run)"
fi
if [[ ! -s "$ORCHESTRATOR" ]]; then
    _verdict "broken_run" 3 "orchestrator.jsonl is empty (no recorded events)"
fi
orch_problem=""
saw_manifest_event=false
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if ! printf '%s' "$line" | jq -e 'type == "object"' >/dev/null 2>&1; then
        orch_problem="orchestrator line does not parse as JSON"
        break
    fi
    line_run="$(printf '%s' "$line" | jq -r '.run_id // ""')"
    if [[ "$line_run" != "$RUN_ID" ]]; then
        orch_problem="orchestrator event run_id '$line_run' != '$RUN_ID' (trail belongs to a different run)"
        break
    fi
    ev="$(printf '%s' "$line" | jq -r '.event // ""')"
    [[ "$ev" == "form_c.manifest" ]] && saw_manifest_event=true
done < "$ORCHESTRATOR"
if [[ -n "$orch_problem" ]]; then
    _verdict "broken_run" 3 "$orch_problem"
fi
if [[ "$saw_manifest_event" != "true" ]]; then
    _verdict "broken_run" 3 "orchestrator trail never recorded form_c.manifest (incomplete/aborted run — never reached the manifest step)"
fi
CHK_ORCH=true

# -----------------------------------------------------------------------------
# Check 4: handoff ENVELOPES (only present if segments were executed).
# For each envelope: valid JSON · passes handoff-validate.sh · composition_run_id
# == run_id · stage_index belongs to a manifest segment · content-addressable id
# recomputes via the existing hash core. Fold the ids (stage order) → digest.
# If there are NO envelopes, the run is a valid COMPILED run (segments not yet
# executed) — that is not a failure; envelopes just stay unchecked.
# -----------------------------------------------------------------------------
declare -a ENV_FILES=()
if [[ -d "$ENVELOPES_DIR" ]]; then
    while IFS= read -r f; do
        [[ -n "$f" ]] && ENV_FILES+=("$f")
    done < <(find "$ENVELOPES_DIR" -maxdepth 1 -type f -name '*.handoff.json' | LC_ALL=C sort)
fi
ENVELOPE_COUNT=${#ENV_FILES[@]}

if [[ "$ENVELOPE_COUNT" -gt 0 ]]; then
    # Build a stage-ordered list of "stage_index<TAB>id" lines for the digest.
    digest_lines=""
    for env in "${ENV_FILES[@]}"; do
        bn="$(basename "$env")"
        # JSON parse.
        if ! jq -e 'type == "object"' "$env" >/dev/null 2>&1; then
            _verdict "broken_run" 3 "handoff envelope does not parse as JSON: $bn (corrupt — cannot prove the executed handoff)"
        fi
        # Schema/required-field gate (reuse the canonical validator; exit 1 = FAIL).
        if [[ -x "$HANDOFF_VALIDATOR" ]]; then
            schema_arg=()
            [[ -n "$HANDOFF_SCHEMA" ]] && schema_arg=(--schema "$HANDOFF_SCHEMA")
            set +e
            "$HANDOFF_VALIDATOR" "$env" "${schema_arg[@]}" --json >/dev/null 2>&1
            vrc=$?
            set -e
            if [[ "$vrc" -eq 1 ]]; then
                _verdict "broken_run" 3 "handoff envelope failed validation (required field/schema): $bn"
            fi
        fi
        # composition_run_id linkage.
        env_run="$(jq -r '.composition_run_id // ""' "$env")"
        if [[ "$env_run" != "$RUN_ID" ]]; then
            _verdict "broken_run" 3 "handoff envelope composition_run_id '$env_run' != run_id '$RUN_ID': $bn (envelope does not belong to this run)"
        fi
        # stage_index must belong to a manifest segment (when both sides declare stages).
        env_stage="$(jq -r '.stage_index // ""' "$env")"
        if [[ -n "$env_stage" && "$env_stage" != "null" && -n "$MANIFEST_STAGES" ]]; then
            if ! grep -qx "$env_stage" <<< "$MANIFEST_STAGES"; then
                _verdict "broken_run" 3 "handoff envelope stage_index '$env_stage' not in any manifest segment: $bn (envelope for an unknown stage)"
            fi
        fi
        # Content-addressable id via the EXISTING core (never reinvented).
        if [[ -f "$HANDOFF_LIB" ]]; then
            set +e
            env_id="$(bash "$HANDOFF_LIB" compute-id "$env" 2>/dev/null)"
            idrc=$?
            set -e
            if [[ "$idrc" -ne 0 || -z "$env_id" ]]; then
                _verdict "broken_run" 3 "could not compute content-addressable id for envelope: $bn (integrity uncheckable)"
            fi
        else
            env_id="sha256:$(jq -cS . "$env" | shasum -a 256 | awk '{print $1}')"
        fi
        sort_key="${env_stage:-0}"
        digest_lines+="${sort_key}	${env_id}"$'\n'
    done
    # Fold the per-envelope ids (stage-ordered) into a single set digest a
    # downstream consumer can pin. This is a content-addressable SET digest, NOT
    # an inter-envelope prev_hash chain (this repo's envelope format has none).
    ENVELOPE_DIGEST="sha256:$(printf '%s' "$digest_lines" | LC_ALL=C sort -n | shasum -a 256 | awk '{print $1}')"
    CHK_ENVELOPES=true
fi

# -----------------------------------------------------------------------------
# All checks passed.
# -----------------------------------------------------------------------------
if [[ "$ENVELOPE_COUNT" -gt 0 ]]; then
    _verdict "valid_run" 0 "manifest + $SEGMENT_COUNT segment(s) + orchestrator trail + $ENVELOPE_COUNT executed handoff envelope(s) verified"
else
    _verdict "valid_run" 0 "manifest + $SEGMENT_COUNT segment(s) + orchestrator trail verified (compiled run; segments not yet executed)"
fi
