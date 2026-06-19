#!/usr/bin/env python3
"""compose-proof-capture.py — verifiable-compose Epic B sprint-3 (RFC #57).

The ISOLATED writer for the proof-of-operation gate. A compose stage that
declares ``capabilities.verify.operation`` must, to earn a ``valid_run``, leave
behind a gatekeeper-signed, correlated receipt proving its operation actually ran
across >= min_model_families distinct VENDOR families. This module is run by the
DISPATCHER (which holds the gatekeeper key), never by the stage under
verification — so the stage cannot forge its own proof.

Subcommands:
  mark           Write the operation-ATTEMPTED marker BEFORE invocation
                 (.run/compose/<run>/attempted/<idx>). Separates "infra flake"
                 (attempted, capture failed -> degraded) from "never ran" (no
                 marker -> broken). Independent of the receipt write (SDD B3).
  capture        Build the normalized receipt from the MODELINV evidence
                 (model-invoke.jsonl), resolve vendor families via the pinned
                 map, bind the correlation fields, sign the canonical payload
                 with the gatekeeper Ed25519 key (reuses audit-signing-helper.py
                 — NO new primitive, SDD B2/B3), and write receipts/<idx>.json
                 atomically into a 0700 dir.
  verify-receipt Re-canonicalize a receipt's payload and verify its signature
                 under the gatekeeper public key (used by [B5] + sprint-4 Check 6).
  families       Resolve + count distinct vendor families in a MODELINV log
                 ([B6/B7] + sprint-4 family count). Unmapped ids resolve to null
                 and do NOT count (SB6 fail-closed).
  should-verify  Exit 0 + print the verify declaration iff the composition stage
                 (or construct.yaml) declares verify.operation; exit 1 otherwise.

Signing canonicalization is centralized in _canonical() so the capture (sign)
and sprint-4 Check 6 (verify) share byte-identical input — no drift.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SIGNING_HELPER = _REPO_ROOT / ".claude" / "scripts" / "lib" / "audit-signing-helper.py"
_FAMILY_MAP = Path(__file__).resolve().parent / "data" / "model-family-map.json"


# ---------------------------------------------------------------------------
# Family resolution (FAMILY = vendor; opus+sonnet are BOTH "anthropic")
# ---------------------------------------------------------------------------
def _load_family_map():
    return json.loads(_FAMILY_MAP.read_text())


def resolve_family(model_id, fmap=None):
    """final_model_id -> vendor family, or None (unmapped -> fail-closed, SB6)."""
    fmap = fmap or _load_family_map()
    if not model_id:
        return None
    mid = str(model_id).strip()
    # The MODEL NAME is the authority (Bridgebuilder #2). A provider prefix is only
    # a cross-check, never an override: `anthropic:gpt-5.5` must NOT resolve to
    # anthropic (diversity spoof). Resolve on the model name; if a known-provider
    # prefix disagrees with the model-derived family, fail closed (None).
    claimed = None
    if ":" in mid:
        provider, rest = mid.split(":", 1)
        if provider in fmap.get("providers", []):
            claimed = provider
        mid = rest  # always resolve on the model name, prefix or not
    fam = fmap.get("known_ids", {}).get(mid)
    if fam is None:
        for prefix, f in fmap.get("model_prefix_family", {}).items():
            if mid.startswith(prefix):
                fam = f
                break
    if fam is None:
        return None  # unmapped model name never satisfies a slot (even under a prefix)
    if claimed is not None and claimed != fam:
        return None  # prefix/model-name mismatch -> spoof -> fail closed
    return fam


# ---------------------------------------------------------------------------
# MODELINV evidence extraction (liberal field reading; see docstring + docs)
# ---------------------------------------------------------------------------
def _iter_modelinv(path):
    """Yield records from a model-invoke.jsonl log (skips seal markers + blanks)."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("["):
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def _field(rec, *names):
    """First present field across the record and its nested payload (liberal)."""
    payload = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
    for n in names:
        if rec.get(n) not in (None, ""):
            return rec[n]
        if payload.get(n) not in (None, ""):
            return payload[n]
    return None


def _invocations(modelinv_path, fmap):
    """Normalize MODELINV records into receipt invocation entries."""
    out = []
    for rec in _iter_modelinv(modelinv_path):
        # final_model_id is the PROVIDER-RETURNED id (not a stage-chosen string).
        mid = _field(rec, "final_model_id", "model_invoked", "model_id", "model")
        if mid is None:
            continue
        out.append({
            "final_model_id": mid,
            "model_family": resolve_family(mid, fmap),
            "provider": _field(rec, "provider", "vendor"),
            "invocation_id": _field(rec, "invocation_id", "id", "request_id"),
            "provider_response_hash": _field(rec, "provider_response_hash", "response_hash"),
            "timestamp": _field(rec, "timestamp", "ts", "time"),
        })
    return out


# ---------------------------------------------------------------------------
# Canonicalization + signing (reuses audit-signing-helper.py — no new primitive)
# ---------------------------------------------------------------------------
def _canonical(payload):
    """Deterministic canonical bytes for sign/verify. Single source — sign and
    Check-6 verify MUST call this identically."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sign(canonical_bytes, key_id, key_dir):
    proc = subprocess.run(
        [sys.executable, str(_SIGNING_HELPER), "sign", "--key-id", key_id, "--key-dir", key_dir],
        input=canonical_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"signing failed (rc={proc.returncode}): {proc.stderr.decode(errors='replace')}")
    return proc.stdout.decode().strip()


def _verify(canonical_bytes, sig_b64, key_id, pubkey_dir):
    proc = subprocess.run(
        [sys.executable, str(_SIGNING_HELPER), "verify", "--pubkey-dir", pubkey_dir, "--key-id", key_id],
        input=canonical_bytes + b"\n" + sig_b64.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return proc.returncode == 0


def _atomic_write(path, data, dir_mode=0o700):
    """Write atomically (temp + rename) into a dir created 0700 (SDD B4 isolation)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=dir_mode)
    try:
        os.chmod(path.parent, dir_mode)
    except OSError:
        pass
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------
def _as_index(v):
    """Stage index as int when integral (SDD schema / Check-6 correlation), else str."""
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return v


