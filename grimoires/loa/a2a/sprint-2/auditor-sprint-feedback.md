# Sprint 2 — Security Audit (Paranoid Cypherpunk Auditor)

APPROVED - LETS FUCKING GO

Sprint 2 IS the security boundary, so it got the two-pass taint audit it deserves. The one
HIGH (sentinel `</goal>` breakout) was already caught at review and fixed (commit `87c33d5`).
No CRITICAL or HIGH remain. Only informational observations below.

## Two-Pass Taint Analysis

**Sources (untrusted)**: the `goal` (primary), the detector's stdout, the worker's `claim`.
Semi-trusted: `dungeon`/`roster` (from manifests), `opts.*` (caller/binary-controlled).

**Sinks reviewed**: exactly one — `spawnSync` in `sanitize-goal.mjs:33`.

**Taint paths (goal → sink)** — all terminate safely:
1. `goal → checkSize` (`size-cap.mjs`) → `Buffer.byteLength` only. No execution.
2. `goal → sentinelWrap` (`sentinel.mjs`) → string-wrapped; the breakout guard (`:15-26`)
   rejects `<goal …>`/`</goal>` so the goal cannot escape the envelope. Output is a returned
   string, not executed here.
3. `goal → sanitizeGoal → spawnSync` (`sanitize-goal.mjs:33-35`) → **goal goes to `input:`
   (stdin); argv is the constant `['--threshold','0']`**. Verified: no goal substring in argv
   (`worker-boundary.test.mjs:55-63`). The detector path is the fixed `DEFAULT_DETECTOR` or a
   caller-supplied `opts.detector` — never goal-derived. **No command injection.**
4. `dungeon.tools → workerLoadout → canCallTool` (`containment.mjs`) → whitelist membership
   check; tool names are compared, never invoked. Floor is goal-independent (structural authz).
5. `claim → gateVerifiesGoal` (`gate-verifies-goal.mjs`) → string comparison of sentinel ids.

## Checklist

| Control | Verdict | Evidence |
|---------|---------|----------|
| Secrets / hardcoded creds | PASS | grep clean across all 5 modules |
| Command injection | PASS | goal via stdin only; argv constant (`sanitize-goal.mjs:33-34`) |
| Input validation / DoS | PASS | 16KB byte cap (exit 7), 2s detector timeout fail-closed, `maxBuffer` 1MB, linear regex |
| Auth / privilege escalation | PASS | privilege floor goal-independent (`workerLoadout` takes no goal); gate-verifies-goal blocks sentinel confusion |
| Fail-closed | PASS | every detector failure mode (timeout/crash/unparseable) → `exit 4` (`sanitize-goal.mjs:37-48`) |
| Info disclosure / reflection | PASS | no refusal `detail` reflects the raw goal back (grep clean) — no log-injection/XSS surface |
| Boundary integrity | PASS | sentinel rejects both id-collision AND tag-breakout (C1 fixed) |
| Tests | PASS | `node --test laplas/test/*.test.mjs` → 55/55 |

## Informational (no action required this sprint)
- **INFO-1** `spawnSync` is synchronous (blocks up to `timeoutMs`). Correct for a CLI binary;
  flag if these primitives are ever reused in an event-loop/server context.
- **INFO-2** Module-ordering (size-cap before sentinel/sanitize) is enforced by the S3 wiring
  (`sprint.md` S3.2), not by the primitives themselves. `sanitizeGoal` is independently
  bounded by `maxBuffer`, so the defense-in-depth gap is mild. Verify the S3 order at S3 audit.
- **INFO-3** `opts.detector` / `opts.spawn` are caller-controlled seams (test/provider
  boundary). **S3 must never plumb a goal-derived value into them** — note for the S3 audit.

## Dissenter
`flatline_protocol.security_audit.enabled` is not set → cross-model dissenter not required;
single-auditor verdict. No DEGRADED marker required (empty/disabled, not a failed attempt).

## Verdict
No CRITICAL/HIGH. APPROVED. Sprint 2 may complete.
