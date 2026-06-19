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
    # 1. explicit provider prefix ("anthropic:claude-opus-4-8")
    if ":" in mid:
        provider, rest = mid.split(":", 1)
        if provider in fmap.get("providers", []):
            return provider
        mid = rest  # gateway form without a known provider — fall through on the model part
    # 2. exact pinned id
    if mid in fmap.get("known_ids", {}):
        return fmap["known_ids"][mid]
    # 3. model-name prefix rule
    for prefix, fam in fmap.get("model_prefix_family", {}).items():
        if mid.startswith(prefix):
            return fam
    # 4. unmapped — never satisfies a family slot
    return None


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

    a = p.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
