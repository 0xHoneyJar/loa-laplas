#!/usr/bin/env bash
# =============================================================================
# PreToolUse Hook — Tool Gate: the law protecting the law (poteau v0.1.0)
# =============================================================================
# Denies Write/Edit/Bash mutations targeting protected paths (.claude/,
# .run/poteau/, poteau/manifest/). An agent editing hook config or gate state
# is an operational actor amending constitutional law — layer leakage, denied.
# Exit 2 + stderr = deny, stderr fed back to the agent (refusals teach).
#
# FAILURE POSTURE: CUSTODY GATE — FAIL CLOSED for protected-path writes only;
# everything else allows (exit 0) so a jq hiccup cannot DoS ordinary work.
# Narrow closed surface + wide open default = both postures, correctly placed.
# =============================================================================
INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null) || exit 0
TARGET=""
case "$TOOL" in
  Write|Edit|MultiEdit) TARGET=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null) ;;
  Bash)                 TARGET=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null) ;;
  *) exit 0 ;;
esac
# T1 (SDD §4.6) — THE PACKET MAILBOX: the ONE writable slot under .run/poteau/.
# The agent must be able to emit its packet (a wholesale deny would deadlock its
# own exit); the packet is harmless by construction — JUDGED by G1–G5, receipts
# minted only by the gatekeeper. The carve-out is data; the judgment is law.
if printf '%s' "$TARGET" | grep -Eq '\.run/poteau/[^[:space:]/]+/packet\.json' ; then
  if ! printf '%s' "$TARGET" | sed -E 's#\.run/poteau/[^[:space:]/]+/packet\.json##g' | grep -q '\.run/poteau/'; then
    exit 0  # only packet.json paths mentioned — the mailbox is open
  fi
fi
for P in ".claude/" ".run/poteau/" "poteau/manifest/" "poteau/hooks/" "poteau/bin/"; do
  if printf '%s' "$TARGET" | grep -q "$P"; then
    if [ "$TOOL" = "Bash" ]; then
      printf '%s' "$TARGET" | grep -Eq '(>|>>|rm |mv |cp |sed -i|tee )' || exit 0  # reads are fine
    fi
    echo "POTEAU DENIED (P402): mutation targets protected path '$P'. Hook config, gate state, and the manifest are constitutional-layer artifacts — change them via poteau/manifest/poteau.manifest.json + 'node poteau/bin/poteau-gen.mjs' through a reviewed commit, never from inside a run." >&2
    exit 2
  fi
done
exit 0
