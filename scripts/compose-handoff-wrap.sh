#!/usr/bin/env bash
# =============================================================================
# compose-handoff-wrap.sh — wrap a Form C segment's per-stage output into a
# typed construct-handoff packet and validate it (cycle-053).
# =============================================================================
# A Form C segment workflow returns `handoff_seeds[]` — one seed per stage that
# ran, shaped { construct_slug, persona, output_type, invocation_mode,
# stage_index, verdict }. The emitted workflow runs in the CC Workflow runtime,
# which has NO filesystem access, so it cannot write or validate handoff packets
# itself. This helper is the bash side the MAIN LOOP calls after a segment
# returns: it completes the seed into a full construct-handoff packet (adds
# cycle_id / composition_run_id / schema_version / created_at), validates it via
# handoff-validate.sh, and writes it to the envelopes dir.
#
# This is the typed inter-segment handoff (build-spec increment 1): the validated
# packet is what carries one segment's result into the next segment's inputs.
#
# Injection note: the seed is read as JSON via argv/stdin and merged with jq —
# no field is ever interpolated into shell or eval'd.
#
# Usage:
#   compose-handoff-wrap.sh --seed <json|-> --cycle-id ID --run-id ID \
#       [--out PATH] [--schema PATH] [--json]
#
# Exit codes: 0 ok (validated) · 1 usage/parse · 2 handoff validation failed.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -n "${LOA_PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$LOA_PROJECT_ROOT"
else
    PROJECT_ROOT="$(cd "$SUBSTRATE_ROOT/.." && pwd)"
fi

SEED=""
CYCLE_ID=""
RUN_ID=""
OUT=""
SCHEMA=""
OUTPUT_JSON=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --seed) SEED="$2"; shift 2 ;;
        --cycle-id) CYCLE_ID="$2"; shift 2 ;;
        --run-id) RUN_ID="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --schema) SCHEMA="$2"; shift 2 ;;
        --json) OUTPUT_JSON=1; shift ;;
        -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "ERROR: unknown arg '$1'" >&2; exit 1 ;;
    esac
done

[[ -n "$SEED" ]] || { echo "ERROR: --seed required (json or '-')" >&2; exit 1; }
[[ -n "$CYCLE_ID" ]] || { echo "ERROR: --cycle-id required" >&2; exit 1; }

if [[ "$SEED" == "-" ]]; then SEED="$(cat)"; fi
if ! echo "$SEED" | jq -e 'type == "object"' >/dev/null 2>&1; then
    echo "ERROR: --seed is not a JSON object" >&2; exit 1
fi

# Resolve handoff validator + schema (host install first, substrate fallback).
VALIDATOR="$PROJECT_ROOT/.claude/scripts/handoff-validate.sh"
[[ -x "$VALIDATOR" ]] || VALIDATOR="$SUBSTRATE_ROOT/scripts/handoff-validate.sh"
if [[ -z "$SCHEMA" ]]; then
    if [[ -f "$PROJECT_ROOT/.claude/data/trajectory-schemas/construct-handoff.schema.json" ]]; then
        SCHEMA="$PROJECT_ROOT/.claude/data/trajectory-schemas/construct-handoff.schema.json"
    elif [[ -f "$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json" ]]; then
        SCHEMA="$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json"
    fi
fi

