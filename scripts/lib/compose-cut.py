#!/usr/bin/env python3
"""
compose-cut.py — the cut algorithm for compose-as-CC-workflow (cycle-053).

A composition is NOT one workflow — it is a CHAIN of workflow-segments cut at
gate seams (BRIEF §1; SDD §3.3; gate-seam-clew-mechanics §1). This module is the
pure, offline transform that:

  1. validates the composition against the bridge schema (offline-robust:
     unresolvable remote $refs — e.g. the external hivemind labels schema — are
     treated as allow-anything, so "validate before spend" never needs the
     network), and
  2. cuts chain[] into maximal gate-free segments + the seams between them.

is_seam(stage) := stage.mode == "blocking"
              OR  stage.role in SEAM_ROLES           # {hard-stop, craft-gate, gate}
              OR  stage.hitl_by_nature == true        # v1.3 third seam class

The co-location rule (gate-seam-clew-mechanics §1.3-1.4): a craft-gate/gate stage
that is the upper bound `b` of an autonomous iterate pair [a, b] (NOT mode:blocking,
NOT hitl_by_nature) does NOT start a fresh empty seam — its autonomous test runs as
the loop's terminal step INSIDE the preceding segment, and the seam it produces is
TERMINAL (only the operator's verdict-after-the-loop is the human pause). This is
why the pilot (iterate:[[1,2]], stage-2 craft-gate) cuts to 1 iterating segment +
1 terminal seam, and feel-image (iterate:[[2,3]], stage-3 craft-gate) cuts to
2 segments + 1 seam.

CLI:
  compose-cut.py <comp.json|-> --schema <path> [--validate-only] [--seam-roles a,b,c]

  Input composition is JSON on argv path or stdin ('-'). YAML callers convert
  upstream (compose-dispatch.sh already parses YAML->JSON).

Exit codes: 0 ok · 1 schema-invalid / parse error · 64 usage.
Output (stdout): a JSON plan {ok, composition, segments, seams} (or {ok:false,...}).
"""
import argparse
import json
import sys

DEFAULT_SEAM_ROLES = ["hard-stop", "craft-gate", "gate"]
BLOCKING_MODE = "blocking"
# Roles whose gate test is AUTONOMOUS (can run headless inside the segment loop).
# A blocking mode or a hard-stop is never autonomous; hitl_by_nature is never
# autonomous (the operator does it by hand). craft-gate / gate tests are.
AUTONOMOUS_GATE_ROLES = {"craft-gate", "gate"}


def _eprint(*a):
    print(*a, file=sys.stderr)


def load_schema_validator(schema_path):
    """Build an offline-robust Draft2020 validator. Unresolvable remote $refs
    (loa.dev label schemas, etc.) resolve to an allow-anything schema so the
    cost-ordering gate never depends on the network. Returns (validator, None)
    or (None, reason) when jsonschema is unavailable."""
    try:
        import jsonschema
    except ImportError:
        return None, "jsonschema_not_installed"
    with open(schema_path) as f:
        schema = json.load(f)
    try:
        from referencing import Registry, Resource

        def retrieve(uri):  # any remote ref we can't see locally -> permissive
            return Resource.from_contents(
                {"$schema": "https://json-schema.org/draft/2020-12/schema"}
            )

        registry = Registry(retrieve=retrieve)
        return jsonschema.Draft202012Validator(schema, registry=registry), None
    except Exception:
        # referencing unavailable / older jsonschema — fall back to plain validator.
        return jsonschema.Draft202012Validator(schema), None


def validate(comp, schema_path):
    """Returns (ok: bool, errors: list[{path, msg}])."""
    validator, reason = load_schema_validator(schema_path)
    if validator is None:
        # No validator available: do not silently pass; report it so the caller
        # can decide. We return ok=True with a warning marker (validation skipped)
        # rather than blocking — matches compose-dispatch.sh's existing
        # graceful-degradation contract when jsonschema is absent.
        return True, [{"path": [], "msg": f"validation_skipped:{reason}"}]
    errors = sorted(validator.iter_errors(comp), key=lambda e: list(e.absolute_path))
    return (not errors), [
        {"path": list(e.absolute_path), "msg": e.message} for e in errors[:10]
    ]


