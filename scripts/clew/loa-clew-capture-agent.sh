#!/usr/bin/env bash
# loa-clew-capture-agent.sh — the EFFERENT-actor twin of loa-clew-capture.sh (a Stop hook).
#
# The operator hook (UserPromptSubmit) harvests >>clew@ markers from the OPERATOR's prompt.
# This hook harvests the SAME marker from the AGENT's OWN output — so the agent captures a
# correction INLINE (emit `>>clew@<construct>[/<skill>]: <why>` in its reply) instead of a
# Bash `clew-loop.mjs --add` call. One marker syntax, two harvest points (operator prompt +
# agent output), one canonical append path (ledger_append). This is the "harden the capture
# half" step: capture stops depending on the agent remembering to shell out.
#
# Safety: agent captures are captured_by:agent-reflex + verified:false + confirmed:false =
# CANDIDATES. The operator still SIGNS at distill (the /clew gate). The regex matches only real
# lowercase slugs, so `<construct>` placeholders in explanatory prose are ignored (same contract
# as the operator hook). Silent hot path; NEVER blocks (Stop must exit 0); requestId-deduped.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/clew/ledger-append.sh
source "${DIR}/ledger-append.sh"
STATE="${LOA_CLEW_AGENT_STATE:-${HOME}/.claude/laboratory/clew-agent-last.txt}"

input="$(cat)"
tpath="$(printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("transcript_path",""))
except Exception: print("")' 2>/dev/null)"
[[ -n "$tpath" && -f "$tpath" ]] || exit 0

# Extract intended clew markers from the LAST assistant message; dedup by requestId.
markers="$(LOA_CLEW_STATE="$STATE" python3 - "$tpath" <<'PY' 2>/dev/null
import json,sys,os,re,datetime,hashlib
tpath=sys.argv[1]
last_text=None; last_rid=None
try:
    with open(tpath, encoding="utf-8") as f:
        for line in f:
            try: d=json.loads(line)
            except Exception: continue
            if d.get("type")!="assistant": continue
            msg=d.get("message",{})
            if not isinstance(msg,dict) or msg.get("role")!="assistant": continue
            parts=[]; c=msg.get("content")
            if isinstance(c,list):
                for b in c:
                    if isinstance(b,dict) and b.get("type")=="text": parts.append(b.get("text",""))
            elif isinstance(c,str): parts.append(c)
            if parts:
                last_text="\n".join(parts); last_rid=d.get("requestId") or d.get("uuid")
except Exception:
    sys.exit(0)
if not last_text: sys.exit(0)
state=os.environ["LOA_CLEW_STATE"]
try:
    if last_rid and open(state).read().strip()==last_rid: sys.exit(0)   # already processed
except Exception: pass
# same contract as the operator hook: real lowercase slugs only → <placeholder> prose is safe
pat=re.compile(r">>clew@([a-z0-9][a-z0-9/_-]*):[ \t]*(.+)")
out=[]
for m in pat.finditer(last_text):
    slugspec=m.group(1); why=m.group(2).strip()
    if not why: continue
    construct=slugspec.split("/",1)[0]
    skill=slugspec.split("/",1)[1] if "/" in slugspec else construct
    out.append((construct,skill,why))
if last_rid:
    try:
        os.makedirs(os.path.dirname(state),exist_ok=True); open(state,"w").write(last_rid)
    except Exception: pass
for construct,skill,why in out:
    now=datetime.datetime.now(datetime.timezone.utc)
    h=hashlib.sha1((why+now.isoformat()).encode()).hexdigest()[:6]
    rec={"id":f"lrn-{now:%Y%m%d}-{construct}-{h}","tier":"construct","type":"correction",
         "trigger":why,"target":{"skill_slug":skill,"construct":construct,"confirmed":False},
         "tags":[construct],"verified":False,"captured_by":"agent-reflex",
         "captured_at":now.isoformat(),"distilled_at":None,"distill_status":"pending"}
    sys.stdout.write(construct+"\t"+json.dumps(rec,separators=(",",":"),ensure_ascii=False)+"\n")
PY
)"
[[ -n "$markers" ]] || exit 0
while IFS=$'\t' read -r construct json; do
  [[ -n "$construct" && -n "$json" ]] || continue
  set +e; ledger_append "$construct" "$json" >/dev/null 2>&1; set -e   # loud-fail not applicable on Stop; candidate only
done <<< "$markers"
exit 0
