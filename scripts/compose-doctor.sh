#!/usr/bin/env bash
# =============================================================================
# compose-doctor.sh — "is Form C ready to dogfood?" health check (cycle-053)
# =============================================================================
# One command that answers: can I run a Loa composition via Form C, right now,
# from this session? Embodies the substrate's observability thesis — it doesn't
# guess, it checks every surface the /compose skill depends on and reports the
# ground truth. Read-only: it compiles the pilot to a TEMP dir and never spends a
# token (no agent runs).
#
# Checks:
#   1. runtime      — the stable install symlink resolves to compose-dispatch.sh
#   2. skill        — the /compose skill is installed where Claude auto-lists it
#   3. schema       — the bridge composition schema is reachable AND is >= v1.3
#                     (carries hitl_by_nature, the third seam class)
#   4. adapters     — construct-<slug> agents exist globally (the workers)
#   5. node         — present (emit syntax/determinism gate + dry-run harness)
#   6. compile      — the pilot composition cuts + emits + passes the gate
#
# Usage:  compose-doctor.sh [--json]
# Exit:   0 all green · 1 a hard dependency is missing (cannot dogfood)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JSON=0; [[ "${1:-}" == "--json" ]] && JSON=1

RUNTIME="${LOA_ROOMS_RUNTIME:-$HOME/.loa/runtime/construct-rooms-substrate}"
SKILL="$HOME/.claude/skills/compose/SKILL.md"
SCHEMA="${LOA_COMPOSE_SCHEMA:-$HOME/Documents/GitHub/loa-constructs/.claude/schemas/runtime/composition.schema.json}"
AGENTS_DIR="$HOME/.claude/agents"
PILOT="$REPO_ROOT/compositions/code-implement-and-review.yaml"

green="✓"; amber="•"; red="✗"
hard_fail=0
declare -a ROWS

row() { ROWS+=("$1|$2|$3"); }   # status|name|detail

# 1. runtime ------------------------------------------------------------------
if [[ -x "$RUNTIME/scripts/compose-dispatch.sh" ]]; then
    row "$green" "runtime" "$RUNTIME"
else
    row "$red" "runtime" "compose-dispatch.sh not reachable at $RUNTIME (set LOA_ROOMS_RUNTIME or fix the ~/.loa/runtime symlink)"
    hard_fail=1
fi

# 2. skill --------------------------------------------------------------------
if [[ -f "$SKILL" ]]; then
    row "$green" "skill" "/compose installed (Claude auto-lists it)"
else
    row "$amber" "skill" "/compose skill not at $SKILL — Claude won't auto-reach for Form C"
fi

# 3. schema (>= v1.3) ---------------------------------------------------------
if [[ -f "$SCHEMA" ]]; then
    ver="$(python3 -c "import json;print((json.load(open('$SCHEMA'))['properties']['schema_version']['enum'] or ['?'])[-1])" 2>/dev/null || echo '?')"
    hitl="$(python3 -c "import json;print('hitl_by_nature' in json.load(open('$SCHEMA'))['\$defs']['Stage']['properties'])" 2>/dev/null || echo False)"
    if [[ "$hitl" == "True" ]]; then
        row "$green" "schema" "bridge schema v$ver (hitl_by_nature present)"
    else
        row "$amber" "schema" "schema reachable (v$ver) but missing hitl_by_nature — land loa-constructs schema v1.3"
    fi
else
    row "$amber" "schema" "bridge schema not found ($SCHEMA) — Form C still compiles, but skips validate-before-spend"
fi

# 4. adapters -----------------------------------------------------------------
# Count INVOKABLE agent types, not adapter FILES (#12). An adapter whose YAML
# frontmatter lacks a non-empty `name` or `description` is SILENTLY DROPPED from the
# agent registry — the file exists and the old file-count reported it green, but
# agentType resolution fails at run time (root cause of the construct-arneson silent
# drop). Readiness must be true at the point of consumption, not asserted by a count.
#
# Parse the frontmatter with a REAL YAML parser (the registry's own contract), NOT
# grep/sed: regex YAML-parsing false-greens on quoting/empty-value variants —
# `description: ''`, `description:` (null), `'' # comment`, a missing closing `---`,
# etc. (fagan #12, rounds 2-5). NO regex fallback: guessing at YAML always reintroduces
# some false-green. A leading `--- … ---` block (closing delimiter required) is decoded
# by PyYAML; both fields must be non-empty strings. If PyYAML is absent — already a
# broken state, since compose-dispatch needs it to parse compositions at all — the scan
# reports SKIPPED (sentinel n_ok=-1) and the doctor warns rather than guessing.
adapter_scan=$(python3 - "$AGENTS_DIR" <<'PY'
import sys, os, re, glob
try:
    import yaml
except Exception:
    yaml = None

files = sorted(glob.glob(os.path.join(sys.argv[1], "construct-*.md")))
if yaml is None:
    print("%d\t-1\t" % len(files))   # cannot validate without a YAML parser; never guess
    sys.exit(0)

n_ok = 0
dropped = []
for f in files:
    try:
        text = open(f, encoding="utf-8", errors="replace").read()
    except Exception:
        text = ""
    # Frontmatter = a LEADING `--- … ---` block; the closing delimiter is required.
    m = re.match(r"^---\n(.*?)\n---\s*\n", text, re.DOTALL)
    ok = False
    if m:
        try:
            data = yaml.safe_load(m.group(1))
            if isinstance(data, dict):
                nm, desc = data.get("name"), data.get("description")
                ok = (isinstance(nm, str) and nm.strip() != ""
                      and isinstance(desc, str) and desc.strip() != "")
        except Exception:
            ok = False
    if ok:
        n_ok += 1
    else:
        dropped.append(os.path.basename(f)[:-3].replace("construct-", "", 1))
print("%d\t%d\t%s" % (len(files), n_ok, " ".join(dropped)))
PY
)
IFS=$'\t' read -r n_files n_ok dropped <<< "$adapter_scan"
if [[ "$n_files" -eq 0 ]]; then
    row "$red" "adapters" "no construct-* adapters in $AGENTS_DIR — agentTypes won't resolve"
    hard_fail=1
