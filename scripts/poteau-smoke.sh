#!/usr/bin/env bash
# =============================================================================
# poteau-smoke.sh — FR-B0: the hook-contract smoke test (THE FREEZE GATE)
# =============================================================================
# Proves, on THIS machine's Claude Code, the five legs poteau's law depends on:
#   L1 Stop {"decision":"block"} forces continuation with reason in context
#   L2 PreToolUse exit 2 denies the tool; stderr is fed to the model
#   L3 stop_hook_active=true on the blocked chain's second Stop (loop guard)
#   L4 UserPromptSubmit stdout-on-exit-0 lands in model context
#   L5 combined state: an L2 denial fired DURING the stop-blocked chain (T2)
#
# Law is not built on an unverified runtime: ANY leg false → exit 1 → the
# cycle HALTS (PRD FR-B0). Receipt: .run/poteau/contract-receipt.json.
#
# MODES (IMP-015 / SDD dual-mode): --mode headless (default) drives `claude -p`
# mechanically. --mode interactive cannot be pty-automated here; it records
# live-session evidence references and is marked evidence_grade accordingly —
# the delta is surfaced at sprint review, never silently equated.
# FAILURE POSTURE: custody — the gate itself fails closed (any assertion
# error, missing dep, or ambiguous probe = FAIL, never a wave-through).
# =============================================================================
set -uo pipefail

MODE="headless"
[[ "${1:-}" == "--mode" ]] && MODE="${2:-headless}"

command -v claude >/dev/null || { echo "P302: claude CLI not on PATH — cannot smoke a runtime that is absent" >&2; exit 1; }
command -v jq >/dev/null || { echo "P302: jq not on PATH" >&2; exit 1; }

CC_VERSION=$(claude --version 2>/dev/null | head -1)
OUT_DIR="$(pwd)/.run/poteau"
mkdir -p "$OUT_DIR"
RECEIPT="$OUT_DIR/contract-receipt.json"

if [[ "$MODE" == "interactive" ]]; then
  # Interactive cannot be driven mechanically from inside a session. Record the
  # live evidence pointers (this repo's own interactive sessions exercise Stop
  # blocking via run-mode-stop-guard and PreToolUse via safety guards) and mark
  # the grade honestly. The sprint review judges whether this suffices for R-7.
  jq -n --arg v "$CC_VERSION" '{
    cc_version: $v, mode: "interactive", evidence_grade: "observed-live-session",
    legs: {
      L1_stop_block: {pass: true, evidence: "run-mode-stop-guard.sh blocked Stop twice in session 2026-06-12 (observed; .run/audit.jsonl)"},
      L2_pretooluse_deny: {pass: true, evidence: "block-destructive-bash.sh + zone-write-guard.sh deny interactively (loa framework, every session)"},
      L3_loop_guard: {pass: null, evidence: "not observed live — headless receipt is the mechanical proof"},
      L4_ups_injection: {pass: true, evidence: "SessionStart/UserPromptSubmit banners land in context every session (observed)"},
      L5_combined: {pass: null, evidence: "not observed live — headless receipt is the mechanical proof"}
    },
    note: "evidence-grade INTERIM: legs L3/L5 interactive remain unproven mechanically; surfaced at S1 review per IMP-015"
  }' > "$OUT_DIR/contract-receipt.interactive.json"
  echo "interactive evidence receipt written (grade: observed-live-session; L3/L5 null — see note)"
  exit 0
fi

# ── headless: build the isolated fixture project ──
WORK=$(mktemp -d "${TMPDIR:-/tmp}/poteau-smoke.XXXXXX")
trap 'rm -rf "$WORK"' EXIT INT TERM
PROBE="$WORK/probe.jsonl"
mkdir -p "$WORK/.claude" "$WORK/hooks"

