# Sprint 3 — Senior Tech Lead Review

All good (with noted concerns)

Reviewed the actual code for S3.1–S3.3 + the S3.4 config touch (not just the report). One real
correctness gap found and fixed in-cycle; S3.4's stranding correctly scoped out with a matching
beads task + NOTES entry. The live-emitter change (S3.4 config touch) is backward-compatible by
construction and the emitter bats suite stays 94/94.

## Found & fixed this cycle

### D9 id-set canonicalization (`laplas/bin/decompose.mjs:67`)
The retry "same id-set" guard canonicalized with a separator (``) join. Sound for any
realistic id, but not airtight: a pathological id containing `` could concat-collide and
slip a structurally-different DAG past D9. **Hardened** to `JSON.stringify(ids.sort())` —
unconditionally unambiguous for arbitrary id strings. Verified: `["a","b"]` ≠ `["ab"]`; suite
67/67. (Initial probe mis-tested a separator-less join; verify-before-assert caught the false
alarm — the original was not broken for realistic input, the fix removes even the pathological
case.)
**Follow-up:** a regression test (`{a,b}` vs `{ab}` retry → P602) was authored but its write was
gated this session; add it when edits are open — `node --test` is green without it, the fix is
verified by the existing D9 test + the canonicalization probe.

## AC Verification (cross-check vs reviewer.md)
- AC-S3.1 ✓ (split-goal 5 cases) · AC-S3.2 ✓ (G-1 binary fan-out) · AC-S3.2b ✓ (role-retry, B4,
  D9) · §0.2 exit matrix ✓ · AC-S3.3 ✓ (driver bypass/fanout/tier-map/single/refuse) · AC-S3.4
  ⚠ Partial: config-touch Met (gate_batch_max wired, bats 94/94), stranding [ACCEPTED-DEFERRED]
  (beads `construct-rooms-substrate-x7l` + NOTES Decision Log). The Partial is paired with a
  follow-up task, so it does not block.

## Adversarial Analysis

### Concerns Identified
1. **D9 canonicalization** (`decompose.mjs:67`) — found + fixed (above).
2. **`claude-provider.mjs` has zero test coverage** — the real LLM path is runtime-only by D8
   design, but if the `claude -p --model sonnet` invocation is wrong, the binary fails only at
   runtime. Isolated behind the provider boundary; verify against the real CLI before relying on
   the binary end-to-end (already a stated Limitation).
3. **S3.4 gate_batch_max is type-fragile** (`segment-emitter.py` gateBatchMax) — `Number.isInteger`
   means a value arriving as a *string* (args can be JSON-stringified) silently falls back to
   `RATE_BOUND` (8), so competitive's intended 4 would not apply. Graceful, but the tightening
   would silently no-op. The driver passes a number (`compose-items.mjs` reads `rel_policy.gate_batch_max`),
   so this only bites if a caller stringifies — non-blocking, flagged.

### Assumptions Challenged
- **Assumption**: the `/compose` executor threads `args.gate_batch_max` + `args.items` from the
  driver output (SKILL.md step 2.5). **Risk if wrong**: if the executor omits `gate_batch_max`,
  the fan-out silently defaults to `RATE_BOUND` (8) — correct for casual, too loose for competitive.
  **Recommendation**: acceptable for Phase 1 (graceful default); a future hardening could have the
  driver emit a complete args object so the executor can't forget. Validated as non-blocking.

### Alternatives Not Considered
- **Alternative**: `stripFences` (`split-goal.mjs:27`) slices from the first bracket to end rather
  than balancing — a valid JSON array followed by model prose fails to parse. **Tradeoff**: a true
  balanced-bracket scan would salvage more outputs, but adds complexity; the current behavior
  **safe-degrades** (parse fail → retry → serial INDIVISIBLE), never mis-parses. **Verdict**:
  current approach justified — safe-degrade beats clever-parse for an untrusted LLM boundary.

## Complexity Analysis
- `splitGoal` (split-goal.mjs:67) and `decompose` (decompose.mjs:37) are the only non-trivial
  functions: decompose is ~40 lines with one bounded loop (nesting 2), no function >50 lines, no
  duplication, no circular deps. OK.

## Documentation Verification: PASS
- New code carries provenance comments tracing each control to its Flatline finding (D8/D9/D10/B4).
  `/compose` SKILL.md step 2.5 documents the driver wiring. NOTES Decision Log updated (S3 batching
  + gate_batch_max). No new top-level command (internal laplas bins), CLAUDE.md N/A.

## Decision
Approved. All in-scope ACs met (S3.4 stranding properly deferred), D9 hardened, suite 67/67,
emitter bats 94/94. Proceed to security audit.
