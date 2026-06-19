APPROVED - LETS FUCKING GO

# Security Audit — Sprint-4 (Check 6 proof-of-operation verifier, fail-closed)

Paranoid Cypherpunk Auditor. The verifier is sound and fail-closed; the gate is
LIVE. Approved, with the executor-seam requirements (carried from sprint-3 +
extended) recorded as binding.

## Verifier review — PASS
- **Sig-verify-first, fail-closed** (SDD §3.3): forged/unsigned → `broken_run`; uncorrelated (replay) → `broken_run`; under-family → `broken_run`; unmapped id never satisfies a slot (SB6); marker-without-receipt → `degraded_run` (deny, queued to `verify-fail.jsonl`, never green, SB5); never-ran → `broken_run`. Proven by the 10-test battery + 3 e2e wiring tests.
- **Verifier authority over families**: Check 6 recomputes families from the SIGNED invocations via the pinned map — it does not trust the capture's `family_count`. Correct (SB6/B7).
- **Canonicalization reuse**: Check 6 calls the same `_canonical`/`verify-receipt` as the capture (no drift) — sprint-3 binding #2 discharged.
- **Private key never on the verify path**: `--pubkey-dir` (public key) only.
- **Tamper guard added**: a removed declaration list with artifacts present → `broken_run` (closes the partial-delete bypass).
- **Default-off** (`--proof-of-operation`, mirrors `--legba`): zero back-compat risk; existing suite unregressed.

## BINDING on the executor seam (recorded; the live-run integrity rests on these)
1. **Private-key isolation** (carried from sprint-3): the stage subagent must not access `LOA_AUDIT_KEY_DIR`/the gatekeeper key; only the dispatcher/cheval signs.
2. **Declaration provenance**: derive the declared-op set from the VERIFIED manifest/composition (not solely a deletable `proof-declared.json`) so a clean delete of list+artifacts cannot bypass. The tamper guard is a partial close; full close is the executor's job.
3. **Run-dir isolation**: `attempted/`+`receipts/`+`proof-declared.json` live in the dispatcher-owned `0700` run dir; the stage cannot write them.

These are correctly out of sprint-4's verifier scope (the gate is correct given trustworthy inputs + the isolation boundary) but are the load-bearing properties of the LIVE gate in production.

## Disposition
`COMPLETED`. Verifier sound, fail-closed, fully tested. The executor-seam requirements are documented (`docs/runtime/construct-adapters.md`) + recorded here for the integration that wires real-run capture.