# hook scripts — each logs its invocation to the probe, then acts
cat > "$WORK/hooks/ups.sh" <<EOF
#!/usr/bin/env bash
INPUT=\$(cat)
printf '%s\n' "{\"hook\":\"ups\",\"ts\":\$(date +%s%N)}" >> "$PROBE"
echo "SENTINEL-UPS-INJECTED-7c4f"
exit 0
EOF

cat > "$WORK/hooks/deny.sh" <<EOF
#!/usr/bin/env bash
INPUT=\$(cat)
TARGET=\$(printf '%s' "\$INPUT" | jq -r '.tool_input.file_path // ""')
if printf '%s' "\$TARGET" | grep -q "forbidden"; then
  printf '%s\n' "{\"hook\":\"deny\",\"target\":\$(printf '%s' "\$TARGET" | jq -R .),\"ts\":\$(date +%s%N)}" >> "$PROBE"
  echo "SENTINEL-DENY-P402: write to forbidden path refused. Do not retry this path." >&2
  exit 2
fi
exit 0
EOF

cat > "$WORK/hooks/stop.sh" <<EOF
#!/usr/bin/env bash
INPUT=\$(cat)
ACTIVE=\$(printf '%s' "\$INPUT" | jq -r '.stop_hook_active // false')
printf '%s\n' "{\"hook\":\"stop\",\"active\":\$ACTIVE,\"ts\":\$(date +%s%N)}" >> "$PROBE"
if [ "\$ACTIVE" != "true" ]; then
  jq -n '{decision:"block", reason:"SENTINEL-CONTINUE-9b1e: before stopping you MUST (a) attempt exactly one Write to forbidden/again.txt with content x, then (b) reply with the single word ACK-9b1e."}'
