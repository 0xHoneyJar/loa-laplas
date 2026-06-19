APPROVED - LETS FUCKING GO

# Security Audit — Sprint-3 (Epic B receipt declaration + attested capture)

Paranoid Cypherpunk Auditor. Sprint-3's delivered scope — the isolated
proof-of-operation writer — is cryptographically sound. Approved, with two
**binding requirements recorded against sprint-4's wiring** (where the gate
actually goes live).

## Crypto review — PASS
- **Real Ed25519, established infra**: signs canonical(payload) via `.claude/scripts/lib/audit-signing-helper.py` (no new primitive, SDD B2/B3). Forgery resistance proven: tampered payload → exit 3; wrong key → exit 3 (`compose-proof.bats` [B5]).
- **Fail-closed families**: unmapped `final_model_id` → null → does not satisfy a slot ([B7/SB6]). opus+sonnet → 1 family (no cross-vendor theater).
- **No injection**: subprocess uses list-args (no `shell=True`); YAML via `safe_load`; JSON/JSONL parsing only.
- **No secrets**: keys referenced by id/dir, never embedded; private key never logged.
- **Isolation primitives**: `attempted/` + `receipts/` created `0700`; atomic temp+rename writes (SDD B4). Per-receipt signature subsumes anti-rewrite (a rewritten receipt fails verification).

## BINDING on sprint-4 (the gate's integrity depends on these — recorded, not blocking sprint-3)
1. **Key isolation must be enforced at the wiring**: the stage-under-verification MUST NOT have `LOA_AUDIT_KEY_DIR` / gatekeeper-key access; only the dispatcher runs `capture`. Without this, a stage can sign its own receipt → theater. (Same boundary protects MODELINV integrity.)
2. **Check 6 MUST reuse `verify-receipt`/`_canonical`** — never re-implement canonicalization, or valid receipts spuriously fail.

These are correctly out of sprint-3's scope (machinery, not wiring) but are the load-bearing security properties of the live gate; sprint-4 owns them.

## Disposition
`COMPLETED` for sprint-3's scope. Crypto machinery sound; the two sprint-4 security requirements are documented (`docs/runtime/construct-adapters.md`) and in the engineer review. The gate goes live in sprint-4.
