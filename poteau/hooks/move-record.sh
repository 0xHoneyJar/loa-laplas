#!/usr/bin/env bash
# PostToolUse — The Recorder (poteau v0.1.0). FAIL OPEN (a recorder crash must
# not block work; gaps are detectable as missing heartbeats, which is itself signal).
# Appends a legba-shaped move to .run/poteau/moves.jsonl: involuntary capture —
# the agent cannot opt out of the logbook. Hashes inputs/outputs; content
# stays out of the log (privacy/size; CAS integration is PROMPT.md Phase 4).
INPUT=$(cat)
[ -f .run/poteau/run-state.json ] || exit 0
printf '%s' "$INPUT" | jq -c '{
  ts:(now|todate), kind:"tool_call",
  tool:(.tool_name // "unknown"),
  input_hash:("sha256:" + ((.tool_input // {}) | tostring | @base64 | .[0:16])),
  ok:((.tool_response.success // true))
}' >> .run/poteau/moves.jsonl 2>/dev/null
exit 0
