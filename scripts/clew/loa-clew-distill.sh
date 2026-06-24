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
# Naming note: the filename's "distill" is the ACTION verb (capture fills, distill
# drains), NOT the operator command. The command is /clew (~/.claude/skills/clew);
# /distill is an unrelated skill (Arneson's session compressor). File = action; cmd = /clew.
#
# Governance (Ostrom / the design): there is NO loop here. The OPERATOR names ONE construct
# per invocation; the fan-out is the operator's eye, not a script — so a whole-network sweep
# can never open N PRs in one night. SENSE is free; ACT is operator-paced.
#
#   loa-clew-distill.sh --list                       packs with undistilled (pending) clews
#   loa-clew-distill.sh <construct> [--show]         pending clews + source repo + target SKILL paths
#   loa-clew-distill.sh <construct> --mark-proposed <clew-id> [--pr <url>]
#   loa-clew-distill.sh <construct> --retag <clew-id> --to-skill <skill> [--to-construct <construct>]
#                                                    re-home a mis-captured clew: rewrite the target +
#                                                    re-derive `confirmed` against the real pack (schema-
#                                                    validated). Cross-construct = MOVE the ledger line.
set -uo pipefail
DRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_ROOT="$(cd "$DRAIN_DIR/../.." && pwd)"
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
    action="show"; clewid=""; prurl=""; CBD=""; toskill=""; toconstruct=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --show) action="show"; shift ;;
        --mark-proposed) action="mark"; clewid="${2:-}"; shift 2 || shift $# ;;
        --mark-distilled) action="distill"; clewid="${2:-}"; shift 2 || shift $# ;;
        --retag) action="retag"; clewid="${2:-}"; shift 2 || shift $# ;;
        --to-skill) toskill="${2:-}"; shift 2 || shift $# ;;
        --to-construct) toconstruct="${2:-}"; shift 2 || shift $# ;;
        --pr) prurl="${2:-}"; shift 2 || shift $# ;;
        --compose-base-dir) CBD="${2:-}"; shift 2 || shift $# ;;
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

    # --retag (re-home a mis-captured clew). Capture historically stamped target.confirmed
    # blindly, and the >>clew@<construct>/<skill> marker accepts any string — so clews land
    # on skills that don't exist or under the wrong construct. This is the SAFE correction:
    # rewrite target.{construct,skill_slug} + re-derive `confirmed` against the real pack,
    # schema-validated. Cross-construct = MOVE the ledger line (append-to-target THEN remove-
    # from-source, so a crash duplicates — recoverable — and never loses the clew).
    if [ "$action" = "retag" ]; then
      [ -n "$clewid" ] && [ -n "$toskill" ] || { echo "usage: loa-clew-distill.sh $construct --retag <clew-id> --to-skill <skill> [--to-construct <construct>]" >&2; exit 1; }
      to_construct="${toconstruct:-$construct}"
      [[ "$toskill" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "  ✗ invalid --to-skill '$toskill' (must match ^[a-z][a-z0-9-]*\$)" >&2; exit 1; }
      [[ "$to_construct" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "  ✗ invalid --to-construct '$to_construct'" >&2; exit 1; }
      # re-derive `confirmed` the SAME way capture now does: the skill dir must exist in the pack.
      confirmed=false
      [ -d "$PACKS/$to_construct/skills/$toskill" ] && confirmed=true
      retag_schema="$DRAIN_DIR/learnings-construct.schema.json"
      # 1. extract + rewrite + schema-validate the target clew → the new compact line.
      newline="$(CLEW_ID="$clewid" TO_CONSTRUCT="$to_construct" TO_SKILL="$toskill" CONFIRMED="$confirmed" SCHEMA="$retag_schema" python3 - "$ledger" <<'PY'
import json, os, sys
try: import jsonschema
except ImportError: sys.stderr.write("retag: python 'jsonschema' not available\n"); sys.exit(70)
cid=os.environ["CLEW_ID"]; tc=os.environ["TO_CONSTRUCT"]; ts=os.environ["TO_SKILL"]
confirmed=os.environ["CONFIRMED"]=="true"; schema=json.load(open(os.environ["SCHEMA"]))
found=None
for ln in open(sys.argv[1], errors='replace'):
    ln=ln.strip()
    if not ln: continue
    try: d=json.loads(ln)
    except Exception: continue
    if d.get("id")==cid:
        d.setdefault("target", {})
        d["target"]["construct"]=tc; d["target"]["skill_slug"]=ts; d["target"]["confirmed"]=confirmed
        found=d; break
if found is None: sys.exit(3)
try: jsonschema.validate(found, schema)
except jsonschema.ValidationError as e:
    sys.stderr.write("retag: rewritten clew is schema-invalid: %s\n" % e.message); sys.exit(2)
sys.stdout.write(json.dumps(found, separators=(",", ":"), ensure_ascii=False))
PY
)"
      rc=$?
      [ "$rc" -eq 3 ] && { echo "  ✗ clew-id '$clewid' not found in $construct ledger" >&2; exit 1; }
      [ "$rc" -ne 0 ] && { echo "  ✗ retag aborted (rc=$rc)" >&2; exit 1; }

      if [ "$to_construct" = "$construct" ]; then
        # within-construct: rewrite the line in place (tmp+mv, matching --mark-proposed).
        tmp="$(mktemp)"
        CLEW_ID="$clewid" NEWLINE="$newline" python3 - "$ledger" > "$tmp" <<'PY'
import json, os, sys
cid=os.environ["CLEW_ID"]; newline=os.environ["NEWLINE"]
for ln in open(sys.argv[1], errors='replace'):
    raw=ln.rstrip("\n")
    if not raw.strip(): continue
    try: d=json.loads(raw)
    except Exception: print(raw); continue
    print(newline if d.get("id")==cid else raw)
PY
        mv "$tmp" "$ledger"
        echo "  ✓ retag $construct/$clewid → skill '$toskill' (confirmed=$confirmed)"
      else
        # cross-construct: append to target via the locked + schema-validating canonical
        # primitive, THEN remove from source. append-first = a crash duplicates (recoverable),
        # never loses the clew. The id keeps its capture-construct as a provenance trace.
        if ! bash "$DRAIN_DIR/ledger-append.sh" "$to_construct" "$newline"; then
          echo "  ✗ retag aborted: could not append to '$to_construct' ledger — source unchanged (no loss)" >&2; exit 1
        fi
        tmp="$(mktemp)"
        CLEW_ID="$clewid" python3 - "$ledger" > "$tmp" <<'PY'
import json, os, sys
cid=os.environ["CLEW_ID"]
for ln in open(sys.argv[1], errors='replace'):
    raw=ln.rstrip("\n")
    if not raw.strip(): continue
    try: d=json.loads(raw)
    except Exception: print(raw); continue
    if d.get("id")==cid: continue
    print(raw)
PY
        mv "$tmp" "$ledger"
        echo "  ✓ retag $clewid: $construct → $to_construct/$toskill (confirmed=$confirmed); removed from $construct ledger"
      fi
      [ "$confirmed" = false ] && echo "  ⚠ '$toskill' is not a skill of '$to_construct' — target QUARANTINED (create the skill, or re-retag to a real one)" >&2
      exit 0
    fi

    # --mark-distilled (bd-uze A2/A3): the GENOME ADMISSION transition. On operator
    # merge of a teaching PR, admit the clew to the construct's genome IFF it carries
    # a run_id with a valid_run verdict (else quarantine to SUSPECTS.jsonl). Admission
    # computes the next genome_hash and writes it to the SOURCE construct.yaml. The
    # heavy lifting is in clew-genome-admit.py (testable); this branch resolves paths.
    if [ "$action" = "distill" ]; then
      [ -n "$clewid" ] || { echo "usage: loa-clew-distill.sh $construct --mark-distilled <clew-id> [--pr <url>] [--compose-base-dir <dir>]" >&2; exit 1; }
      admit="$DRAIN_DIR/clew-genome-admit.py"
      schema="$DRAIN_DIR/learnings-construct.schema.json"
      verify_run="$SUBSTRATE_ROOT/scripts/compose-verify-run.sh"
      # genome-chain.py lives in loa-constructs (home of the chain core). Resolve:
      # explicit env → SRC_ROOT/loa-constructs → fail loud (cannot compute without it).
      genome_chain="${LOA_GENOME_CHAIN:-$SRC_ROOT/loa-constructs/.claude/scripts/genome-chain.py}"
      src="$SRC_ROOT/construct-$construct"
      construct_yaml="$src/construct.yaml"
      suspects="$PACKS/$construct/SUSPECTS.jsonl"
      for f in "$admit:genome-admit helper" "$genome_chain:genome-chain.py (loa-constructs)" "$verify_run:compose-verify-run.sh" "$construct_yaml:source construct.yaml"; do
        p="${f%%:*}"; what="${f#*:}"
        [ -f "$p" ] || { echo "  ✗ cannot distill: missing $what at $p" >&2; exit 1; }
      done
      cbd_args=()
      [ -n "$CBD" ] && cbd_args+=(--compose-base-dir "$CBD")
      python3 "$admit" \
        --clew-id "$clewid" \
        --ledger "$ledger" \
        --construct-yaml "$construct_yaml" \
        --schema "$schema" \
        --genome-chain "$genome_chain" \
        --verify-run "$verify_run" \
        --suspects "$suspects" \
        ${prurl:+--pr "$prurl"} \
        "${cbd_args[@]}"
      exit $?
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
