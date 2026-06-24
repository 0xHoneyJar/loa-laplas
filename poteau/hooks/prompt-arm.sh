#!/usr/bin/env bash
# UserPromptSubmit — the gradient injector (poteau v0.1.0; S3.3 port). FAIL OPEN.
#
# PORT CHANGE (the S1.3-deferral resolution): this hook NO LONGER creates
# run-state. Hooks cannot conduct — the DISPATCHER's gate 0 (compose-dispatch
# --module → laplas-ready + seed-runstate) is the sole armer (it writes the
# armed run-state with task/reads/routing the gatekeeper needs). This hook only:
#   (a) links THIS session to an already-armed run via a by-session pointer (T3),
#   (b) injects the governed-path gradient (stdout on exit 0 becomes context).
# A raw /compose with no prepared module arms NOTHING — it gets a softer nudge,
# never a half-armed run-state the gatekeeper can't judge. THIS is what makes
# merging the lattice for-keeps safe: it cannot spuriously arm an unprepared run.
INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""' 2>/dev/null) || exit 0
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "local"' 2>/dev/null)
case "$PROMPT" in
  /compose*|/simstim*|/spiral*)
    # 9x7 (gate-honesty axis 3 — truthful-state): the DISPATCHER's gate 0 is the SOLE armer AND
    # linker — it alone holds both the real session id and the freshly-minted run_id, and writes
    # by-session/<session> -> run_id authoritatively WHEN a run is actually entered. This hook
    # MUST NOT forge that link from a most-recently-armed-run heuristic: a recon/inspect session
    # that merely TYPES /compose (never dispatches -> never enters a segment) would otherwise
    # adopt a STALE, unrelated run-state and then deadlock at the exit-gate, demanding a packet
    # for work it never did. So we only READ a link the dispatcher already wrote for THIS session
    # (to give an accurate gradient) and NEVER CREATE one here. Arm-on-entry, not arm-on-prompt.
    link=".run/poteau/by-session/$SESSION"
    rid=""
    [ -f "$link" ] && rid=$(jq -r '.run_id // ""' "$link" 2>/dev/null)
    if [ -n "$rid" ] && [ -f ".run/poteau/$rid/run-state.json" ]; then
      echo "POTEAU ARMED (run $rid): a gated run. Each gated exit needs a handoff packet at .run/poteau/$rid/packet.json (verdict, rationale, task_ref hash-matching the armed task, conformance.in_scope, the mandated-read H1 echoed). The gate refuses with the exact fix — emit early, emit honestly. To exit an honest no-op, emit verdict:aborted with a rationale (the sanctioned abort door)."
    else
      echo "POTEAU: a composition-shaped prompt, but no run is armed for this session. If this is a real module, dispatch with --module <module.json> so gate 0 can ready-check and arm it (quest+party+dungeon must agree) — dispatch is what links this session to the run. Unprepared runs are legal but unattestable — they cannot mint a governed valid_run."
    fi
    ;;
esac
exit 0
