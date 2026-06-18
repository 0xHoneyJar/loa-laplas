# Sprint 2 — Senior Tech Lead Review

All good (with noted concerns)

Reviewed the actual implementation (not just the report). All 6 Sprint-2 ACs are met with
file:line evidence; `reviewer.md` citations re-verified against source — accurate. One
blocking finding was raised and **fixed within this review cycle**; three non-blocking
concerns are documented and acknowledged.

## Blocking finding — RESOLVED

### C1 — Sentinel envelope breakout (`laplas/lib/sentinel.mjs`)
The collision check originally guarded only the unguessable UUID (the *opening* tag). The
*closing* `</goal>` is not id-bound, so a goal containing literal `</goal>` could break out
of the envelope into the worker's instruction surface — the classic delimiter-breakout, and
the collision that AC-S2.1's "input collision check" most needs to catch. **Fixed** (commit
`87c33d5`): `sentinelWrap:15-26` now rejects any goal carrying sentinel tag syntax with a
fail-closed `exit 4`, plus a regression test and a false-positive guard
(`worker-boundary.test.mjs:55-67`). Suite 54→55 green.

## Adversarial Analysis

### Concerns Identified
1. **C1 (resolved above)** — `sentinel.mjs` closing-tag breakout.
2. **`workerLoadout` drops the role** (`containment.mjs:17`) — S2.3 says "tools from
   role+loadout" but the floor is dungeon-only (the party schema has no per-role loadout;
   the dungeon is the provisioning authority). Goal-independence — the actual security
   property — holds structurally. Non-blocking; explicit in NOTES Decision Log.
3. **`gateVerifiesGoal` is structural-only** (`gate-verifies-goal.mjs:7-18`) — catches a
   *sentinel* mismatch (= answered an injected goal), not semantic "right sentinel, wrong
   work." Correct for S2's injection threat model. Non-blocking; flagged so it's not silent.

### Assumptions Challenged
- **Assumption**: a hung detector surfaces as `ETIMEDOUT`/`SIGTERM` (`sanitize-goal.mjs:38`).
  **Risk if wrong**: a SIGTERM-trapping detector evades the timeout classification.
  **Resolution**: the catch-all fail-closed branch (`:46-48`) blocks *every* unclassified
  outcome, so the assumption is safely bounded. Validated, no change.

### Alternatives Not Considered
- **Alternative**: escape (`<`/`>` → entities) rather than reject tag-bearing goals (C1).
  **Tradeoff**: more permissive but adds a second decode contract that, if drifted, reopens
  the hole. **Verdict**: reject is the right Phase-1 call; revisit only with a real corpus.

## Non-Critical (recommended, non-blocking)
- `sanitize-goal.mjs:23` — `DEFAULT_DETECTOR` is layout-bound (`../../.claude/...`); fine for
  the current repo-root layout, mitigated by `opts.detector`. Consider a config/env fallback
  when S3 wires it.

## Documentation Verification: PASS
- New security code (size-cap, sentinel, sanitize, containment, gate) carries explanatory
  comments tracing each control to its Flatline finding. NOTES Decision Log updated. No new
  user-facing command/route (internal laplas primitives), so CLAUDE.md/README N/A.

## Decision
Approved. All ACs met, C1 resolved, suite green (55/55). Proceed to security audit.