def _stage_view(st):
    """Project a chain[] stage to the fields the emitter + seam protocol need."""
    return {
        "stage": st.get("stage"),
        "name": st.get("name", ""),
        "construct": st.get("construct"),
        "skill": st.get("skill", ""),
        "persona": st.get("persona"),
        "mode": st.get("mode", "fresh"),
        "role": st.get("role", "primary"),
        "reads": st.get("reads", []),
        "writes": st.get("writes", []),
        "hitl_by_nature": bool(st.get("hitl_by_nature", False)),
        "iterates_with": st.get("iterates_with"),
        "notes": st.get("notes", ""),
        "thinking_effort": st.get("thinking_effort"),
        "intelligence_tier": st.get("intelligence_tier"),
    }


def is_seam(st, seam_roles):
    return (
        st.get("mode") == BLOCKING_MODE
        or st.get("role") in seam_roles
        or bool(st.get("hitl_by_nature", False))
    )


def _seam_reason(st, seam_roles):
    if bool(st.get("hitl_by_nature", False)):
        return "hitl_by_nature"
    if st.get("mode") == BLOCKING_MODE:
        return "mode:blocking"
    role = st.get("role")
    if role in seam_roles:
        return f"role:{role}"
    return "unknown"


def _seam_kind(reason):
    return {
        "hitl_by_nature": "hitl-by-nature",
        "mode:blocking": "blocking",
        "role:hard-stop": "hard-stop",
        "role:craft-gate": "craft-gate",
        "role:gate": "gate",
    }.get(reason, "gate")


