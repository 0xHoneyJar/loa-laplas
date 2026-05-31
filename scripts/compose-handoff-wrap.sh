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

if [[ "$OUTPUT_JSON" == "1" ]]; then
    jq -n --arg out "$OUT" --argjson vrc "$vrc" '{ok:true, packet:$out, validator_exit:$vrc}'
else
    echo "[compose-handoff-wrap] wrote + validated handoff: $OUT (validator exit $vrc)"
fi
exit 0