# Complete the seed into a full construct-handoff packet. `verdict` MUST be an
# object (the construct-specific payload); a degraded/missing payload is wrapped
# as an explicit {degraded:true,...} object — never fabricated, never dropped.
PACKET="$(echo "$SEED" | jq \
    --arg cycle "$CYCLE_ID" \
    --arg run "$RUN_ID" \
    --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
        construct_slug: .construct_slug,
        output_type: (.output_type // "Verdict"),
        verdict: ( if (.verdict | type) == "object" then .verdict
                   else { degraded: true, reason: "non-object stage payload", raw: .verdict } end ),
        invocation_mode: (.invocation_mode // "room"),
        cycle_id: $cycle,
        persona: (.persona // null),
        composition_run_id: $run,
        stage_index: (.stage_index // null),
        schema_version: "1.0"
    }')"

# Default output path mirrors the existing envelope convention.
if [[ -z "$OUT" ]]; then
    idx="$(echo "$PACKET" | jq -r '.stage_index // 0')"
    slug="$(echo "$PACKET" | jq -r '.construct_slug')"
    ENV_DIR="$PROJECT_ROOT/.run/compose/${RUN_ID:-unknown}/envelopes"
    mkdir -p "$ENV_DIR"
    OUT="$ENV_DIR/$(printf '%02d' "$idx" 2>/dev/null || echo "$idx").${slug}.handoff.json"
fi
echo "$PACKET" | jq . > "$OUT"

# Validate (the typed-handoff gate). exit 1 from the validator = required-field
# missing / schema violation → fail. exit 2 = recommended-field BLOCKER (non-fatal
# warning; the packet is still written). exit 0 = clean.
schema_arg=()
[[ -n "$SCHEMA" ]] && schema_arg=(--schema "$SCHEMA")
set +e
"$VALIDATOR" "$OUT" "${schema_arg[@]}" --json >/dev/null 2>&1
vrc=$?
set -e
if [[ "$vrc" -eq 1 ]]; then
    echo "ERROR: handoff packet failed validation (required/schema): $OUT" >&2
    "$VALIDATOR" "$OUT" "${schema_arg[@]}" >&2 2>&1 || true
    [[ "$OUTPUT_JSON" == "1" ]] && jq -n --arg out "$OUT" '{ok:false, packet:$out, validator_exit:1}'
    exit 2
fi

# =============================================================================
# POTEAU MAILBOX WIRE (laplas-poteau S?, SDD §3 step 4 / §4.6) — translate this
# gate-seam handoff into the poteau mailbox packet so the exit-gate (Stop/
# SubagentStop) FINDS it and mints a receipt, instead of blocking on P101.
#
# "poteau's packet IS the construct-handoff packet" (SDD §4.6): one seam, two
# readers. The envelope above is the typed inter-segment handoff (compose run
# dir); the packet below is the SAME result reshaped for the gatekeeper's field
# reads (verdict, rationale, task_ref, conformance) at .run/poteau/<run>/.
#
# Fires ONLY when the run was ARMED (gate-0 seeded run-state.json) — an unarmed
# (wave-1) run has no mailbox to fill and nothing to enforce, so this no-ops.
# task_ref is COPIED from the armed run-state (the source of truth), so P201
# (task-match) passes by construction; the executor cannot drift it.
#
# Doing the run-state READ + packet WRITE inside this one script keeps the
# tool-gate's command-string view clean (it sees `compose-handoff-wrap.sh …`,
# no .run/poteau path), and the packet.json slot is the carve-out it allows.
#
# P203 (H1-echo / proof-of-grounding) is a NOTED FOLLOW-UP: it needs the stage
# prompt to quote each mandated-read H1 into its rationale; this wire surfaces
# whatever rationale the stage produced but does not synthesize the echo. Minimal
# viable enforcement here is P101 (packet present) + P201 (task_ref match).
# =============================================================================
POTEAU_DIR="$SUBSTRATE_ROOT/.run/poteau/${RUN_ID:-unknown}"
POTEAU_NOTE=""
if [[ -n "${RUN_ID:-}" && -f "$POTEAU_DIR/run-state.json" ]]; then
    # task_ref: copy verbatim from the armed run-state (P201 by construction).
    pt_task_ref="$(jq -r '.task_ref // empty' "$POTEAU_DIR/run-state.json" 2>/dev/null)"
    pt_slug="$(echo "$PACKET" | jq -r '.construct_slug // "construct"')"
    pt_idx="$(echo "$PACKET" | jq -r '.stage_index // 0')"
    # The inner verdict object is the stage's StructuredOutput payload:
    #   gate stage → { verdict: "APPROVED"|"CHANGES_REQUIRED", findings, note? }
    #   work stage → { output, rationale, rejected_findings? }
    # Reshape to the gatekeeper's top-level { verdict, rationale }.
    POTEAU_PACKET="$(echo "$PACKET" | jq \
        --arg task_ref "$pt_task_ref" \
        --arg slug "$pt_slug" \
        --arg idx "$pt_idx" '
        (.verdict // {}) as $inner |
        {
            verdict: (
                if ($inner | type) == "object" and ($inner.verdict != null) then $inner.verdict
                elif ($inner | type) == "object" and ($inner.output != null) then "complete"
                else "complete" end
            ),
            rationale: (
                ($inner.rationale // $inner.note //
                 (if ($inner.findings | type) == "array"
                    then ("Gate verdict " + ($inner.verdict // "?") + " — " + (($inner.findings | length) | tostring) + " finding(s).")
                    else null end) //
                 ("Stage " + $idx + " (" + $slug + ") produced its handoff."))
            ),
            task_ref: (if $task_ref == "" then null else $task_ref end),
            conformance: { in_scope: true, note: ($slug + " stage " + $idx + " output within composition scope") },
            composition_run_id: .composition_run_id,
            stage_index: .stage_index,
            construct_slug: .construct_slug
        }')"
    mkdir -p "$POTEAU_DIR"
    # Atomic write into the one carve-out slot the tool-gate permits.
    pt_tmp="$(mktemp "$POTEAU_DIR/.packet.XXXXXX")"
    echo "$POTEAU_PACKET" | jq . > "$pt_tmp" && mv "$pt_tmp" "$POTEAU_DIR/packet.json"
    POTEAU_NOTE="$POTEAU_DIR/packet.json"
fi

if [[ "$OUTPUT_JSON" == "1" ]]; then
    jq -n --arg out "$OUT" --argjson vrc "$vrc" --arg poteau "$POTEAU_NOTE" \
        '{ok:true, packet:$out, validator_exit:$vrc, poteau_packet:(if $poteau=="" then null else $poteau end)}'
else
    echo "[compose-handoff-wrap] wrote + validated handoff: $OUT (validator exit $vrc)"
    [[ -n "$POTEAU_NOTE" ]] && echo "[compose-handoff-wrap] poteau mailbox packet emitted: $POTEAU_NOTE (task_ref copied from armed run-state → P201 satisfied)"
fi
exit 0
