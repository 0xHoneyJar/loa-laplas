#!/usr/bin/env bash
# =============================================================================
# Stop / SubagentStop Hook — The Exit Gate (poteau v0.1.0)
# =============================================================================
# The turnstile, inverted: the agent may not END ITS TURN without presenting.
# Shells to poteau-gatekeeper.mjs; on refusal, emits {"decision":"block",
# "reason":<teaching refusal>} so the agent continues WITH the fix in context.
#
# FAILURE POSTURE: CUSTODY GATE — FAIL CLOSED (manifest.failure_posture).
# A gate bypassable by inducing a crash is not a gate. Contrast with loa's
# safety fences (block-destructive-bash.sh) which fail open — opposite
# postures, both deliberate; see ARCHITECTURE.md §failure-postures.
# Break-glass: POTEAU_BREAK_GLASS=<reason> allows stop and logs the loudest
# signal in the system (Ostrom: a sensed override closes the loop honestly).
#
# LOOP GUARD: stop_hook_active==true means we already blocked this turn once;
# we count blocks in run state and allow-with-incident after
# gate.max_stop_blocks_per_turn (default 3) — checkpoint, never imprison.
# =============================================================================
INPUT=$(cat)
mkdir -p .run/poteau

# RUN_DIR resolution (T3 run-scoping): this session's by-session pointer →
# .run/poteau/<run_id>/ (dispatcher-armed). Falls back to the flat
# .run/poteau/ during the port (reference shape). Break-glass incidents land
# at the resolved RUN_DIR so they're attributable to the run.
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "local"' 2>/dev/null)
RUN_DIR=".run/poteau"
if [ -f ".run/poteau/by-session/$SESSION" ]; then
  _rid=$(jq -r '.run_id // ""' ".run/poteau/by-session/$SESSION" 2>/dev/null)
  [ -n "$_rid" ] && [ -f ".run/poteau/$_rid/run-state.json" ] && RUN_DIR=".run/poteau/$_rid"
fi

if [ -n "$POTEAU_BREAK_GLASS" ]; then
  echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"event\":\"break_glass\",\"reason\":\"$POTEAU_BREAK_GLASS\",\"actor\":\"operator\"}" >> "$RUN_DIR/incidents.jsonl"
  exit 0
fi

# not in an armed run → nothing to enforce
[ -f "$RUN_DIR/run-state.json" ] || exit 0

# loop guard — scoped to the CONTINUATION CHAIN: a fresh turn (stop_hook_active
# false) resets the counter. max_stop_blocks bounds one chain of forced
# continuations, not the run's lifetime refusal budget.
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$ACTIVE" != "true" ]; then
  jq '.stop_blocks = 0' "$RUN_DIR/run-state.json" > "$RUN_DIR/.rs.tmp" && mv "$RUN_DIR/.rs.tmp" "$RUN_DIR/run-state.json"
fi
BLOCKS=$(jq -r '.stop_blocks // 0' "$RUN_DIR/run-state.json" 2>/dev/null); BLOCKS=${BLOCKS:-0}
PB="${POTEAU_ROOT:-poteau}"  # repo-convention delta: package root overridable
MAX=$(jq -r '.gate.max_stop_blocks_per_turn // 3' "$PB/manifest/poteau.manifest.json" 2>/dev/null); MAX=${MAX:-3}
if [ "$ACTIVE" = "true" ] && [ "$BLOCKS" -ge "$MAX" ]; then
  echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"event\":\"max_blocks_checkpoint\",\"blocks\":$BLOCKS,\"actor\":\"watchdog\"}" >> "$RUN_DIR/incidents.jsonl"
  exit 0   # checkpoint-and-release: liveness > imprisonment; incident is loud
fi

PACKET="null"
[ -f "$RUN_DIR/packet.json" ] && PACKET=$(cat "$RUN_DIR/packet.json")

VERDICT=$(jq -n --argjson rs "$(cat "$RUN_DIR/run-state.json")" --argjson p "$PACKET" \
  '{run_state:$rs, packet:(if $p == null then null else $p end)}' \
  | node "$PB/bin/poteau-gatekeeper.mjs" 2>>"$RUN_DIR/gatekeeper.err")
GK_EXIT=$?

if [ $GK_EXIT -eq 0 ]; then
  jq '.stop_blocks = 0 | .gate_index = ((.gate_index // 0) + 1)' "$RUN_DIR/run-state.json" > "$RUN_DIR/.rs.tmp" && mv "$RUN_DIR/.rs.tmp" "$RUN_DIR/run-state.json"
  rm -f "$RUN_DIR/packet.json"   # consumed; next span needs a fresh one
  exit 0
fi

REASON=$(printf '%s' "$VERDICT" | jq -r '.refusal // "gate refused (P500): see .run/poteau/gatekeeper.err"')
jq --arg r "$REASON" '.stop_blocks = ((.stop_blocks // 0) + 1)' "$RUN_DIR/run-state.json" > "$RUN_DIR/.rs.tmp" && mv "$RUN_DIR/.rs.tmp" "$RUN_DIR/run-state.json"
jq -n --arg r "$REASON" '{decision:"block", reason:("POTEAU GATE: " + $r)}'
exit 0
