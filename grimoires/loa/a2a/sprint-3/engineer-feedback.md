All good (with noted concerns)

# Senior Tech Lead Review — Sprint-3 (Epic B receipt declaration + attested capture)

Approved for sprint-3's delivered scope (the isolated proof-of-operation machinery).
Crypto reuses the established audit Ed25519 infra; 9/9 tests; no System Zone or
dispatcher drift. Concerns are non-blocking for this scope but one is a **binding
requirement on sprint-4's wiring** (isolation).

## ACs verified against code + tests
- AC1 (marker + signed correlated receipt + declaration gating) — machinery + decision logic met (`compose-proof-capture.py`; tests). Dispatch call-sites are the documented seam (honest scope).
- [B5] (sig verifies; tamper/wrong-key fail) — met; forgery + wrong-key negative tests green.
- [B7] (opus+sonnet → 1 family; unmapped fail-closed) — met.

## Adversarial Analysis

### Concerns
1. **Isolation is an OPERATIONAL property of the (deferred) wiring** (`compose-proof-capture.py` `_sign` reads key via `--key-id/--key-dir`). The whole gate's integrity rests on the stage-under-verification NOT having gatekeeper-key access while the dispatcher does. The machinery is correct, but if sprint-4 wires `capture` such that the stage subagent inherits `LOA_AUDIT_KEY_DIR`/key access, the gate becomes theater. **Binding on sprint-4**: the stage subagent env MUST NOT carry the gatekeeper key; capture runs only in the dispatcher context. Flagged for the auditor.
2. **Canonicalization is internally-consistent but not RFC-8785 JCS** (`_canonical`, json.dumps sorted/compact). Safe ONLY because sign and verify call the same `_canonical`. **Binding on sprint-4**: Check 6 MUST call `compose-proof-capture.py verify-receipt` (or import `_canonical`), never re-implement canonicalization — else signatures spuriously fail. Documented in the module.
3. **Marker is unsigned** (`cmd_mark`). A stage could forge a marker — but forged-marker + no-valid-receipt → `degraded_run`, forged-marker + forged-receipt → sig fail → `broken_run`. A forged marker can only downgrade broken→degraded (both denies), never reach `valid_run`. Acceptable; noted.

### Assumption Challenged
- **Assumption**: MODELINV (`.run/model-invoke.jsonl`) is trustworthy evidence (cheval-emitted, `final_model_id` is provider-returned).
- **Risk if wrong**: if the stage could write the MODELINV log, it could fabricate cross-vendor invocations.
- **Recommendation**: holds under the SDD's isolated-writer model (cheval emits MODELINV); same isolation boundary as concern #1. Made explicit in the report.

### Alternative Not Considered
- **Alternative**: legba hash-chain the receipt tree (SDD B4) instead of per-receipt signatures.
- **Tradeoff**: chaining detects reordering/deletion; per-receipt Ed25519 detects content forgery directly and is simpler. The signature subsumes the anti-rewrite goal for a single receipt.
- **Verdict**: per-receipt signing is the right primary control; chaining is optional belt-and-suspenders, not landed. Justified.

Documentation: PASS (canonical schema + integration contract in `docs/runtime/construct-adapters.md`).
