#!/usr/bin/env bash
# compose-output-schema-preflight.sh — fail-closed coherence gate for the Form C
# typed-handoff (output_schema) feature. Asserts the 4 deployment layers AGREE before
# a composition that declares output_schema is dispatched, closing the mid-window where
# a composition declares output_schema but the emitter that runs ignores it (silent
# WORK_SCHEMA). Exit 0 = coherent; non-zero = a layer drifted (the deployment-seam class).
#
# Layers (atomic-rollout order, spec §Flatline-hardening / Round 2):
#   L1 canonical schema (loa-constructs)  declares output_schema on Stage
#   L2 installed schema (~/.claude)       == canonical, byte-identical (no copy-drift)
#   L3 the EMITTER THAT WILL RUN          reads output_schema AND derives required AND
#                                         instructs the declared schema (all 3 legs)
#   L4 the COMPOSITION being dispatched    (informational — declares output_schema or not)
#
# Usage:
#   compose-output-schema-preflight.sh <emitter.py> <composition.yaml|.json> [--json]
# Defaults: emitter = this runtime's scripts/lib/segment-emitter.py.
set -euo pipefail

CANON="${LOA_COMPOSE_SCHEMA:-$HOME/Documents/GitHub/loa-constructs/.claude/schemas/runtime/composition.schema.json}"
INSTALLED="${LOA_COMPOSE_SCHEMA_INSTALLED:-$HOME/.claude/schemas/runtime/composition.schema.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMITTER="${1:-$SCRIPT_DIR/lib/segment-emitter.py}"
COMP="${2:-}"
JSON=0; [[ "${3:-}" == "--json" || "${2:-}" == "--json" ]] && JSON=1

fail() { echo "PREFLIGHT-FAIL [$1]: $2" >&2; exit 1; }

# L1: canonical schema declares output_schema on the Stage shape
grep -q '"output_schema"' "$CANON" 2>/dev/null || fail L1 "canonical schema missing output_schema ($CANON)"

# L2: installed schema is byte-identical to canonical (the schema-copy-drift SMELL)
[[ -f "$INSTALLED" ]] || fail L2 "installed schema not found ($INSTALLED)"
if ! diff -q "$CANON" "$INSTALLED" >/dev/null 2>&1; then
  fail L2 "installed schema drifted from canonical — run: cp '$CANON' '$INSTALLED'"
fi

# L3: the emitter that WILL RUN honors all three legs of the typed-handoff contract
[[ -f "$EMITTER" ]] || fail L3 "emitter not found ($EMITTER)"
grep -q '_emit_stage_schema' "$EMITTER"   || fail L3 "emitter does not emit the declared schema ($EMITTER) — mid-window: composition declares output_schema, emitter ignores it"
grep -q '_emit_stage_required' "$EMITTER" || fail L3 "emitter does not derive withRetry required from output_schema ($EMITTER)"
grep -q '_return_instruction' "$EMITTER"  || fail L3 "emitter does not align the prompt instruction to the declared schema ($EMITTER)"

# L4: does the composition declare output_schema? (informational, not a failure)
L4="legacy (no output_schema — WORK_SCHEMA path)"
if [[ -n "$COMP" && -f "$COMP" ]] && grep -q 'output_schema' "$COMP" 2>/dev/null; then
  L4="declares output_schema (typed-handoff path)"
fi

if [[ "$JSON" -eq 1 ]]; then
  printf '{"ok":true,"L1":"canonical has output_schema","L2":"installed==canonical","L3":"emitter honors schema+required+instruction","L4":"%s"}\n' "$L4"
else
  echo "PREFLIGHT-OK: L1 canonical✓  L2 installed==canonical✓  L3 emitter honors schema+required+instruction✓  L4 $L4"
fi