elif [[ "$n_ok" -eq -1 ]]; then
    # PyYAML absent — cannot validate frontmatter without guessing (and guessing is
    # what reintroduced the false-greens). Warn honestly rather than claim invokability.
    row "$amber" "adapters" "$n_files adapter files present, but invokability NOT verified — PyYAML unavailable (pip install pyyaml; compose-dispatch needs it too)"
elif [[ -n "$dropped" ]]; then
    # A detected-but-dropped adapter is a real readiness FAILURE — agentType resolution
    # is broken for that construct — so fail the gate, don't merely warn (fagan review
    # of #12: amber-without-hard_fail is a yellower false-green that still exits 0, the
    # exact pathology this fix exists to kill).
    row "$red" "adapters" "$n_ok/$n_files construct-* agents INVOKABLE — these would be SILENTLY DROPPED by the registry (empty name/description; regenerate via construct-adapter-gen):$dropped"
    hard_fail=1
else
    row "$green" "adapters" "$n_ok construct-* agents invokable (frontmatter-validated, not just file-counted)"
fi

# 5. node ---------------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
    row "$green" "node" "$(node --version)"
else
    row "$red" "node" "node not found — cannot syntax-gate or dry-run emitted segments"
    hard_fail=1
fi

# 6. compile the pilot (no token spend) ---------------------------------------
if [[ -x "$RUNTIME/scripts/compose-dispatch.sh" && -f "$PILOT" ]]; then
    TMP="$(mktemp -d)"
    schema_env=(); [[ -f "$SCHEMA" ]] && schema_env=("LOA_COMPOSE_SCHEMA=$SCHEMA")
    if env LOA_PROJECT_ROOT="$TMP" "${schema_env[@]}" \
        "$RUNTIME/scripts/compose-dispatch.sh" "$PILOT" --form-c --run-id doctor --json >/dev/null 2>&1 \
        || [[ $? -eq 3 ]]; then
        seg="$TMP/.run/compose/doctor/workflows/code-implement-and-review.segment-1.workflow.js"
        if [[ -f "$seg" ]] && { ! command -v node >/dev/null 2>&1 || node "$RUNTIME/scripts/lib/workflow-syntax-check.js" "$seg" >/dev/null 2>&1; }; then
            row "$green" "compile" "pilot → 1 segment + terminal seam, emit passes the syntax/determinism gate"
        else
            row "$red" "compile" "pilot compiled but the emitted segment failed the gate"
            hard_fail=1
        fi
    else
        row "$red" "compile" "pilot failed to compile (see: $RUNTIME/scripts/compose-dispatch.sh $PILOT --form-c)"
        hard_fail=1
    fi
    rm -rf "$TMP"
else
    row "$amber" "compile" "skipped (runtime or pilot composition missing)"
fi

# report ----------------------------------------------------------------------
if [[ "$JSON" == "1" ]]; then
    printf '{"ready":%s,"checks":[' "$([[ $hard_fail -eq 0 ]] && echo true || echo false)"
    for i in "${!ROWS[@]}"; do
        IFS='|' read -r st nm dt <<< "${ROWS[$i]}"
        [[ $i -gt 0 ]] && printf ','
        printf '{"status":"%s","name":"%s","detail":%s}' \
            "$([[ "$st" == "$green" ]] && echo ok || { [[ "$st" == "$red" ]] && echo fail || echo warn; })" \
            "$nm" "$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$dt")"
    done
    printf ']}\n'
else
    echo "compose-doctor — Form C dogfood readiness"
    echo "─────────────────────────────────────────"
    for r in "${ROWS[@]}"; do IFS='|' read -r st nm dt <<< "$r"; printf '  %s  %-9s %s\n' "$st" "$nm" "$dt"; done
    echo "─────────────────────────────────────────"
    if [[ $hard_fail -eq 0 ]]; then
        echo "  READY — run a composition with the /compose skill."
    else
        echo "  NOT READY — resolve the ✗ rows above."
    fi
fi
exit $hard_fail
