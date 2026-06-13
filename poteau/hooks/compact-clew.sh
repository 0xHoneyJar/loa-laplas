#!/usr/bin/env bash
# PreCompact — Drop the clew before context surgery (poteau v0.1.0). FAIL OPEN.
# Loa house pattern (pre-compact-marker.sh) extended: snapshot run state so the
# post-compact session can retrace the thread to the last known-good junction.
[ -f .run/poteau/run-state.json ] || exit 0
mkdir -p .run/poteau
cp .run/poteau/run-state.json ".run/poteau/clew-$(date -u +%s).json" 2>/dev/null
tail -20 .run/poteau/moves.jsonl > ".run/poteau/clew-moves-$(date -u +%s).jsonl" 2>/dev/null
exit 0