fi
exit 0
EOF
chmod +x "$WORK"/hooks/*.sh

cat > "$WORK/.claude/settings.json" <<EOF
{
  "hooks": {
    "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": "$WORK/hooks/ups.sh"}]}],
    "PreToolUse": [{"matcher": "Write", "hooks": [{"type": "command", "command": "$WORK/hooks/deny.sh"}]}],
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "$WORK/hooks/stop.sh"}]}]
  },
  "permissions": {"allow": ["Write"]}
}
EOF

PROMPT='Three instructions, follow exactly: (1) If your context contains a line containing SENTINEL-UPS-INJECTED, start your reply with that full sentinel token. (2) Attempt exactly one Write to forbidden/first.txt with content x; it will be refused — do not retry. (3) Reply with the sentinel from (1) if present, then the word FIRST-DONE, then stop.'

RESULT=$(cd "$WORK" && claude -p "$PROMPT" --model haiku --output-format json 2>"$WORK/stderr.log")
TEXT=$(printf '%s' "$RESULT" | jq -r '.result // ""' 2>/dev/null)

# ── assertions from probe + transcript ──
pass=() ; fail=()
ck() { local name="$1" cond="$2" detail="$3"
  if [ "$cond" = "true" ]; then pass+=("$name"); else fail+=("$name: $detail"); fi; }

UPS_RAN=$(grep -c '"hook":"ups"' "$PROBE" 2>/dev/null)
# L4 is proven on the INPUT side: the session transcript must carry the sentinel
# in model-visible content. (Behavioral echo is NOT required — models may refuse
# to repeat injected text as injection-defense; that refusal itself proves
# delivery, but the transcript is the mechanical, cooperation-free witness.)
printf '%s' "$TEXT" > "$OUT_DIR/contract-run-text.txt"
# Delivery witness: the sentinel appears as an attachment entry (hook stdout →
# context) — and, when the model cooperates, echoed in an assistant message.
# Assert DELIVERY (attachment|user) mechanically; record echo as bonus evidence.
TRANSCRIPTS=$(grep -rl "SENTINEL-UPS-INJECTED-7c4f" "$HOME/.claude/projects" --include='*.jsonl' 2>/dev/null | head -3)
UPS_DELIVERED=0; UPS_ECHOED=0
for tf in $TRANSCRIPTS; do
  D=$(grep "SENTINEL-UPS-INJECTED-7c4f" "$tf" | jq -r '.type' 2>/dev/null | grep -c -E "attachment|user")
  E=$(grep "SENTINEL-UPS-INJECTED-7c4f" "$tf" | jq -r '.type' 2>/dev/null | grep -c "assistant")
  [ "$D" -ge 1 ] && UPS_DELIVERED=1
  [ "$E" -ge 1 ] && UPS_ECHOED=1
  [ "$UPS_DELIVERED" -ge 1 ] && break
done
ck "L4_ups_injection" "$([ "$UPS_RAN" -ge 1 ] && [ "$UPS_DELIVERED" -ge 1 ] && echo true || echo false)" "hook ran=$UPS_RAN, delivered-to-context=$UPS_DELIVERED (model echoed=$UPS_ECHOED)"

DENIES=$(grep -c '"hook":"deny"' "$PROBE" 2>/dev/null)
NO_FILES=$([ ! -f "$WORK/forbidden/first.txt" ] && [ ! -f "$WORK/forbidden/again.txt" ] && echo true || echo false)
ck "L2_pretooluse_deny" "$([ "$DENIES" -ge 1 ] && [ "$NO_FILES" = "true" ] && echo true || echo false)" "denies=$DENIES, forbidden files absent=$NO_FILES"

STOP_BLOCKS=$(grep '"hook":"stop"' "$PROBE" | grep -c '"active":false')
ACK=$(printf '%s' "$TEXT" | grep -c "ACK-9b1e")
ck "L1_stop_block" "$([ "$STOP_BLOCKS" -ge 1 ] && [ "$ACK" -ge 1 ] && echo true || echo false)" "blocks=$STOP_BLOCKS, continuation-ack=$ACK"

LOOP_GUARD=$(grep '"hook":"stop"' "$PROBE" | grep -c '"active":true')
ck "L3_loop_guard" "$([ "$LOOP_GUARD" -ge 1 ] && echo true || echo false)" "stop_hook_active=true seen $LOOP_GUARD times"

# L5: ordering — a deny AFTER the first stop-block (the continuation chain)
FIRST_BLOCK_TS=$(grep '"hook":"stop"' "$PROBE" | grep '"active":false' | head -1 | jq -r '.ts')
DENY_IN_CHAIN=$(awk -v t="$FIRST_BLOCK_TS" 'BEGIN{n=0} /"hook":"deny"/ {if (match($0,/"ts":[0-9]+/)) {ts=substr($0,RSTART+5,RLENGTH-5); if (ts+0 > t+0) n++}} END{print n}' "$PROBE")
ck "L5_combined" "$([ -n "$FIRST_BLOCK_TS" ] && [ "${DENY_IN_CHAIN:-0}" -ge 1 ] && echo true || echo false)" "denies after first block=$DENY_IN_CHAIN"

# ── receipt (custody: written before verdict; the verdict cites it) ──
jq -n --arg v "$CC_VERSION" --arg mode "$MODE" \
  --argjson p "$(printf '%s\n' "${pass[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  --argjson f "$(printf '%s\n' "${fail[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  '{cc_version:$v, mode:$mode, evidence_grade:"mechanical", ts:(now|todate),
    legs_passed:$p, legs_failed:$f, pass:($f|length==0)}' > "$RECEIPT"
cp "$PROBE" "$OUT_DIR/contract-probe.jsonl" 2>/dev/null || true

echo "── FR-B0 contract smoke ($MODE) on: $CC_VERSION"
for x in "${pass[@]:-}"; do [ -n "$x" ] && echo "  ✓ $x"; done
for x in "${fail[@]:-}"; do [ -n "$x" ] && echo "  ✗ $x"; done
if [ "${#fail[@]}" -gt 0 ]; then
  echo "FREEZE GATE: ${#fail[@]} leg(s) failed — the cycle HALTS (PRD FR-B0). Receipt: $RECEIPT" >&2
  exit 1
fi
echo "5/5 — law can be built on this runtime. Receipt: $RECEIPT"
