#!/usr/bin/env bash
# scripts/clew/loa-clew-capture.sh — `>>clew` capture hook (C1, SDD §4.1/§4.2)
#
# Phase-1 capture surface. Detects an inline marker in operator input and appends
# a verbatim-preserving learning to the in-scope construct's ledger. Silent on the
# hot path (no stdout); diagnostics to stderr; one trajectory record per capture.
#
# Markers (Phase 1 — EXPLICIT construct only, no embodiment-detection gamble):
#   >>clew@<construct>: <why>            target skill defaults to <construct>
#   >>clew@<construct>/<skill>: <why>    explicit construct + skill
#   >>clew: <why>                        NO @slug → no capture, nudge to disambiguate
#
# Registration (DEFERRED System-Zone step, not done by this script): add to
# .claude/settings.json under hooks.UserPromptSubmit. See scripts/clew/README.md.
set -euo pipefail
# BB F-002 (sibling, same root): this is a UserPromptSubmit hook; a non-zero exit blocks
# the operator's prompt. clew_capture() already `return 0`s on every in-function path, but
# the top-level `source` of ledger-append.sh (line below) and the dispatch tail run under
# `set -e` BEFORE that careful guarding — a failed source would exit non-zero and block the
# prompt. The ERR trap makes the "never block the operator's prompt" contract uniform with
# the Stop-hook twin; the explicit `|| exit 0` on the source covers the bash quirk where the
# ERR trap does NOT fire for a missing/failed `source` builtin (see the Stop-hook twin note).
# (When sourced as a library, this hardening would propagate to the caller's shell; this
# script is invoked, not sourced — its own `[[ BASH_SOURCE == 0 ]]` dispatch confirms
# run-as-script is the contract.)
trap 'exit 0' ERR

CLEW_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
# shellcheck source=scripts/clew/ledger-append.sh
source "${CLEW_HOOK_DIR}/ledger-append.sh" || exit 0

CLEW_GRIMOIRE_DIR="${LOA_GRIMOIRE_DIR:-grimoires/loa}"

# Read the operator prompt: UserPromptSubmit pipes JSON {"prompt": "..."} on stdin;
# fall back to argv for direct/test invocation.
_clew_read_prompt() {
  if [[ -n "${1:-}" ]]; then printf '%s' "$*"; return; fi
  local stdin_data; stdin_data="$(cat)"
  if printf '%s' "$stdin_data" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); sys.stdout.write(d.get("prompt","") if isinstance(d,dict) else "")
except Exception:
    sys.exit(1)' 2>/dev/null; then
    return
  fi
  printf '%s' "$stdin_data"
}

# Emit a trajectory record (best-effort, never blocks capture).
_clew_trajectory() {
  local action="$1" slug="$2" line_id="$3"
  local dir="${CLEW_GRIMOIRE_DIR}/a2a/trajectory"
  mkdir -p "$dir" 2>/dev/null || return 0
  local date; date="$(date -u +%Y-%m-%d)"
  CLEW_T_ACTION="$action" CLEW_T_SLUG="$slug" CLEW_T_LINE="$line_id" \
    python3 -c 'import json,os,sys,datetime
rec={"timestamp":datetime.datetime.now(datetime.timezone.utc).isoformat(),
     "agent":"construct-clew","action":os.environ["CLEW_T_ACTION"],
     "reasoning":"clew-marker capture","grounding":{"ledger":os.environ["CLEW_T_SLUG"],"line_id":os.environ["CLEW_T_LINE"]}}
sys.stdout.write(json.dumps(rec))' >> "${dir}/construct-clew-${date}.jsonl" 2>/dev/null || true
}