def cut(comp, seam_roles=None):
    """Run the cut walk. Returns {composition, segments, seams}.

    Raises ValueError when the composition has no chain[] (e.g. a pair-relay
    composition, which uses a different flow — pattern!='workflow chain')."""
    seam_roles = list(seam_roles or DEFAULT_SEAM_ROLES)
    chain = comp.get("chain")
    if not isinstance(chain, list) or not chain:
        raise ValueError(
            "composition has no chain[] — the cut algorithm applies to "
            "kind:workflow chain compositions (pair-relay uses a separate flow)"
        )

    # VALUE sort by stage number (schema permits half-stages like 1.5 / 6.5).
    stages = sorted((_stage_view(s) for s in chain), key=lambda s: float(s["stage"]))

    # iterate pairs: list of [a, b] (host schema $defs: array of 2-int arrays).
    iterate_pairs = []
    for pair in comp.get("iterate", []) or []:
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            iterate_pairs.append([pair[0], pair[1]])
    comp_cap = comp.get("max_iterations")
    comp_terminate = comp.get("terminate_when")
    comp_name = comp.get("name", "composition")

    def iterate_pair_for_gate(gate_stage, current_stages):
        """If gate_stage is the `b` of an iterate pair [a,b] whose `a` is in the
        current accumulating segment, return [a,b]; else None."""
        cur_nums = {s["stage"] for s in current_stages}
        for a, b in iterate_pairs:
            if b == gate_stage["stage"] and a in cur_nums:
                return [a, b]
        return None

    segments = []
    seams = []
    current = []

    def emit_segment(stages_list, iterate=None):
        idx = len(segments)
        seg = {
            "index": idx,
            "segment_name": f"{comp_name}.segment-{idx + 1}",
            "kind": "iterating" if iterate else "sequential",
            "stages": list(stages_list),
            "iterate": iterate,
            "max_iterations": comp_cap if iterate else None,
            "terminate_when": comp_terminate if iterate else None,
            "ends_at_seam": False,  # patched when a seam follows
        }
        segments.append(seg)
        return seg

    for st in stages:
        if is_seam(st, seam_roles):
            reason = _seam_reason(st, seam_roles)
            autonomous = (
                st.get("role") in AUTONOMOUS_GATE_ROLES
                and st.get("mode") != BLOCKING_MODE
                and not st.get("hitl_by_nature", False)
            )
            pair = iterate_pair_for_gate(st, current) if autonomous else None

            if pair is not None:
                # Co-locate: the gate's autonomous test is the loop tail INSIDE
                # the preceding segment; the seam is TERMINAL (verdict-after-loop).
                current.append(st)
                seg = emit_segment(current, iterate=pair)
                seg["ends_at_seam"] = True
                seams.append(
                    {
                        "after_segment": seg["index"],
                        "kind": _seam_kind(reason),
                        "reason": reason,
                        "seam_stage": st,
                        "terminal": True,
                        "autonomous_test_in_segment": True,
                        "clew_capable": True,
                    }
                )
                current = []
            else:
                # Standalone seam: the preceding autonomous span (if any) closes;
                # the seam-stage itself is a PURE PAUSE (operator-driven / blocking /
                # hard-stop / hitl-by-nature — never automated). Per mechanics §5,
                # a non-iterate gate's own test is NOT auto-co-located in MVP.
                preceding = None
                if current:
                    preceding = emit_segment(current)
                    preceding["ends_at_seam"] = True
                    current = []
                seams.append(
                    {
                        "after_segment": preceding["index"] if preceding else None,
                        "kind": _seam_kind(reason),
                        "reason": reason,
                        "seam_stage": st,
                        "terminal": False,
                        "autonomous_test_in_segment": False,
                        "clew_capable": True,
                    }
                )
        else:
            current.append(st)

    if current:
        emit_segment(current)

    # Warn when a construct-bearing stage was cut to a PURE seam and therefore will
    # NOT run as an agent — the silent-elision trap (#11). A craft-gate/gate stage
    # that names a real agent-construct but is not co-located into a preceding
    # iterate segment never executes; authors usually meant it to run. Surface it
    # (loud, non-fatal) instead of dropping the construct silently.
    #
    # Warn PER ELIDED STAGE — a seam stage is by construction never part of a segment.
    # Do NOT gate on whether the same construct runs in some OTHER stage: a different
    # stage using construct X running does not mean THIS elided stage runs (#15 fagan
    # finding — track stages, not construct membership).
    warnings = []
    for seam in seams:
        ss = seam.get("seam_stage") or {}
        c = ss.get("construct")
        if (
            c
            and c not in ("claude-code", "operator")
            and not seam.get("autonomous_test_in_segment")
        ):
            warnings.append(
                f"stage {ss.get('stage')} '{ss.get('name') or c}' (construct '{c}', "
                f"{seam.get('reason')}) is cut as a SEAM (operator pause) and will NOT "
                f"run as an agent. Use role:primary to run it as a stage, or set "
                f"construct:claude-code if it is a pure operator gate."
            )

    return {
        "composition": {
            "name": comp_name,
            "schema_version": comp.get("schema_version"),
            "kind": comp.get("kind"),
            "pattern": comp.get("pattern", "workflow"),
            "max_iterations": comp_cap,
            "iterate": iterate_pairs,
            "seam_roles": seam_roles,
        },
        "segments": segments,
        "seams": seams,
        "warnings": warnings,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="compose-as-workflow cut algorithm")
    ap.add_argument("composition", help="composition JSON path, or '-' for stdin")
    ap.add_argument("--schema", help="composition schema path (for validation)")
    ap.add_argument(
        "--validate-only",
        action="store_true",
        help="validate against schema; emit {ok, errors}; no cut",
    )
    ap.add_argument(
        "--seam-roles",
        default=",".join(DEFAULT_SEAM_ROLES),
        help="comma-separated roles that are seams (default: hard-stop,craft-gate,gate)",
    )
    args = ap.parse_args(argv)

    raw = sys.stdin.read() if args.composition == "-" else open(args.composition).read()
    try:
        comp = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "errors": [{"path": [], "msg": f"bad_json:{e}"}]}))
        return 1

    if args.schema:
        ok, errors = validate(comp, args.schema)
        if not ok:
            print(json.dumps({"ok": False, "stage": "schema", "errors": errors}))
            return 1
        if args.validate_only:
            print(json.dumps({"ok": True, "errors": errors}))
            return 0
    elif args.validate_only:
        print(json.dumps({"ok": False, "errors": [{"path": [], "msg": "no --schema given"}]}))
        return 64

    seam_roles = [r.strip() for r in args.seam_roles.split(",") if r.strip()]
    try:
        plan = cut(comp, seam_roles=seam_roles)
    except ValueError as e:
        print(json.dumps({"ok": False, "errors": [{"path": ["chain"], "msg": str(e)}]}))
        return 1
    plan["ok"] = True
    print(json.dumps(plan))
    return 0


if __name__ == "__main__":
    sys.exit(main())
