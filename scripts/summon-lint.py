#!/usr/bin/env python3
# =============================================================================
# summon-lint.py — Summoning-incantation quality sensor
# =============================================================================
# The joints where laplas summons the spirits (constructs) carry an authored
# *incantation*: the prose that tells a summoned construct what to do. This is
# the `notes:` of a workflow stage, the `convergence_criteria:` of a pair-relay,
# and the composition `intent:` / `terminate_when:`. None of it is runtime-
# consumed by the emitter (it reads role/construct/persona/tier/schema only) —
# so this prose is for the /compose driver's resolution and the next maintainer.
#
# This sensor scores each incantation on five dimensions — the /enhance PTCF
# frame (Task, Read/Write, Format) plus the two that keep a summoned spirit on
# the rails: an explicit Success criterion and an Anti-drift guardrail.
#
# DETECTOR-tier: it SURFACES, it never gates. Always exits 0. Heuristic by
# design — a low score is a prompt to look, not a verdict. It scores only the
# prose surfaces yaml exposes; pair-relay per-stage role lines are inline
# comments (stripped by the parser) and are reported as comment-only, not scored.
#
#   Usage: python3 scripts/summon-lint.py [compositions_dir]   (default: compositions/)
# =============================================================================
import os
import re
import sys
import glob

try:
    import yaml
except ImportError:
    sys.stderr.write("summon-lint: PyYAML not available; skipping (exit 0)\n")
    sys.exit(0)

# --- ANSI (no deps; honor NO_COLOR) ---
_C = not os.environ.get("NO_COLOR") and sys.stdout.isatty()
def c(s, code): return f"\033[{code}m{s}\033[0m" if _C else s
def dim(s):     return c(s, "2")
def bold(s):    return c(s, "1")

# --- Dimension detectors (lightweight signal, like /enhance's PTCF detection) ---
TASK_VERBS = r"\b(implement|review|name|adjust|validate|compare|critique|select|" \
             r"declare|confirm|inscribe|audit|apply|emit|hunt|check|close|pick|resolve|run)\b"
RW_SIGNAL  = r"\b(READS?|WRITES?|emit|emits|returns|inputs?|outputs?|reads:|writes:|envelope)\b"
SUCCESS    = r"\b(DONE|converg\w+|complete[ds]?|criteri\w+|approved|closed|resolve[ds]?|" \
             r"final-cycle|terminate|accepts?)\b"
ANTIDRIFT  = r"\b(do not|don'?t|never|not\b|only|strictly|no free-form|not a shortlist|" \
             r"NOT\b|in limbo|drift|scope creep|unless)\b"

def score_incantation(text):
    t = text or ""
    dims = {
        "task":      bool(re.search(TASK_VERBS, t, re.I)),
        "read/write": bool(re.search(RW_SIGNAL, t)),
        "success":   bool(re.search(SUCCESS, t, re.I)),
        "anti-drift": bool(re.search(ANTIDRIFT, t)),
        "specific":  len(t.split()) >= 18,   # enough words to be concrete, not a stub
    }
    return dims

def tile(dims):
    return "".join("▰" if dims[k] else dim("▱") for k in
                   ("task", "read/write", "success", "anti-drift", "specific"))

def grade(n):
    if n >= 5: return c("strong", "32")
    if n >= 3: return c("ok    ", "33")
    return c("thin  ", "31")

def joints_for(comp):
    """Yield (label, incantation_text) for each summoning joint in a composition."""
    if comp.get("intent"):
        yield ("intent", comp["intent"])
    if comp.get("terminate_when"):
        yield ("terminate_when", comp["terminate_when"])
    if comp.get("convergence_criteria"):
        yield ("convergence_criteria", comp["convergence_criteria"])
    for st in comp.get("chain", []) or []:
        name = st.get("name") or st.get("construct") or st.get("stage")
        if st.get("notes"):
            yield (f"stage {st.get('stage','?')} ({st.get('construct','?')}/{name}) notes", st["notes"])

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "compositions"
    files = sorted(glob.glob(os.path.join(root, "**", "*.yaml"), recursive=True) +
                   glob.glob(os.path.join(root, "**", "*.yml"), recursive=True))
    if not files:
        print(f"summon-lint: no compositions in {root}/")
        return 0

    print(bold("∴ summon-lint") + dim("  — incantation quality at the summoning joints "
          "(task · read/write · success · anti-drift · specific)"))
    print(dim("  surfaces, never gates · heuristic · pair-relay role lines are comment-only (not scored)\n"))

    total, scored = 0, 0
    for f in files:
        try:
            with open(f) as fh:
                comp = yaml.safe_load(fh) or {}
        except Exception as e:
            print(f"  {os.path.basename(f):28} {c('parse-error', '31')}: {e}")
            continue
        shape = "workflow" if comp.get("chain") else (comp.get("pattern") or "?")
        print(bold(f"  {os.path.relpath(f, root)}") + dim(f"  [{shape}]"))
        any_joint = False
        for label, text in joints_for(comp):
            any_joint = True
            dims = score_incantation(text)
            n = sum(dims.values())
            total += n; scored += 1
            print(f"    {tile(dims)}  {grade(n)} {dim('·')} {label}")
        if shape == "pair-relay":
            seq = comp.get("sequence", []) or []
            print(dim(f"    (+{len(seq)} per-stage role incantations live in inline comments — author-readable, not scored)"))
        if not any_joint and shape != "pair-relay":
            print(dim("    (no scorable incantation surfaces found)"))
        print()

    if scored:
        avg = total / scored
        print(dim(f"  {scored} incantations scored · mean {avg:.1f}/5"))
    return 0   # DETECTOR-tier: always 0

if __name__ == "__main__":
    sys.exit(main())
