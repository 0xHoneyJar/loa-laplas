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
# Count INVOKABLE agent types, not adapter FILES (#12). An adapter with an empty or
# missing `description:` (or `name:`) is SILENTLY DROPPED from the agent registry —
# the file exists and the old file-count reported it green, but agentType resolution
# fails at run time (this is the root cause of the construct-arneson silent drop).
# Readiness must be true at the point of consumption, not asserted by a count.
n_files=0; n_ok=0; dropped=""
shopt -s nullglob
for f in "$AGENTS_DIR"/construct-*.md; do
    n_files=$((n_files + 1))
    # Read name/description from the YAML FRONTMATTER ONLY — the block between the
    # first `---` and the next `---`, which is what the agent registry consumes.
    # Scanning the whole file would let body / example lines satisfy the check even
    # when the frontmatter fields are missing, preserving the false-green this fix
    # exists to kill (fagan review of #12).
    fm=$(awk 'NR==1 && $0=="---"{infm=1; next} infm && $0=="---"{exit} infm' "$f")
    nm=$(printf '%s\n' "$fm" | grep -m1 '^name:' | sed 's/^name:[[:space:]]*//; s/^"//; s/"$//')
    desc=$(printf '%s\n' "$fm" | grep -m1 '^description:' | sed 's/^description:[[:space:]]*//; s/^"//; s/"$//')
    if [[ -n "$nm" && -n "$desc" ]]; then
        n_ok=$((n_ok + 1))
    else
        dropped="$dropped $(basename "$f" .md | sed 's/^construct-//')"
    fi
done
shopt -u nullglob
if [[ "$n_files" -eq 0 ]]; then
    row "$red" "adapters" "no construct-* adapters in $AGENTS_DIR — agentTypes won't resolve"
    hard_fail=1
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
