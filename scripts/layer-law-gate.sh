#!/usr/bin/env bash
# layer-law-gate.sh — The Descent Law as an ENFORCED gate (Phase 3 of the Descent).
#
# The coherence monitor (grimoires/loa/context/check-layer-law.mjs) is a candidate
# script; this wraps it so the stack SELF-CHECKS and bites: it exits NON-ZERO when a
# lower layer depends on a higher one (VIOLATION>0) — an inversion of the Descent Law.
#
# GAP (enforcement_from_below not yet wired) is reported but does NOT fail by default —
# GAP is phase-gated, not a law violation. Pass --strict to also fail on GAP>0.
#
# Usage:
#   scripts/layer-law-gate.sh            # fail only on VIOLATION>0
#   scripts/layer-law-gate.sh --strict   # also fail on GAP>0
# Env:
#   LAYER_LAW_VERIFIER=<path>            # override the verifier path (default: the laplas brief)
# Exit codes: 0 = pass · 1 = VIOLATION (inversion) · 2 = --strict GAP · 3 = verifier error
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${LAYER_LAW_VERIFIER:-$HERE/../grimoires/loa/context/check-layer-law.mjs}"

strict=false
[[ "${1:-}" == "--strict" ]] && strict=true

if [[ ! -f "$VERIFIER" ]]; then
  echo "layer-law-gate: ERROR — verifier not found: $VERIFIER" >&2
  exit 3
fi

# The verifier exits non-zero ON VIOLATION (by design) — that is NOT a crash. Capture
# output without aborting and parse the STATUS line; a missing STATUS line is the real error.
set +e
out="$(node "$VERIFIER" 2>&1)"
set -e
echo "$out"

status_line="$(printf '%s\n' "$out" | grep -oE 'STATUS=[^[:space:]]*' | tail -1)"
if [[ -z "$status_line" ]]; then
  echo "layer-law-gate: ERROR — verifier produced no STATUS line" >&2
  exit 3
fi
viol="$(printf '%s' "$status_line" | grep -oE 'VIOLATION=[0-9]+' | grep -oE '[0-9]+' || echo 0)"
gap="$(printf '%s' "$status_line" | grep -oE 'GAP=[0-9]+' | grep -oE '[0-9]+' || echo 0)"

if [[ "${viol:-0}" -gt 0 ]]; then
  echo "layer-law-gate: FAIL — VIOLATION=$viol (a lower layer depends in code on a higher one). The Descent Law is downward-only." >&2
  exit 1
fi
if [[ "$strict" == true && "${gap:-0}" -gt 0 ]]; then
  echo "layer-law-gate: FAIL (--strict) — GAP=$gap (a principle is not yet enforced from below)." >&2
  exit 2
fi
echo "layer-law-gate: PASS (VIOLATION=0${strict:+, GAP=$gap})"