def cmd_mark(a):
    marker = Path(a.run_dir) / "attempted" / str(a.stage_index)
    _atomic_write(marker, json.dumps({"stage_index": _as_index(a.stage_index)}) + "\n")
    print(str(marker))
    return 0


def cmd_capture(a):
    fmap = _load_family_map()
    invs = _invocations(a.modelinv, fmap)
    families = sorted({i["model_family"] for i in invs if i["model_family"]})
    payload = {
        "compose_run_id": a.run_id,
        "stage_index": _as_index(a.stage_index),
        "stage_id": a.stage_id,
        "operation": a.operation,
        "envelope_hash": a.envelope_hash,
        "invocations": invs,
        "families": families,
        "family_count": len(families),
    }
    canonical = _canonical(payload)
    sig = _sign(canonical, a.key_id, a.key_dir)
    receipt = {"payload": payload, "signing_key_id": a.key_id, "sig": sig}
    out = Path(a.run_dir) / "receipts" / f"{a.stage_index}.json"
    _atomic_write(out, json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(str(out))
    return 0


def cmd_verify_receipt(a):
    receipt = json.loads(Path(a.receipt).read_text())
    payload = receipt.get("payload")
    sig = receipt.get("sig")
    key_id = receipt.get("signing_key_id")
    if not (isinstance(payload, dict) and sig and key_id):
        print("INVALID: receipt missing payload/sig/signing_key_id", file=sys.stderr)
        return 3
    ok = _verify(_canonical(payload), sig, key_id, a.pubkey_dir)
    if ok:
        print("VALID")
        return 0
    print("INVALID: signature does not verify under gatekeeper public key", file=sys.stderr)
    return 3


def cmd_families(a):
    fmap = _load_family_map()
    invs = _invocations(a.modelinv, fmap)
    families = sorted({i["model_family"] for i in invs if i["model_family"]})
    unmapped = sorted({i["final_model_id"] for i in invs if not i["model_family"]})
    print(json.dumps({"families": families, "family_count": len(families), "unmapped": unmapped}))
    return 0


def _read_verify_decl(path, stage_index):
    """Return the verify declaration dict for a stage/construct, or None."""
    import yaml  # PyYAML is already a repo dependency (used across compose tooling)
    doc = yaml.safe_load(Path(path).read_text())
    if not isinstance(doc, dict):
        return None
    # construct.yaml form: capabilities.verify
    cap = (doc.get("capabilities") or {}).get("verify")
    if cap and stage_index is None:
        return cap
    # composition form: chain[stage].capabilities.verify (stage-level override)
    if stage_index is not None:
        for s in doc.get("chain", []):
            if str(s.get("stage")) == str(stage_index):
                sv = (s.get("capabilities") or {}).get("verify")
                return sv or cap
    return cap


def cmd_should_verify(a):
    decl = _read_verify_decl(a.spec, a.stage_index)
    if decl and decl.get("operation"):
        print(json.dumps(decl))
        return 0
    return 1


def _atomic_append(path, line):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(path, "a") as fh:
        fh.write(line)


def cmd_declare(a):
    """Dispatcher: record the stages that declare verify.operation for this run,
    BEFORE any invocation. Check 6 reads this to know what MUST be proven (so a
    missing marker+receipt for a declared stage is a FAIL, not an unknown)."""
    import yaml
    doc = yaml.safe_load(Path(a.composition).read_text()) or {}
    out = []
    cap_default = (doc.get("capabilities") or {}).get("verify")
    for st in doc.get("chain", []):
        decl = ((st.get("capabilities") or {}).get("verify")) or cap_default
        if decl and decl.get("operation"):
            out.append({
                "stage_index": _as_index(st.get("stage")),
                "stage_id": st.get("stage_id") or st.get("construct") or st.get("persona"),
                "operation": decl.get("operation"),
                "min_model_families": int(decl.get("min_model_families", 1)),
            })
    dest = Path(a.run_dir) / "proof-declared.json"
    _atomic_write(dest, json.dumps(out, indent=2, sort_keys=True) + "\n")
    print(str(dest))
    return 0


def cmd_check(a):
    """Check 6 — proof-of-operation verifier (fail-closed). Returns exit
    0=valid/no-op, 2=degraded_run, 3=broken_run. Worst verdict over all declared
    stages wins (broken dominates degraded). Reuses verify-receipt sig check +
    recomputes families from the SIGNED invocations via the pinned map (the
    verifier's authority, SB6). On any non-pass, queues to verify-fail.jsonl so
    DEGRADED is a deny, never silently green (SB5)."""
    run_dir = Path(a.run_dir)
    declared_path = run_dir / "proof-declared.json"
    if not declared_path.exists():
        # Tamper guard: a missing declaration list with proof artifacts PRESENT means
        # the "what must be proven" list was removed to skip the gate. Fail closed.
        # (Full fix — derive declarations from the verified manifest — is the executor
        # seam; this closes the delete-the-list-but-leave-artifacts bypass now.)
        attempted = run_dir / "attempted"
        receipts = run_dir / "receipts"
        has_artifacts = (attempted.is_dir() and any(attempted.iterdir())) or (receipts.is_dir() and any(receipts.iterdir()))
        if has_artifacts:
            _atomic_append(run_dir / "verify-fail.jsonl", json.dumps({"check6": "broken_run", "reasons": ["proof-declared.json absent but proof artifacts present (declaration list removed — tamper)"]}) + "\n")
            print(json.dumps({"check6": "broken_run", "reason": "proof-declared.json absent but proof artifacts present (tamper)"}), file=sys.stderr)
            return 3
        print(json.dumps({"check6": "no-op", "reason": "no proof-declared.json (back-compat: no declared verify ops)"}))
        return 0
    try:
        declared = json.loads(declared_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        _atomic_append(run_dir / "verify-fail.jsonl", json.dumps({"check6": "broken_run", "reasons": [f"proof-declared.json unreadable/corrupt: {exc}"]}) + "\n")
        print(json.dumps({"check6": "broken_run", "reason": f"proof-declared.json corrupt (fail closed): {exc}"}), file=sys.stderr)
        return 3
    if not declared:
        print(json.dumps({"check6": "no-op", "reason": "no declared verify ops"}))
        return 0
    fmap = _load_family_map()
    worst = 0
    reasons = []
    for st in declared:
        idx = st["stage_index"]
        sid, op = st.get("stage_id"), st.get("operation")
        minf = int(st.get("min_model_families", 1))
        exp_hash = st.get("envelope_hash")
        # Bridgebuilder #3: stage_index is interpolated into a path — confine it to
        # a plain non-negative integer token, else it is a read oracle / tamper.
        if not re.fullmatch(r"[0-9]+", str(idx)):
            worst = max(worst, 3); reasons.append(f"stage {idx!r}: invalid stage_index (not a non-negative integer) -> broken")
            continue
        marker = run_dir / "attempted" / str(idx)
        receipt = run_dir / "receipts" / f"{idx}.json"
        if not receipt.exists():
            if marker.exists():
                worst = max(worst, 2); reasons.append(f"stage {idx} {op}: attempted, capture failed (marker present, receipt absent) -> degraded")
            else:
                worst = max(worst, 3); reasons.append(f"stage {idx} {op}: operation never ran (no marker, no receipt) -> broken")
            continue
        try:
            rj = json.loads(receipt.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            worst = max(worst, 3); reasons.append(f"stage {idx} {op}: receipt unreadable/corrupt ({exc}) -> broken")
            continue
        payload = rj.get("payload") or {}
        sig, kid = rj.get("sig"), rj.get("signing_key_id")
        # 1. signature FIRST (cheapest-fail-first) — the load-bearing check (B5/SB1)
        if not (sig and kid and _verify(_canonical(payload), sig, kid, a.pubkey_dir)):
            worst = max(worst, 3); reasons.append(f"stage {idx} {op}: receipt signature invalid (forged/unsigned) -> broken")
            continue
        # 2. correlation (defeats cross-run / cross-stage replay, B4)
        corr = (payload.get("compose_run_id") == a.run_id
                and str(payload.get("stage_index")) == str(idx)
                and (sid is None or payload.get("stage_id") == sid)
                and (op is None or payload.get("operation") == op)
                and (exp_hash is None or payload.get("envelope_hash") == exp_hash))
        if not corr:
            worst = max(worst, 3); reasons.append(f"stage {idx} {op}: correlation mismatch (replay/cross-run/cross-stage) -> broken")
            continue
        # 3. families — recompute from SIGNED invocations via the pinned map (SB6)
        invs = payload.get("invocations") or []
        fams = sorted({resolve_family(i.get("final_model_id"), fmap) for i in invs if resolve_family(i.get("final_model_id"), fmap)})
        unmapped = sorted({i.get("final_model_id") for i in invs if not resolve_family(i.get("final_model_id"), fmap)})
        if len(fams) < minf:
            extra = f" [SB6 unmapped ids ignored: {unmapped}]" if unmapped else ""
            worst = max(worst, 3); reasons.append(f"stage {idx} {op}: {len(fams)} family/families < required {minf}{extra} -> broken")
            continue
    verdict = "valid" if worst == 0 else ("degraded_run" if worst == 2 else "broken_run")
    result = {"check6": verdict, "reasons": reasons}
    if worst != 0:
        _atomic_append(run_dir / "verify-fail.jsonl", json.dumps(result) + "\n")  # SB5: deny is recorded
        print(json.dumps(result), file=sys.stderr)
    else:
        print(json.dumps(result))
    return worst


def main(argv=None):
    p = argparse.ArgumentParser(prog="compose-proof-capture")
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("mark"); m.add_argument("--run-dir", required=True)
    m.add_argument("--stage-index", required=True); m.set_defaults(func=cmd_mark)

    c = sub.add_parser("capture")
    for f in ("--run-dir", "--run-id", "--stage-index", "--stage-id", "--operation", "--envelope-hash", "--modelinv", "--key-id", "--key-dir"):
        c.add_argument(f, required=True)
    c.set_defaults(func=cmd_capture)

    v = sub.add_parser("verify-receipt")
    v.add_argument("--receipt", required=True); v.add_argument("--pubkey-dir", required=True)
    v.set_defaults(func=cmd_verify_receipt)

    fa = sub.add_parser("families"); fa.add_argument("--modelinv", required=True)
    fa.set_defaults(func=cmd_families)

    sv = sub.add_parser("should-verify")
    sv.add_argument("--spec", required=True)
    sv.add_argument("--stage-index", default=None)
    sv.set_defaults(func=cmd_should_verify)

    dc = sub.add_parser("declare")
    dc.add_argument("--composition", required=True); dc.add_argument("--run-dir", required=True)
    dc.set_defaults(func=cmd_declare)

    ck = sub.add_parser("check")
    ck.add_argument("--run-dir", required=True); ck.add_argument("--run-id", required=True)
    ck.add_argument("--pubkey-dir", required=True)
    ck.set_defaults(func=cmd_check)

    a = p.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
