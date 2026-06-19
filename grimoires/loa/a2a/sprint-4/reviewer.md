# Sprint-4 Implementation Report — Check 6 proof-of-operation verifier (fail-closed) + negative battery

> Cycle: verifiable-compose · RFC #57 · SDD §3.3–3.5

## Executive Summary

Sprint-4 makes the proof-of-operation gate **LIVE**: `compose-verify-run.sh
--proof-of-operation` adds Check 6 (sibling to Checks 1–5, default-off like
`--legba`). A run earns `valid_run` only if every stage that DECLARED
`capabilities.verify.operation` left a gatekeeper-signed, correlated receipt
proving ≥ `min_model_families` distinct VENDOR families. Verdict table (SDD §3.3),
fail-closed, sig-verify-first. The verdict-table logic lives in
`compose-proof-capture.py check` (reuses the sprint-3 `_canonical` + `verify-receipt`
— binding req #2 honored: no canonicalization drift); the verifier independently
recomputes families from the SIGNED invocations via the pinned map (SB6).

Net-new: `check` + `declare` subcommands in `compose-proof-capture.py`; a thin
`--proof-of-operation` hook in `compose-verify-run.sh` (+ `degraded_run` verdict);
12 tests (`compose-proof-check.bats` 9 + `compose-verify-proof-wiring.bats` 3).

## AC Verification

| AC | Status | Evidence (test → code) |
|----|--------|------------------------|
| **VC-B1** declared op, no marker+receipt → `broken_run` 3 | ✓ | `compose-proof-check.bats` "VC-B1" → `compose-proof-capture.py` cmd_check never-ran branch |
| **VC-B2 [B6]** two same-family ids on min 2 → exit 3 | ✓ | "VC-B2" → cmd_check family recompute (opus+sonnet=1<2) |
| **VC-B3** ≥2 families, correlated, sig-valid → `valid_run` 0 | ✓ | "VC-B3" + wiring "valid_run" e2e through `compose-verify-run.sh` |
| **VC-B4** non-FAGAN construct gate-checked identically | ✓ | "VC-B4" (stage_id `my-custom-reviewer`, op `design-council`) |
| **[B5/SB1]** forged receipt (no valid sig) → exit 3 | ✓ | "forged receipt" → sig-verify-first branch |
| **[B4]** replay (receipt from another run) → exit 3 | ✓ | "replay" → correlation-mismatch branch |
| **[SB5]** marker present, invocation aborted → `degraded`/deny, never valid | ✓ | "marker present + no receipt" → degraded(2) + queued to `verify-fail.jsonl` |
| **[SB6]** unmapped `final_model_id` → exit 3 + audit signal | ✓ | "unmapped id" → reason flags `SB6 unmapped` (stderr/queue) |
| **[B3]** signed marker, receipt absent → `degraded_run` 2 | ✓ | same "marker present + no receipt" test |
| Back-compat: no verify op → Check 6 no-op, verdict unchanged | ✓ | "back-compat no-op" + wiring "no declaration" e2e |

All 10 ACs met. Verdict ordering verified: Check 6 runs **before** the final
valid_run/compiled_run emit, so a proof failure dominates (`compose-verify-run.sh`,
the `--proof-of-operation` block precedes "All checks passed").

## Binding sprint-3 requirements — discharged
- **#2 (Check 6 reuses canonicalization)**: ✓ — Check 6 calls `compose-proof-capture.py check`, which uses the same `_canonical`/`verify-receipt`. No re-implementation.
- **#1 (key-isolation)**: the verifier needs only the PUBLIC key (`--pubkey-dir` = `LOA_AUDIT_KEY_DIR`); it never touches the private key. The private-key isolation from the stage is enforced at the executor seam (below) — recorded, unchanged.

## Testing Summary
- `bats tests/integration/compose-proof-check.bats` → 9/9 (negative battery).
- `bats tests/integration/compose-verify-proof-wiring.bats` → 3/3 (e2e through compose-verify-run.sh).
- `bats tests/integration/compose-verify-run.bats` → unregressed (25/25).
- `bats tests/integration/compose-proof.bats` (sprint-3) → 9/9.

## Known Limitations (explicit)
- **The Form C executor seam** (declare+mark+capture during real runs + cheval MODELINV `final_model_id` tagging) is documented in `docs/runtime/construct-adapters.md` ("The remaining coherent seam") and deliberately NOT split into a partial `compose-dispatch.sh` hook — a `declare`-only hook would fail-close-break declaring runs before the executor produces evidence. The gate enforces whenever artifacts are present (proven e2e) and is a safe no-op otherwise; default-off via `--proof-of-operation`.
- `degraded_run` carries the verdict STRING + exit 2; a `degraded:true` JSON flag was not added to `_verdict` (consumers branch on `.verdict == "degraded_run"`) to avoid editing the shared emitter.

## Verification Steps
1. `bats tests/integration/compose-proof-check.bats tests/integration/compose-verify-proof-wiring.bats` — expect 12/12.
2. `bash -n scripts/compose-verify-run.sh` — syntax clean.
3. Confirm `--proof-of-operation` is default-off: a run without the flag is unchanged (existing suite green).
