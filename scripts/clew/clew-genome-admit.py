#!/usr/bin/env python3
"""
clew-genome-admit.py — the genome ADMISSION + WRITE orchestrator (bd-uze A2/A3).

Called by loa-clew-distill.sh --mark-distilled <clew-id>. Given one operator-
merged clew, it enforces the incorruptible-by-roleplay invariant and, on
admission, extends the construct's genome by one link.

THE INVARIANT (A3): a clew is admissible to the genome ONLY if it carries a
run_id with a `valid_run` verdict from compose-verify-run (--require-executed:
the run must have actually EXECUTED, not merely compiled). A clew with no run_id
(ambient capture) or whose run_id does not verify is QUARANTINED to SUSPECTS.jsonl
— visible, ineligible, teaching nothing. This is what makes earned authority
incorruptible: you cannot teach a construct by role-playing a correction; you
must run it through the governed runtime.

GUARANTEE BOUNDARY (be precise, do not over-claim): admission proves a REAL
governed run EXISTS and verified — it does NOT yet prove this clew's specific
correction was PRODUCED BY that run. A determined actor could capture a clew with
LOA_COMPOSE_RUN_ID set to some OTHER genuinely-completed run and have it admitted.
The invariant defeats the common case (a correction invented with no run behind it
at all -> SUSPECTS); the content<->run binding (verify the clew is referenced in
that run's envelope/seam trail) is the next hardening, tracked separately. The
claim is "a governed run must exist," not "this clew provably came from this run."

ON ADMISSION (A2): compute the next genome link via genome-chain.py (which reuses
the RFC-8785 + sha256 core — never reinvents crypto), surgically write
genome_hash + parent_genome_hash + genome_depth into the construct's source
construct.yaml (comment-preserving), and mark the ledger entry distilled with the
link it produced. Git is the blockchain; the operator's merge of this change is
the signature.

Exit codes:
  0  admitted   — genome extended by one link
  4  suspect    — quarantined to SUSPECTS.jsonl (DISTINCT from error: this is a
                  correct, expected outcome for an un-governed correction)
  3  idempotent — clew already distilled or already suspect (no-op)
  1  error      — clew not found / construct.yaml missing / compute failure / etc.
  2  usage

Verdict is also emitted as JSON on stdout with --json for machine gating.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import datetime
from pathlib import Path

# Mutable bookkeeping fields — must match genome-chain.py's _MUTABLE_FIELDS so
# the hash payload is identical on compute and on later verify.
_MUTABLE_FIELDS = {"distill_status", "distilled_at", "genome_hash", "genome_seq", "proposed_pr"}
_RUN_ID_RE = r"^[0-9A-Za-z][0-9A-Za-z._-]*$"


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _read_ledger(path: Path) -> list[str]:
    if not path.is_file():
        return []
    return [ln.rstrip("\n") for ln in path.read_text(encoding="utf-8").splitlines()]


def _find_entry(lines: list[str], clew_id: str):
    for i, ln in enumerate(lines):
        if not ln.strip():
            continue
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get("id") == clew_id:
            return i, d
    return None, None


def _validate_entry(entry: dict, schema_path: Path) -> tuple[bool, str]:
    try:
        import jsonschema
    except Exception:
        # No validator available: do NOT silently pass — the caller decides, but
        # we report it honestly (mirrors ledger-append's exit-70 contract).
        return False, "jsonschema module unavailable (cannot validate rewrite)"
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(entry, schema)
        return True, "ok"
    except jsonschema.ValidationError as exc:
        return False, f"schema violation: {exc.message}"
    except Exception as exc:
        return False, f"validator error: {exc}"


def _rewrite_ledger_atomic(path: Path, lines: list[str], idx: int, new_entry: dict) -> None:
    """Replace line idx with new_entry; write via temp + rename (atomic)."""
    out = list(lines)
    out[idx] = json.dumps(new_entry, separators=(",", ":"), ensure_ascii=False)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text("\n".join(l for l in out if l != "") + "\n", encoding="utf-8")
    tmp.replace(path)


def _append_suspect(suspects_path: Path, entry: dict, reason: str, verdict: dict | None) -> None:
    rec = {
        "id": entry.get("id"),
        "construct": entry.get("target", {}).get("construct"),
        "run_id": entry.get("run_id"),
        "reason": reason,
        "verdict": verdict,
        "quarantined_at": _now(),
        "trigger": entry.get("trigger"),
    }
    suspects_path.parent.mkdir(parents=True, exist_ok=True)
    with suspects_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, separators=(",", ":"), ensure_ascii=False) + "\n")


def _verify_run(verify_script: Path, run_id: str, base_dirs: list[Path]):
    """
    Run compose-verify-run.sh --require-executed across candidate base dirs.
    Returns (verdict_dict, run_dir_or_None). A found run dir (anything other than
    not_a_run) is authoritative; only if NO base dir has the run → not_a_run.
    """
    last = ({"verdict": "not_a_run", "reason": "no candidate base dir contains the run",
             "run_id": run_id}, None)
    for base in base_dirs:
        run_dir = base / run_id
        if not run_dir.is_dir():
            continue
        try:
            proc = subprocess.run(
                [str(verify_script), run_id, "--json", "--require-executed", "--base-dir", str(base)],
                capture_output=True, text=True, timeout=30,
            )
            out = (proc.stdout or "").strip()
            verdict = json.loads(out) if out else {"verdict": "broken_run", "reason": "empty verifier output"}
            verdict.setdefault("run_id", run_id)
            # Defensive (cross-model review, claude MED): the verdict JSON and the
            # process EXIT CODE must AGREE. compose-verify-run exits 0 ONLY for
            # valid_run; a valid_run verdict paired with a non-zero exit is an
            # inconsistency (script bug / partial write / tamper) → do NOT trust it.
            if verdict.get("verdict") == "valid_run" and proc.returncode != 0:
                verdict = {"verdict": "broken_run", "run_id": run_id,
                           "reason": f"verdict=valid_run but verifier exit={proc.returncode} "
                                     f"(stdout/exit-code disagree — refusing to admit)"}
            return (verdict, run_dir)
        except Exception as exc:
            return ({"verdict": "broken_run", "reason": f"verifier invocation failed: {exc}",
                     "run_id": run_id}, run_dir)
    return last


# --- surgical, comment-preserving construct.yaml genome-block writer ----------
_GENOME_COMMENT = (
    "# genome-hash-chain (bd-uze) — earned authority provenance, "
    "NOT the behavioral interface"
)
_GENOME_KEYS = ("genome_hash", "parent_genome_hash", "genome_depth")


def _write_genome_to_yaml(yaml_path: Path, genome_hash: str, parent: str | None, depth: int) -> None:
    """
    Rewrite the construct's genome block WITHOUT a full YAML round-trip (preserves
    comments, ordering, and formatting of every NON-genome line). Strategy: strip
    every existing top-level genome line + the genome comment, then append ONE
    cohesive block. Idempotent + cohesive at any depth (no duplicate comments, no
    split keys) — the previous replace-in-place + append-unseen approach left the
    genesis→depth-2 transition with a duplicated comment and an orphaned
    parent_genome_hash (caught by the admission E2E).
    """
    def is_top_level_key(line: str, key: str) -> bool:
        s = line.rstrip()
        return s.startswith(key + ":") or s.startswith(key + " :")

    lines = yaml_path.read_text(encoding="utf-8").splitlines()
    kept: list[str] = []
    for line in lines:
        if line.rstrip() == _GENOME_COMMENT:
            continue
        if any(is_top_level_key(line, k) for k in _GENOME_KEYS):
            continue
        kept.append(line)
    while kept and kept[-1].strip() == "":
        kept.pop()

    block = [_GENOME_COMMENT, f"genome_hash: {genome_hash}"]
    if parent is not None:
        block.append(f"parent_genome_hash: {parent}")
    block.append(f"genome_depth: {depth}")

    kept.append("")
    kept.extend(block)
    # Atomic write (cross-model review, claude MED): write a temp file in the SAME dir
    # then rename — a crash mid-write cannot leave construct.yaml truncated/corrupt.
    # Mirrors _rewrite_ledger_atomic.
    tmp = yaml_path.with_suffix(yaml_path.suffix + ".tmp")
    tmp.write_text("\n".join(kept) + "\n", encoding="utf-8")
    tmp.replace(yaml_path)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="clew-genome-admit.py")
    ap.add_argument("--clew-id", required=True)
    ap.add_argument("--ledger", required=True)
    ap.add_argument("--construct-yaml", required=True)
    ap.add_argument("--schema", required=True, help="learnings-construct.schema.json")
    ap.add_argument("--genome-chain", required=True, help="path to genome-chain.py")
    ap.add_argument("--verify-run", required=True, help="path to compose-verify-run.sh")
    ap.add_argument("--suspects", required=True, help="SUSPECTS.jsonl path")
    ap.add_argument("--compose-base-dir", action="append", default=[],
                    help="candidate .run/compose dir(s) to resolve the run_id; repeatable")
    ap.add_argument("--pr", default="")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    ledger = Path(args.ledger)
    lines = _read_ledger(ledger)
    idx, entry = _find_entry(lines, args.clew_id)

    def emit(result: dict, code: int) -> int:
        if args.json:
            print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
        else:
            v = result.get("status")
            if v == "admitted":
                print(f"  ✓ {args.clew_id} ADMITTED → genome depth {result['genome_depth']} "
                      f"({result['genome_hash']})")
            elif v == "suspect":
                print(f"  ⚠ {args.clew_id} QUARANTINED → SUSPECTS.jsonl — {result['reason']}", file=sys.stderr)
            elif v == "idempotent":
                print(f"  · {args.clew_id} already {result['existing_status']} (no-op)")
            else:
                print(f"  ✗ {args.clew_id}: {result.get('reason')}", file=sys.stderr)
        return code

    if entry is None:
        return emit({"status": "error", "reason": f"clew-id '{args.clew_id}' not found in {ledger}"}, 1)

    existing = entry.get("distill_status")
    if existing in ("distilled", "suspect"):
        return emit({"status": "idempotent", "existing_status": existing,
                     "genome_hash": entry.get("genome_hash")}, 3)

    # --- A3 ADMISSION ---------------------------------------------------------
    run_id = entry.get("run_id")
    import re
    suspects = Path(args.suspects)

    def quarantine(reason: str, verdict: dict | None) -> int:
        _append_suspect(suspects, entry, reason, verdict)
        new = dict(entry, distill_status="suspect", distilled_at=_now())
        ok, msg = _validate_entry(new, Path(args.schema))
        if not ok:
            return emit({"status": "error", "reason": f"suspect-rewrite failed validation: {msg}"}, 1)
        _rewrite_ledger_atomic(ledger, lines, idx, new)
        return emit({"status": "suspect", "reason": reason, "run_id": run_id, "verdict": verdict}, 4)

    if not run_id or not (isinstance(run_id, str) and re.match(_RUN_ID_RE, run_id) and ".." not in run_id):
        return quarantine("no/invalid run_id — ambient capture outside a governed run", None)

    base_dirs = [Path(b) for b in args.compose_base_dir]
    base_dirs.append(Path.cwd() / ".run" / "compose")  # default: CWD project
    verdict, run_dir = _verify_run(Path(args.verify_run), run_id, base_dirs)
    if verdict.get("verdict") != "valid_run":
        return quarantine(
            f"run_id '{run_id}' did not verify as a completed run "
            f"(verdict={verdict.get('verdict')}: {verdict.get('reason')})",
            verdict,
        )

    # F1 PARTIAL mitigation (cross-model consensus BLOCKER/HIGH): bind the clew to a
    # run that ACTUALLY INVOLVED this construct. A clew is admissible to construct X's
    # genome only if the verified run emitted >=1 envelope with construct_slug == X.
    # This defeats "borrow ANY valid run_id"; it does NOT yet prove the clew's specific
    # correction was produced by that run (full content<->run binding = bd-70m).
    clew_construct = (entry.get("target") or {}).get("construct")
    run_constructs: set[str] = set()
    env_dir = (run_dir / "envelopes") if run_dir else None
    if env_dir and env_dir.is_dir():
        for ef in sorted(env_dir.glob("*.handoff.json")):
            try:
                cs = json.loads(ef.read_text(encoding="utf-8")).get("construct_slug")
                if cs:
                    run_constructs.add(cs)
            except Exception:
                pass
    if clew_construct and clew_construct not in run_constructs:
        return quarantine(
            f"run '{run_id}' is valid but did NOT involve construct '{clew_construct}' "
            f"(run constructs: {sorted(run_constructs) or '[]'}) — borrowed run_id (F1 partial gate)",
            verdict,
        )

    # --- A2 ADMIT: extend the genome -----------------------------------------
    yaml_path = Path(args.construct_yaml)
    if not yaml_path.is_file():
        return emit({"status": "error",
                     "reason": f"construct.yaml not found at {yaml_path} — cannot write genome"}, 1)

    # Resolve current head + depth from the manifest.
    try:
        import yaml
        manifest = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        return emit({"status": "error", "reason": f"cannot parse construct.yaml: {exc}"}, 1)
    parent = manifest.get("genome_hash") or "genesis"
    cur_depth = manifest.get("genome_depth") or 0

    # Compute the next link via the reusable core (hash the immutable payload).
    payload = {k: v for k, v in entry.items() if k not in _MUTABLE_FIELDS}
    try:
        proc = subprocess.run(
            [sys.executable, str(args.genome_chain), "compute", "--parent", parent, "--entry-file", "-"],
            input=json.dumps(payload), capture_output=True, text=True, timeout=30,
        )
        if proc.returncode != 0:
            return emit({"status": "error", "reason": f"genome-chain compute failed: {proc.stderr.strip()}"}, 1)
        new_hash = proc.stdout.strip()
    except Exception as exc:
        return emit({"status": "error", "reason": f"genome-chain invocation failed: {exc}"}, 1)

    new_depth = int(cur_depth) + 1
    parent_to_write = None if parent == "genesis" else parent
    _write_genome_to_yaml(yaml_path, new_hash, parent_to_write, new_depth)

    # Mark the ledger entry distilled (re-validated — closes the crucible
    # second-mutation-path gap: every write to the store validates). genome_seq =
    # new_depth is the AUTHORITATIVE chain-order index (verify sorts by it, not by the
    # mutable distilled_at — cross-model review: claude MED / gemini HIGH).
    new = dict(entry, distill_status="distilled", distilled_at=_now(),
               genome_hash=new_hash, genome_seq=new_depth)
    if args.pr:
        new["proposed_pr"] = args.pr
    ok, msg = _validate_entry(new, Path(args.schema))
    if not ok:
        return emit({"status": "error", "reason": f"distilled-rewrite failed validation: {msg}"}, 1)
    _rewrite_ledger_atomic(ledger, lines, idx, new)

    return emit({"status": "admitted", "genome_hash": new_hash, "parent_genome_hash": parent_to_write,
                 "genome_depth": new_depth, "run_id": run_id}, 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
