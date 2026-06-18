# Sprint 4 — Senior Lead Review — All good

**Verdict**: APPROVED (cycle 2) · **Reviewer**: senior-lead (adversarial) · **Documentation
verification**: PASS (no manual CHANGELOG convention this cycle — post-merge automation owns it,
consistent with S1–S3; code comments adequate; no new commands/skills needing CLAUDE.md).

Cycle-1 returned CHANGES_REQUIRED on two real defects; both are now fixed and re-verified.

## Previous Feedback Status (cycle 1 → cycle 2)

| Finding | Status | Verification |
|---|---|---|
| **C1** dead `__wave_stalled` branch (`wave-cancel.mjs:113`) | ✓ Resolved | branch removed; `grep -E 'if \(r && r\.__wave_stalled\)'` → none; name survives only in an explanatory comment |
| **C2** `stall_s` not forwarded by `/compose` driver | ✓ Resolved | `skills/compose/SKILL.md` now sets `args.stall_s`; `compose-resolve.mjs:4` doc updated; **regression test** `compose-driver.test.mjs` (casual→90, competitive→45) pins it |

Re-verified: **87/87 laplas · 95/95 bats · emitter `node --check` clean · dispatch determinism guard passes (exit 3)**.

## AC Verification — confirmed against code (not just report)

All six ACs (S4.1–S4.4 + folded B7 + `node --test` green) walked in `reviewer.md` with verbatim
quotes + file:line evidence + tests. Spot-checked the code: schema `minLength:1` floor (named-gap),
own-event-reset (`stall-watch.mjs:36`), automated fail-loud nonzero (`stall-exit.mjs:47-49`),
cooperative-skip + drain-abandon (`wave-cancel.mjs`), and B7 stranding (`runDag` + bats 94). Met.

## Adversarial Analysis

### Concerns Identified
1. **Per-wave false-positive stalls** (`segment-emitter.py makeWaveCancel`) — a legitimately slow
   leaf > `stall_s` is abandoned. Non-blocking: documented P1-minimal (reviewer.md KL§2); `stall_s`
   is now rel-derived end-to-end (C2 fix), so `competitive` correctly tightens to 45s.
2. **C1 reorder safety** (`wave-cancel.mjs`) — the fix moved `__drain_timeout` above
   `__wave_cancelled`. Verified harmless: a result carries exactly one sentinel (mutually exclusive),
   so order does not change classification. 95/95 bats confirms no behavioral change.
3. **`setTimeout` availability in the Workflow sandbox is unverified** — the entire live cancel/drain
   path rides on it. Non-blocking by design: graceful degradation to B7-stranding-only; flagged loud
   in KL§1; requires a live dispatch to confirm in production.

### Assumption Challenged
- **Assumption**: a per-*wave* stall proxy is an acceptable Phase-1 stand-in for per-*leaf*
  progress detection. **Risk if wrong**: false-positive cancels on real slow work. **Recommendation**:
  accepted — SDD scopes per-leaf intra-progress to Phase 1.5; `stall-watch.mjs` (the per-leaf
  progress-reset watchdog) is already built + tested for that handoff.

### Alternative Not Considered
- **Alternative**: driver-orchestrated per-leaf stall detection (chunk waves into smaller Workflow
  calls so the driver's clock + `stall-watch` drive cancellation). **Tradeoff**: real per-leaf
  detection vs more round-trips. **Verdict**: current per-wave proxy justified for P1; the alternative
  is the natural 1.5 path. Noted, not blocking.

## Approval

All good — Sprint 4 (the keystone, with folded S3.4/x7l) approved. Proceed to security audit.
The integration-only residual risk (KL§1, `setTimeout`) is honestly disclosed, not overclaimed.
