#!/usr/bin/env python3
"""render-bridge-findings.py — verifiable-compose Epic A sprint-2 (RFC #56).

Projects a structured bridge-findings report (the source of truth the
rigorous-review composition's BEAUVOIR synthesis stage writes to
``.run/rigorous-review.json``) into BEAUVOIR-house-style markdown, wrapping a
machine-readable JSON block in the ``<!-- bridge-findings-start -->`` /
``<!-- bridge-findings-end -->`` markers that ``bridge-findings-parser.sh`` +
``post-pr-triage.sh`` already consume (zero net-new consumer code, SDD §2.4).

The structured JSON stays the source of truth; this markdown is a *projection*.
The embedded machine block is the projection's contract surface: severity is
UPPER-CASED (the parser weights/aggregates on ``CRITICAL``/``HIGH``/…) and each
finding gains an ``id`` + ``title`` (``post-pr-triage.sh`` reads ``.id`` /
``.severity`` / ``.title``). ``schema_version`` is the integer ``2`` because the
parser round-trips it through ``jq -r`` → ``--argjson`` (a string would break).

Anchor resolution — presence ≠ grounding (SDD §2.6 / Flatline B1):
the schema proves a finding *has* an ``anchor``; it cannot prove the anchor is
*real* (``foo.ts:999`` validates identically to a true reference). Every finding
whose anchor is a *code* reference (``file:line`` or a file-citing text anchor)
is resolved against the reviewed tree. A dangling code anchor fails the render
(``--on-dangling fail``, the default) or downgrades the finding to ``claimed``
(``--on-dangling downgrade``). A finding whose anchor carries no file reference
is ``claimed`` (non-code synthesis) and skips resolution — the step never forces
a code lens onto strategy/research work.

Deterministic: no time, no randomness. Findings are severity-ranked, stable
within a rank; the JSON block is emitted with sorted keys.
"""
import argparse
import json
import os
import re
import sys

SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
START_MARKER = "<!-- bridge-findings-start -->"
END_MARKER = "<!-- bridge-findings-end -->"
SCHEMA_VERSION = 2  # integer — round-trips through the parser's jq -r → --argjson


def _is_pathlike(s):
    """A path has a directory separator or a file extension."""
    return "/" in s or re.search(r"\.[A-Za-z0-9]+$", s) is not None


def classify_anchor(anchor):
    """Return (kind, file, locator).

    kind ∈ {"file_line", "file_text", "claimed"}. ``file_line``/``file_text`` are
    code-grounded ("observed") and must resolve; ``claimed`` skips resolution.
    """
    a = (anchor or "").strip()
    if ":" in a:
        left, right = a.rsplit(":", 1)
        left, right = left.strip(), right.strip()
        if _is_pathlike(left):
            if right.isdigit():
                return ("file_line", left, int(right))
            return ("file_text", left, right.strip("\"'"))
    return ("claimed", None, None)


def _confined(tree, file):
    """Resolve file under tree, refusing escapes (symlinks included).

    Returns the real path iff it stays within ``realpath(tree)``, else None.
    AUD-S2-1: the anchor is LLM-produced and the rendered reason strings are
    posted to PR comments downstream, so an unconfined read would be a file-read
    oracle (existence/line-count/substring) exfiltrating via the review. Refuse.
    """
    tree_root = os.path.realpath(tree)
    path = os.path.realpath(os.path.join(tree, file))
    if path == tree_root or path.startswith(tree_root + os.sep):
        return path
    return None


def resolve_anchor(kind, file, locator, tree):
    """Return (resolved: bool, reason: str)."""
    if kind == "claimed":
        return (True, "claimed — resolution skipped")
    path = _confined(tree, file)
    if path is None:
        # Constant reason — must NOT confirm existence/content of the escaping path.
        return (False, "anchor escapes the reviewed tree — not resolved")
    if not os.path.isfile(path):
        return (False, f"file not found: {file}")
    if kind == "file_line":
        with open(path, "r", errors="replace") as fh:
            n_lines = sum(1 for _ in fh)
        if 1 <= locator <= n_lines:
            return (True, f"{file}:{locator} resolves ({n_lines} lines)")
        return (False, f"{file} has {n_lines} lines, no line {locator}")
    # file_text
    with open(path, "r", errors="replace") as fh:
        content = fh.read()
    if locator and locator in content:
        return (True, f"text anchor found in {file}")
    return (False, f"text not found in {file}: {locator!r}")


def derive_title(issue):
    """First line of the issue, collapsed and length-bounded. Deterministic."""
    one = re.sub(r"\s+", " ", (issue or "").replace("\n", " ")).strip()
    if len(one) <= 80:
        return one or "(no issue text)"
    return one[:77].rstrip() + "..."


def _cell(text):
    """Make a value safe for a markdown table cell."""
    return re.sub(r"\s+", " ", str(text)).replace("|", "\\|").strip()


def load_report(path):
    with open(path, "r") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError("top-level findings report must be a JSON object")
    for key in ("summary", "findings", "claims_ledger"):
        if key not in data:
            raise ValueError(f"missing required top-level field: {key}")
    if not isinstance(data["findings"], list):
        raise ValueError("findings must be an array")
    if not isinstance(data["claims_ledger"], list):
        raise ValueError("claims_ledger must be an array")
    return data


