#!/usr/bin/env bash
# UserPromptSubmit — Arm the run (poteau v0.1.0). FAIL OPEN (advisory arming).
# Detects run commands (/compose, /simstim, /spiral), opens run state, injects
# the governed-path one-liner (stdout on exit 0 becomes context — the gradient
# starts at the door). Task/mandated_reads/review_routing are populated by the
# dispatcher (PROMPT.md Phase 2); this hook only opens the ledger.
INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""' 2>/dev/null) || exit 0
case "$PROMPT" in
  /compose*|/simstim*|/spiral*)
    mkdir -p .run/poteau
    if [ ! -f .run/poteau/run-state.json ]; then
      jq -n --arg c "$PROMPT" '{run_id:("run:" + (now|tostring)), armed_by:$c, gate_index:0, stop_blocks:0, ts:(now|todate)}' > .run/poteau/run-state.json
    fi
    echo "POTEAU ARMED: this is a gated run. Exits require a handoff packet at .run/poteau/packet.json (verdict, rationale, task_ref, conformance). The gate refuses with the exact fix — emit early, emit honestly."
    ;;
esac
exit 0
