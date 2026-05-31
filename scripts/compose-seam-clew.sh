#!/usr/bin/env bash
# =============================================================================
# compose-seam-clew.sh — capture a >>clew correction at a Form C seam (cycle-053).
# =============================================================================
# At a seam (the only place a human is present — gate-seam-clew-mechanics §3), the
# operator's steer MAY contain a `>>clew@<construct>[/<skill>]: <why>` marker. This
# helper forwards the FULL operator steer text to the vendored capture primitive
# (scripts/clew/loa-clew-capture.sh) so the correction is deposited into the
# construct's local LEARNINGS.jsonl — capture only, no distill/ratify (cold-path).
#
# CRITICAL (flatline injection mandate): the steer text is passed to the capture
# script on STDIN, never interpolated into a shell command. A steer containing
# $(...), backticks, or ; never executes — it is matched by a fixed regex and the
# verbatim quote is assembled in Python.
#
# Invariants (Draft C §4):
#   * Clew fires ONLY at a seam (this script is called by the main-loop seam
#     handler, NEVER from inside an autonomous workflow body).
#   * Opt-in per steer: no >>clew marker → nothing recorded (exit 0, silent).
#   * Loud on capture failure, never silent.
#
# Usage:
#   compose-seam-clew.sh "<operator steer text>"      # argv
#   printf '%s' "$steer" | compose-seam-clew.sh        # stdin (preferred)
#   compose-seam-clew.sh --stdin                       # force stdin read
#
# Exit: passes through loa-clew-capture.sh's exit (0 on the hot path by design).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPTURE="$SCRIPT_DIR/clew/loa-clew-capture.sh"

if [[ ! -x "$CAPTURE" ]]; then
    echo "compose-seam-clew: capture primitive not found/executable: $CAPTURE" >&2
    exit 70
fi

# Read the steer text: argv (excluding the --stdin sentinel) or stdin. Either way
# it reaches the capture script via stdin — never as an interpolated shell token.
if [[ "${1:-}" == "--stdin" ]] || [[ $# -eq 0 ]]; then
    steer="$(cat)"
else
    steer="$*"
fi

printf '%s' "$steer" | "$CAPTURE"