def annotate(findings, tree, on_dangling):
    """Resolve every finding's anchor; return (annotated, dangling).

    annotated findings carry ``_resolution`` ∈ {observed, claimed, downgraded}.
    dangling is the list of (index, finding, reason) for unresolved code anchors.
    """
    annotated, dangling = [], []
    for idx, f in enumerate(findings):
        kind, file, locator = classify_anchor(f.get("anchor", ""))
        ok, reason = resolve_anchor(kind, file, locator, tree)
        item = dict(f)
        item["_orig_index"] = idx
        if kind == "claimed":
            item["_resolution"] = "claimed"
        elif ok:
            item["_resolution"] = "observed"
        else:
            dangling.append((idx, f, reason))
            item["_resolution"] = "downgraded" if on_dangling == "downgrade" else "observed"
        item["_reason"] = reason
        annotated.append(item)
    return annotated, dangling


def rank_key(item):
    sev = str(item.get("severity", "")).lower()
    return (SEVERITY_RANK.get(sev, 99), item["_orig_index"])


def build_machine_findings(annotated):
    out = []
    for n, f in enumerate(annotated, start=1):
        rec = {
            "id": f"finding-{n}",
            "severity": str(f.get("severity", "")).upper(),
            "title": derive_title(f.get("issue", "")),
            "dimension": f.get("dimension", ""),
            "anchor": f.get("anchor", ""),
            "issue": f.get("issue", ""),
            "recommendation": f.get("recommendation", ""),
            "resolution": f["_resolution"],
        }
        for opt in ("decision_trail", "industry_parallel", "metaphor"):
            if f.get(opt):
                rec[opt] = f[opt]
        out.append(rec)
    return out


def render_markdown(report, annotated):
    machine_findings = build_machine_findings(annotated)
    lines = []
    lines.append("# Rigorous Review")
    lines.append("")
    lines.append(report.get("summary", "").strip() or "_No summary provided._")
    lines.append("")
    lines.append(f"## Findings ({len(annotated)})")
    lines.append("")
    if not annotated:
        lines.append("_No findings recorded._")
        lines.append("")
    for n, f in enumerate(annotated, start=1):
        sev = str(f.get("severity", "")).upper()
        lines.append(f"### {n}. [{sev}] {derive_title(f.get('issue', ''))}")
        lines.append(f"- **Dimension**: {f.get('dimension', '')}")
        lines.append(f"- **Anchor**: `{f.get('anchor', '')}` — _{f['_resolution']}_ ({f['_reason']})")
        lines.append(f"- **Issue**: {f.get('issue', '')}")
        lines.append(f"- **Recommendation**: {f.get('recommendation', '')}")
        if f.get("decision_trail"):
            lines.append(f"- **Decision trail**: {f['decision_trail']}")
        if f.get("industry_parallel"):
            lines.append(f"- **Industry parallel**: {f['industry_parallel']}")
        if f.get("metaphor"):
            lines.append(f"- **Metaphor**: {f['metaphor']}")
        lines.append("")

    lines.append("## Positive callouts")
    lines.append("")
    callouts = report.get("positive_callouts") or []
    if callouts:
        for c in callouts:
            lines.append(f"- {c}")
    else:
        lines.append("_None recorded._")
    lines.append("")

    lines.append("## Claims ledger")
    lines.append("")
    lines.append("| # | Claim | Grounding | Tag |")
    lines.append("|---|-------|-----------|-----|")
    for i, c in enumerate(report.get("claims_ledger") or [], start=1):
        lines.append(
            f"| {i} | {_cell(c.get('claim', ''))} | {_cell(c.get('grounding', ''))} | {_cell(c.get('tag', ''))} |"
        )
    lines.append("")

    machine = {
        "schema_version": SCHEMA_VERSION,
        "summary": report.get("summary", ""),
        "findings": machine_findings,
        "positive_callouts": callouts,
        "claims_ledger": report.get("claims_ledger") or [],
    }
    lines.append(START_MARKER)
    lines.append("```json")
    lines.append(json.dumps(machine, indent=2, sort_keys=True, ensure_ascii=False))
    lines.append("```")
    lines.append(END_MARKER)
    lines.append("")
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description="Render structured bridge-findings → BEAUVOIR markdown.")
    p.add_argument("--input", required=True, help="structured bridge-findings JSON (source of truth)")
    p.add_argument("--output", help="output markdown path (default: stdout)")
    p.add_argument("--tree", default=".", help="reviewed tree root for anchor resolution (default: cwd)")
    p.add_argument(
        "--on-dangling",
        choices=["fail", "downgrade"],
        default="fail",
        help="dangling observed anchor: fail the render (default) or downgrade to claimed",
    )
    args = p.parse_args(argv)

    try:
        report = load_report(args.input)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    annotated, dangling = annotate(report["findings"], args.tree, args.on_dangling)

    if dangling and args.on_dangling == "fail":
        print(
            f"ERROR: {len(dangling)} finding(s) carry an ungrounded (dangling) anchor — "
            "synthesis fails (SDD §2.6 / B1). Rerun with --on-dangling downgrade to reclassify as claimed.",
            file=sys.stderr,
        )
        for idx, f, reason in dangling:
            print(f"  - finding[{idx}] anchor {f.get('anchor', '')!r}: {reason}", file=sys.stderr)
        return 2

    if dangling and args.on_dangling == "downgrade":
        for idx, f, reason in dangling:
            print(
                f"WARNING: finding[{idx}] anchor {f.get('anchor', '')!r} dangling → downgraded to claimed ({reason})",
                file=sys.stderr,
            )

    annotated.sort(key=rank_key)
    md = render_markdown(report, annotated)

    if args.output:
        with open(args.output, "w") as fh:
            fh.write(md)
    else:
        sys.stdout.write(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
