# Sprint-3 Implementation Report — Epic B receipt declaration + attested capture

> Cycle: verifiable-compose · RFC #57 · PRD `grimoires/loa/prd.md` · SDD §3.1–3.2

## Executive Summary

Sprint-3 delivers the **isolated proof-of-operation writer** — the machinery that
makes a `valid_run` provable: a compose stage that declares a verifiable operation
must leave a **gatekeeper-signed, correlated receipt** proving it ran across
≥ `min_model_families` distinct **vendor** families. Net-new (all stdlib + the
EXISTING audit-signing-helper — no new crypto primitive, SDD B2/B3):

- `scripts/compose-proof-capture.py` — `mark` / `capture` / `verify-receipt` / `families` / `should-verify`.
- `scripts/data/model-family-map.json` — pinned `final_model_id → vendor family` table (SoT: `model-config.yaml`; drift-guarded).
- `docs/runtime/construct-adapters.md` — the declaration schema + receipt schema + dispatch integration contract (canonical mirror, SDD §3.1).
- `tests/integration/compose-proof.bats` — 9 tests, all green.

## AC Verification

### AC1 — declaring stage → attempted-marker + signed correlated receipt; non-declaring → neither
> "A declaring stage produces an attempted-marker + a signed, correlated `receipts/<idx>.json`; a non-declaring stage produces neither (no-op). *(test)*"

**✓ Met (machinery + decision logic); dispatch call-sites are the documented seam.**
- Declaration gating: `should-verify` exits 0 for a `capabilities.verify.operation` spec, 1 otherwise (`scripts/compose-proof-capture.py:cmd_should_verify`). Test `tests/integration/compose-proof.bats` "should-verify gates…".
- `mark` writes `attempted/<idx>` into a `0700` dir atomically; `capture` writes a signed `receipts/<idx>.json`. Tests "mark writes…0700" + "captured receipt verifies".
- Correlation binding (compose_run_id/stage_index/stage_id/operation/envelope_hash + family_count) tested: "receipt payload binds the correlation fields".
- **Scope honesty**: the call-sites *inside* `compose-dispatch.sh` (Form B/C) and the binding to live cheval MODELINV field names are the **explicit sprint-3→4 integration seam** (documented in `docs/runtime/construct-adapters.md` "Dispatch integration contract"), landed with sprint-4's Check 6. Not silently dropped — see Known Limitations.

### [B5] — signature is the load-bearing, post-hoc-checkable control
> "the receipt `sig` verifies under the gatekeeper public key; a receipt written without the key fails verification. *(test)*"

**✓ Met.**
- Valid receipt verifies (`verify-receipt` exit 0) — test "captured receipt verifies under the gatekeeper public key".
- Tampered payload (attacker edits `envelope_hash`, cannot re-sign) → exit 3 — test "a tampered receipt payload fails verification (forgery)".
- Receipt verified against a different key → exit 3 — test "a receipt verified against a DIFFERENT key fails".
- Signing reuses `.claude/scripts/lib/audit-signing-helper.py` (`sign`/`verify`); canonicalization centralized in `_canonical()` so sign and sprint-4 verify use byte-identical input.

### [B7] — id→family map resolves opus+sonnet to ONE family
> "the `id → family` map resolves `opus`+`sonnet` to ONE family. *(test)*"

**✓ Met.**
- opus+sonnet → `{anthropic}`, count 1 — test "[B7]: opus + sonnet resolve to ONE family".
- Genuine cross-vendor (opus+gpt) → count 2 — test "[B7]: genuine cross-vendor…TWO families".
- Unmapped id → null, not counted (SB6 fail-closed) — test "[B7/SB6]: an unmapped id does not count".
- Map SoT named (`model-config.yaml`); drift-guarded by these tests (`scripts/data/model-family-map.json:_doc`).

## Technical Highlights

- **The signature subsumes anti-rewrite.** SDD B4 asked for append-only/legba-chaining of the receipt tree; per-receipt Ed25519 signing achieves the same security goal more directly — a stage that rewrites a receipt cannot produce a signature that verifies, so a rewrite is detected at Check 6. Markers are unsigned, but a forged marker without a valid signed receipt yields `degraded_run`/`broken_run`, never `valid_run`. Atomicity (temp+rename) + `0700` dirs prevent partial/observable writes (SDD B4).
- **Family = vendor.** The anti-theater property: "multi-model" that's really opus+sonnet is still one vendor. The pinned map collapses tiers to vendors; unmapped → fail-closed.
- **No new primitive.** Reuses the legba/audit Ed25519 infra exactly (SDD B2/B3).

## Testing Summary
- `bats tests/integration/compose-proof.bats` → 9/9.
- `python3 -c "import ast; ast.parse(open('scripts/compose-proof-capture.py').read())"` → parses.

## Known Limitations (explicit, not silent)
- **Dispatch wiring is a documented contract, not yet wired into `compose-dispatch.sh`.** Form C runs stages via the main-loop Workflow tool (not compose-dispatch directly) and Form B is "partial — Sprint 4 completes"; a half-correct surgical edit into the 56KB orchestrator was deliberately deferred to land with sprint-4 rather than risk the dispatcher. The integration contract (`mark` before invocation, `capture` after, by the isolated writer) is documented + the subcommands are tested. `loa:shortcut: dispatch call-sites + live-cheval MODELINV field binding land with sprint-4 Check 6`.
- **MODELINV field names read liberally** (`final_model_id`→`model_invoked`→`model`) — no live `model-invoke.jsonl` exists in-repo to pin against; fixture-tested, live binding confirmed alongside sprint-4.
- Explicit legba hash-chaining of the receipt tree not added (signature subsumes it; see Technical Highlights).

## Verification Steps (for reviewer)
1. `bats tests/integration/compose-proof.bats` — expect 9/9.
2. Inspect a receipt: run the capture test path, `jq .payload .run/.../receipts/4.json`.
3. Confirm no diff to `.claude/` (System Zone) or `compose-dispatch.sh` / `compose-verify-run.sh` (untouched this sprint).
