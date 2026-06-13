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
  Read|NotebookRead)
    # Reads are otherwise UNGATED — but the FR-E reviewer signing keys are the one
    # read that enables council forgery (a held private key → self-signed votes).
    _rt=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
    printf '%s' "$_rt" | grep -q '\.run/poteau/reviewers/' && { echo "POTEAU DENIED (P402): .run/poteau/reviewers/ holds reviewer SIGNING keys — no run participant may read them (a held key forges a council). They are provisioned out-of-band; the gatekeeper verifies the public keys only." >&2; exit 2; }
    exit 0 ;;
  *) exit 0 ;;
esac
# FR-E (bug-20260612-b2936d): reviewer PRIVATE keys are unreadable by ANY tool —
# a Write/Edit/Bash touching them is denied here (the Read path is handled above).
# FENCE-grade (subshell-bypassable); hard isolation is keeping the keys off the
# shared FS (a deployment property — see poteau/bin/reviewer-keys.mjs).
if printf '%s' "$TARGET" | grep -q '\.run/poteau/reviewers/'; then
  echo "POTEAU DENIED (P402): .run/poteau/reviewers/ holds reviewer SIGNING keys — not readable or writable by a run participant. A held private key forges a council; the keys are provisioned out-of-band." >&2
  exit 2
fi
# T1 (SDD §4.6) — THE PACKET MAILBOX: the ONE writable slot under .run/poteau/.
# The agent must be able to emit its packet (a wholesale deny would deadlock its
# own exit); the packet is harmless by construction — JUDGED by G1–G5, receipts
# minted only by the gatekeeper. The carve-out is data; the judgment is law.
#
# AUTHOR ISOLATION (bug-20260612-b2936d): we deliberately DO NOT restrict *who*
# writes packet.json to "the wire only" — on a shared filesystem the hook cannot
# distinguish the executor from a run-participant subagent (same user, same tree),
# so such a restriction would be FORM, not substance — the very failure class this
# bug is about. Author/judge isolation is enforced where it CAN be: in the
# gatekeeper (G4), which requires the packet's PASS to carry valid Ed25519 council
# signatures from provisioned reviewer keys. A self-reflecting agent may write any
# packet here; it cannot make one MINT without reviewer keys it does not hold.
#
# SECURITY (audit finding): the carve-out is the ONE hole in the constitutional
# deny — it must be airtight. Two defenses against substring/traversal bypass:
#   (1) ANY '..' in the target → never carve out (path traversal closed, even
#       though packet.json/../ fails at the OS with ENOTDIR — defense in depth).
#   (2) packet.json must be the FINAL path component ($-anchored), not a
#       substring — so '.../packet.json/../run-state.json' does NOT open the gate.
if ! printf '%s' "$TARGET" | grep -q '\.\.' \
   && printf '%s' "$TARGET" | grep -Eq '\.run/poteau/[^[:space:]/]+/packet\.json([[:space:]]|$)' ; then
  if ! printf '%s' "$TARGET" | sed -E 's#\.run/poteau/[^[:space:]/]+/packet\.json##g' | grep -q '\.run/poteau/'; then
    exit 0  # only a final-component packet.json path, no traversal — the mailbox is open
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
