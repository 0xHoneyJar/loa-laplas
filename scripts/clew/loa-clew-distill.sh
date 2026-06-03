#!/usr/bin/env bash
# loa-clew-distill.sh — the DRAIN half of the clew loop (capture fills, distill drains).
#
# The level-up reflex: a construct's accumulated clews (operator corrections, captured by
# loa-clew-capture.sh) are distilled into a teaching PR to the construct's SKILL/persona —
# the construct LEVELS UP by absorbing its own corrections. This script is the MECHANICAL
# half (list pending / show one construct's pending clews + resolve source repo + target
# SKILL paths / mark a clew proposed). The JUDGMENT half — reading the target SKILL and
# drafting the contract-safe teaching edit + PR — is the AGENT's (see the /clew skill).
# Sibling of loa-clew-capture.sh; same per-pack LEARNINGS.jsonl ledger format.
#
# Governance (Ostrom / the design): there is NO loop here. The OPERATOR names ONE construct
# per invocation; the fan-out is the operator's eye, not a script — so a whole-network sweep
# can never open N PRs in one night. SENSE is free; ACT is operator-paced.
#
#   loa-clew-distill.sh --list                       packs with undistilled (pending) clews
#   loa-clew-distill.sh <construct> [--show]         pending clews + source repo + target SKILL paths
#   loa-clew-distill.sh <construct> --mark-proposed <clew-id> [--pr <url>]
set -uo pipefail
PACKS="${LOA_CONSTRUCTS_PACKS:-$HOME/.loa/constructs/packs}"
SRC_ROOT="${LOA_CONSTRUCT_SRC:-$HOME/Documents/GitHub}"

sub="${1:-}"
case "$sub" in
  --list|"")
    python3 - "$PACKS" <<'PY'
import json, sys, os, glob
packs = sys.argv[1]; rows = []
for f in sorted(glob.glob(os.path.join(packs, '*', 'LEARNINGS.jsonl'))):
    c = os.path.basename(os.path.dirname(f)); pend = total = 0
    for ln in open(f, errors='replace'):
        ln = ln.strip()
        if not ln: continue
        try: d = json.loads(ln)
        except Exception: continue
        total += 1
        if d.get('distill_status') == 'pending': pend += 1
    if pend > 0: rows.append((c, pend, total))
if not rows:
    print("  ∴ clew-drain: all ledgers drained — no pending clews (silence is the signal)"); sys.exit(0)
print("  ∴ clew-drain · constructs carrying undischarged clews (the level-up backlog):")
for c, p, t in sorted(rows, key=lambda x: -x[1]):
    print(f"    · {c:24} {p} pending / {t} total   →  /clew {c}")
PY
    ;;
  --help|-h)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    construct="$sub"; shift || true
    action="show"; clewid=""; prurl=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --show) action="show"; shift ;;
        --mark-proposed) action="mark"; clewid="${2:-}"; shift 2 || shift $# ;;
        --pr) prurl="${2:-}"; shift 2 || shift $# ;;
        *) shift ;;
      esac
    done
    ledger="$PACKS/$construct/LEARNINGS.jsonl"
    [ -f "$ledger" ] || { echo "no clew ledger for '$construct' ($ledger)" >&2; exit 1; }

    if [ "$action" = "mark" ]; then
      [ -n "$clewid" ] || { echo "usage: loa-clew-distill.sh $construct --mark-proposed <clew-id> [--pr <url>]" >&2; exit 1; }
      tmp="$(mktemp)"
      CLEW_ID="$clewid" CLEW_PR="$prurl" python3 - "$ledger" > "$tmp" <<'PY'
import json, sys, os, datetime
cid = os.environ["CLEW_ID"]; pr = os.environ.get("CLEW_PR", "")
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
found = False
for ln in open(sys.argv[1], errors='replace'):
    ln = ln.rstrip("\n")
    if not ln.strip(): continue
    try: d = json.loads(ln)
    except Exception: print(ln); continue
    if d.get("id") == cid:
        d["distill_status"] = "proposed"; d["distilled_at"] = now
        if pr: d["proposed_pr"] = pr
        found = True
        print(json.dumps(d, separators=(",", ":"), ensure_ascii=False)); continue
    print(ln)
sys.exit(0 if found else 3)
PY
      rc=$?
      if [ "$rc" -eq 0 ]; then mv "$tmp" "$ledger"; echo "  ✓ $construct/$clewid → proposed${prurl:+ (pr: $prurl)}"; else rm -f "$tmp"; echo "  ✗ clew-id '$clewid' not found in $construct ledger" >&2; exit 1; fi
      exit 0
    fi

    # show
    echo "  ∴ /clew $construct — pending clews + where each teaches:"
    src="$SRC_ROOT/construct-$construct"
    if [ -d "$src/.git" ]; then echo "  source: $src  (branch $(git -C "$src" rev-parse --abbrev-ref HEAD 2>/dev/null))"; else echo "  source: construct-$construct NOT cloned at $SRC_ROOT — clone before drafting the PR"; fi
    python3 - "$ledger" "$src" <<'PY'
import json, sys, os
ledger, src = sys.argv[1], sys.argv[2]; n = 0
for ln in open(ledger, errors='replace'):
    ln = ln.strip()
    if not ln: continue
    try: d = json.loads(ln)
    except Exception: continue
    if d.get("distill_status") != "pending": continue
    n += 1
    sk = d.get("target", {}).get("skill_slug", "?")
    skp = os.path.join(src, "skills", sk, "SKILL.md")
    print(f"\n  clew {d.get('id')}  →  skill: {sk}")
    print(f"    target SKILL: {skp}  ({'exists' if os.path.exists(skp) else 'NOT FOUND — resolve the skill path'})")
    print(f"    lesson: {d.get('trigger','')}")
if n == 0: print("\n  (no pending clews — this construct is drained)")
PY
    echo ""
    echo "  next (the agent's judgment half): read the target SKILL → draft a contract-safe teaching"
    echo "  edit (the anti-patterns / output-shape / principle block, NEVER construct.yaml interface)"
    echo "  → open a PR → then: loa-clew-distill.sh $construct --mark-proposed <clew-id> --pr <url>"
    ;;
esac
