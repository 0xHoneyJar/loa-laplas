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
    # adopt the most-recently-armed run (dispatcher-seeded) for this session (T3).
    # Tolerant of both layouts during the port: run-scoped .run/poteau/<rid>/
    # (dispatcher/seeder) and flat .run/poteau/ (reference exit-gate, until the
    # exit-gate run-scoping lands — the remaining T3 piece).
    armed=""
    if [ -d .run/poteau ]; then
      armed=$(ls -1dt .run/poteau/*/run-state.json 2>/dev/null | head -1)
      [ -z "$armed" ] && [ -f .run/poteau/run-state.json ] && armed=.run/poteau/run-state.json
    fi
    if [ -n "$armed" ]; then
      rid=$(jq -r '.run_id // "run"' "$armed" 2>/dev/null); rid=${rid:-run}
      mkdir -p .run/poteau/by-session
      jq -n --arg r "$rid" --arg a "$(date -u +%FT%TZ)" '{run_id:$r, armed_at:$a}' \
        > ".run/poteau/by-session/$SESSION" 2>/dev/null || true
      echo "POTEAU ARMED (run $rid): a gated run. Each gated exit needs a handoff packet at .run/poteau/$rid/packet.json (verdict, rationale, task_ref hash-matching the armed task, conformance.in_scope, the mandated-read H1 echoed). The gate refuses with the exact fix — emit early, emit honestly."
    else
      echo "POTEAU: this looks like a composition run, but no prepared ceremony is armed. If this is a real module, dispatch with --module <module.json> so gate 0 can ready-check and arm it (quest+party+dungeon must agree). Unprepared runs are legal but unattestable — they cannot mint a governed valid_run."
    fi
    ;;
esac
exit 0
