#!/usr/bin/env bash
# =============================================================================
# council-run.sh — the council runner (FR-D / S4.1). Closes #30's runtime half.
# =============================================================================
# Fires N>=2 DISTINCT provider CLIs (claude/codex/gemini headless — the flatline
# trio pattern at gate scale) against the SAME gate prompt, collects signed
# council receipts into the packet. The gatekeeper's G4 then verifies
# >=min_voices distinct reviewer_ids (P204) — a single voice on a council
# surface is refused. Silent downgrade is the one failure this exists to prevent.
#
# Invoked by the EXECUTOR at gate stages (a workflow segment), NEVER by a hook
# (hooks cannot conduct — the sandwich).
#
# Resilience (U4): PARALLEL invocation, 300s/provider timeout, ONE retry per
# provider on transient failure. Distinctness (U3): runner-grade — distinct
# provider binaries, the runner attests; not cryptographic (that's FR-E).
# Hard-fail (T6): voices < min_voices after retry → exit 4 NAMING the dead
# provider + the staffing fix. Degradation happens ONLY via the recorded
# --allow-single-model override (operator-only, {actor,reason}), never as a
# runtime fallback.
#
#   council-run.sh --prompt <file> --task-ref <sha> --packet <file> \
#                  --min-voices N [--providers claude,codex,gemini] [--out <file>]
#   COUNCIL_RUN_MOCK=<json>  test hook: canned provider verdicts, no real calls
# exit: 0 council seated (>=min distinct voices) · 4 under-staffed · 2 usage
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REVIEWER_KEYS="$SCRIPT_DIR/../poteau/bin/reviewer-keys.mjs"  # FR-E: per-provider signing keys

PROMPT_FILE="" TASK_REF="" PACKET_FILE="" MIN_VOICES=2 PROVIDERS="claude,codex,gemini" OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt) PROMPT_FILE="$2"; shift 2 ;;
    --task-ref) TASK_REF="$2"; shift 2 ;;
    --packet) PACKET_FILE="$2"; shift 2 ;;
    --min-voices) MIN_VOICES="$2"; shift 2 ;;
    --providers) PROVIDERS="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "council-run: unknown arg '$1'" >&2; exit 2 ;;
  esac
done
[[ -n "$TASK_REF" && -n "$PACKET_FILE" ]] || { echo "council-run: --task-ref and --packet required" >&2; exit 2; }

PACKET_HASH=$(node -e '
  const{createHash}=require("crypto");const fs=require("fs");
  const jcs=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?"["+v.map(jcs).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+jcs(v[k])).join(",")+"}";
  console.log("sha256:"+createHash("sha256").update(jcs(JSON.parse(fs.readFileSync(process.argv[1],"utf8")))).digest("hex"));
' "$PACKET_FILE")
# FR-E: the reviewer signs the gatekeeper's canonical council payload — the PACKET's
# {task_ref,verdict}. Read the packet verdict once for signing.
PKT_VERDICT=$(jq -r '.verdict // empty' "$PACKET_FILE")

NONCE=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
RECEIPTS="[]"
DEAD=()

# one provider → a council receipt (or empty on failure). MOCK short-circuits.
run_provider() {
  local p="$1" verdict=""
  if [[ -n "${COUNCIL_RUN_MOCK:-}" ]]; then
    verdict=$(printf '%s' "$COUNCIL_RUN_MOCK" | jq -r --arg p "$p" '.[$p] // empty')
  else
    command -v "$p" >/dev/null 2>&1 || return 0;
    local attempt out
    for attempt in 1 2; do  # U4: one retry on transient failure
      # the provider reviews the prompt; we ask for APPROVED|CHANGES_REQUIRED.
      out=$(timeout 300 "$p" -p "$(cat "$PROMPT_FILE" 2>/dev/null) Reply with exactly one word: APPROVED or CHANGES_REQUIRED." 2>/dev/null)
      if [[ -n "$out" ]]; then
        verdict=$(printf '%s' "$out" | grep -oE 'APPROVED|CHANGES_REQUIRED' | head -1)
        break
      fi
    done
  fi
  if [[ -z "$verdict" ]]; then return 0; fi
  # FR-E: sign the canonical {task_ref,verdict} with this provider's reviewer key.
  # The gatekeeper (G4) verifies this signature against the provisioned reviewer
  # PUBLIC key — a fabricated reviewer_id string no longer counts as a voice.
  local sig
  sig=$(node "$REVIEWER_KEYS" sign "$p" "$TASK_REF" "$PKT_VERDICT" 2>/dev/null) || return 0
  [[ -n "$sig" ]] || return 0
  jq -nc --arg p "$p" --arg v "$verdict" --arg t "$TASK_REF" --arg h "$PACKET_HASH" --arg n "$NONCE" --arg s "$sig" \
    '{reviewer_id:($p+":headless:"+$n), provider:$p, verdict:$v, task_ref:$t, packet_hash:$h, signature:$s, ts:(now|todate)}'
}

# PARALLEL fan-out (U4): each provider into a temp file, then collect.
IFS=',' read -ra PLIST <<< "$PROVIDERS"
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
for p in "${PLIST[@]}"; do ( run_provider "$p" > "$TMPD/$p.json" ) & done
wait
for p in "${PLIST[@]}"; do
  if [[ -s "$TMPD/$p.json" ]]; then
    RECEIPTS=$(jq -c --slurpfile r "$TMPD/$p.json" '. + $r' <<< "$RECEIPTS")
  else
    DEAD+=("$p")
  fi
done

VOICES=$(jq 'map(.reviewer_id) | unique | length' <<< "$RECEIPTS")
COUNCIL=$(jq -nc --argjson r "$RECEIPTS" --argjson voices "$VOICES" '{council_receipts:$r, voices:$voices}')
[[ -n "$OUT" ]] && printf '%s' "$COUNCIL" > "$OUT"
printf '%s\n' "$COUNCIL"

if (( VOICES < MIN_VOICES )); then
  echo "council-run: UNDER-STAFFED — seated $VOICES voice(s), need $MIN_VOICES. Dead/unavailable: ${DEAD[*]:-none}. Provision the provider CLI(s) or record an operator --allow-single-model override (never a silent downgrade — #30)." >&2
  exit 4
fi
exit 0