# Resolve the genome-admission run_id (bd-uze). The compose run_id active at
# capture time is surfaced by the run-aware seam protocol via LOA_COMPOSE_RUN_ID.
# Empty (→ ledger null) for an AMBIENT capture outside a governed run, or if the
# value is malformed. The binding is SOFT here on purpose; it is HARDENED at
# genome admission (loa-clew-distill.sh --mark-distilled verifies the run_id has
# a `valid_run` verdict from compose-verify-run). A fabricated id never admits.
_clew_resolve_run_id() {
  local rid="${LOA_COMPOSE_RUN_ID:-}"
  [[ -z "$rid" ]] && { printf ''; return 0; }
  if [[ "$rid" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] && [[ "$rid" != *".."* ]]; then
    printf '%s' "$rid"
  else
    echo "clew: ignoring malformed LOA_COMPOSE_RUN_ID '$rid' (recording ambient capture)." >&2
    printf ''
  fi
}

# Confirm the target skill is a REAL skill of the construct's pack. The schema's
# `confirmed` flag means "validated home" (FR-2: false = QUARANTINED, awaiting operator
# confirm at distill) — NOT "the operator typed something". Marker capture historically
# hardcoded confirmed=true, so a typo'd or non-existent <skill> dead-lettered silently
# against a home that never existed (the drain then shows it "NOT FOUND"). We still CAPTURE
# (never lose the correction — mis-homed beats lost), but quarantine it LOUDLY so the drain
# can surface it for re-homing. stdout = the boolean; stderr = the operator nudge.
_clew_skill_confirmed() {
  local construct="$1" skill="$2" explicit="$3"
  local root="${LOA_CLEW_LEDGER_ROOT:-$HOME/.loa/constructs/packs}"
  local norm="${construct#construct-}"          # mirror ledger-append's slug normalization
  local skills_dir="${root}/${norm}/skills"
  if [[ "$explicit" != "true" ]]; then
    echo "clew: '>>clew@${norm}' named no /<skill> — captured UNCONFIRMED; name the taught skill at distill." >&2
    printf 'false'; return 0
  fi
  if [[ ! -d "$skills_dir" ]]; then
    echo "clew: construct '${norm}' not installed locally — skill '${skill}' unvalidated; captured UNCONFIRMED." >&2
    printf 'false'; return 0
  fi
  if [[ -d "${skills_dir}/${skill}" ]]; then
    printf 'true'; return 0
  fi
  local avail; avail="$(ls -1 "$skills_dir" 2>/dev/null | tr '\n' ' ')"
  echo "clew: '${skill}' is not a skill of '${norm}' — captured QUARANTINED (re-tag at distill). available: ${avail:-none}" >&2
  printf 'false'; return 0
}

clew_capture() {
  local prompt; prompt="$(_clew_read_prompt "$@")"

  # Find the first line carrying the marker.
  local marker_line=""
  while IFS= read -r line; do
    if [[ "$line" == *">>clew"* ]]; then marker_line="$line"; break; fi
  done <<< "$prompt"
  [[ -n "$marker_line" ]] || return 0   # no marker → pass through silently

  local slugspec why
  if [[ "$marker_line" =~ \>\>clew@([a-z0-9/-]+):[[:space:]]*(.*)$ ]]; then
    slugspec="${BASH_REMATCH[1]}"
    why="${BASH_REMATCH[2]}"
  elif [[ "$marker_line" =~ \>\>clew:[[:space:]]*(.*)$ ]]; then
    # Bare marker — Phase 1 will not guess the construct (FR-2: no silent wrong-ledger write).
    echo "clew: '>>clew' needs an explicit construct in Phase 1 — use '>>clew@<construct>: <why>'." >&2
    return 0
  else
    return 0
  fi

  # Split construct[/skill]; default skill_slug to the construct.
  local construct="${slugspec%%/*}" skill="${slugspec#*/}"
  local skill_explicit=false
  [[ "$slugspec" == */* ]] && skill_explicit=true
  [[ "$skill" == "$slugspec" ]] && skill="$construct"

  # Trim a single trailing whitespace run from the verbatim quote; preserve the rest.
  why="${why%"${why##*[![:space:]]}"}"
  if [[ -z "$why" ]]; then
    echo "clew: empty capture reason after '>>clew@${slugspec}:' — nothing recorded." >&2
    return 0
  fi

  # Validate the target skill against the construct's real skill set — sets the schema's
  # `confirmed` flag honestly (true = validated home) instead of fabricating it.
  local clew_confirmed; clew_confirmed="$(_clew_skill_confirmed "$construct" "$skill" "$skill_explicit")"

  # Assemble the ledger line in python so the verbatim quote can contain any character.
  local clew_run_id; clew_run_id="$(_clew_resolve_run_id)"
  local json line_id
  json="$(CLEW_CONSTRUCT="$construct" CLEW_SKILL="$skill" CLEW_WHY="$why" CLEW_RUN_ID="$clew_run_id" CLEW_CONFIRMED="$clew_confirmed" python3 -c '
import json,os,sys,datetime,hashlib
now=datetime.datetime.now(datetime.timezone.utc)
construct=os.environ["CLEW_CONSTRUCT"]; skill=os.environ["CLEW_SKILL"]; why=os.environ["CLEW_WHY"]
run_id=os.environ.get("CLEW_RUN_ID") or None
confirmed=os.environ.get("CLEW_CONFIRMED")=="true"
h=hashlib.sha1((why+now.isoformat()).encode()).hexdigest()[:6]
line={"id":f"lrn-{now:%Y%m%d}-{construct}-{h}","tier":"construct","type":"correction",
      "trigger":why,
      "target":{"skill_slug":skill,"construct":construct,"confirmed":confirmed},
      "tags":[construct],"verified":False,"captured_by":"clew-marker",
      "captured_at":now.isoformat(),"run_id":run_id,"distilled_at":None,"distill_status":"pending"}
sys.stdout.write(json.dumps(line,separators=(",",":"),ensure_ascii=False))')"
  line_id="$(printf '%s' "$json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"

  # Append (loud on failure — capture is lossy-but-never-silent, SDD §6.1).
  local rc
  set +e; ledger_append "$construct" "$json"; rc=$?; set -e
  if (( rc != 0 )); then
    echo "clew: capture FAILED for @${construct} (rc=$rc) — not recorded (loud, not silent)." >&2
    _clew_trajectory "capture_failed" "$construct" "$line_id"
    return 0   # never block the operator's prompt
  fi
  _clew_trajectory "capture" "$construct" "$line_id"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  clew_capture "$@"
fi
