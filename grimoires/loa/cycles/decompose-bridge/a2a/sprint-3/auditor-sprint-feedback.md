# Sprint 3 — Security Audit (Paranoid Cypherpunk Auditor)

APPROVED - LETS FUCKING GO

Sprint 3 adds the one LLM call, the decomposer binary, the /compose driver, and a live-emitter
config touch. Two-pass taint audit clean: no CRITICAL/HIGH. The D9 canonicalization gap was caught
at review and hardened (commit `00cba83`).

## Two-Pass Taint Analysis

**Sources (untrusted)**: the `goal`; the split provider's output (an LLM — untrusted by
construction); the worker `claim`. **Sinks**: the `claude` CLI spawn; the emitted workflow's
fan-out.

**Taint paths — all bounded by validation:**
1. `goal → sanitizeGoal (S2, stdin + fail-closed) → split prompt`. The goal is detector-screened
   before it reaches the splitter LLM.
2. `provider output → parseItems (raw-item §0.3 schema) → deriveRouting → dagValidate (role↔roster,
   cycle, bounds)`. An injected split that emits a malicious DAG is rejected: unknown role →
   ROLE_MISS → exit 3; bad structure → fail → exit 3. The LLM cannot mint a runnable item the
   roster didn't authorize.
3. `items → emitter`. The emitter **re-validates** (`dagValidate` in the emitted JS: MAX_DAG_ITEMS,
   cycle, unknown-tier fail-loud) — defense-in-depth, double validation.
4. `prompt → claude CLI`. `spawnSync('claude', ['-p','--model','sonnet'], { input: prompt })` —
   prompt via **stdin**, array args, **no shell**. No command injection.
5. ROLE_RETRY feedback → next prompt: stripped to the role-id charset first (B4); the retry DAG
   must match the original id-set (D9, now JSON.stringify-canonical — airtight).

## Checklist
| Control | Verdict | Evidence |
|---------|---------|----------|
| Secrets | PASS | grep clean across all 5 new modules |
| Command injection | PASS | claude CLI via stdin+array args; no exec()/shell-string; argv read, never eval'd |
| Input validation | PASS | raw-item schema + dagValidate (twice: decompose + emitter); 16KB cap + detector upstream |
| Auth / privilege | PASS | the LLM can't authorize a role/tool the roster lacks (ROLE_MISS → exit 3) |
| Retry safety | PASS | B4 feedback sanitized; D9 id-set airtight (`decompose.mjs:67`) |
| Info disclosure | PASS | refusal details don't echo the goal; driver output carries no secrets |
| Live-emitter change | PASS | gateBatchMax/width are integer-guarded; batching only, no security surface; bats 94/94 |

## Findings (non-blocking)
- **MEDIUM-1 — driver invocation interpolates the untrusted goal into a shell command.**
  `skills/compose/SKILL.md` step 2.5 documents `node compose-resolve.mjs --goal "<goal>"`. There is
  **no vulnerable code path** (the CLI reads `process.argv` safely), but an executor that
  string-interpolates an untrusted goal into that shell line (esp. with double-quotes) has a
  breakout vector (`"`, `$`, backtick). **Recommend**: `compose-resolve.mjs` accept the goal on
  **stdin**, and SKILL.md step 2.5 pipe it (`printf '%s' "$goal" | compose-resolve.mjs --goal-stdin`)
  rather than argv. Filed: beads `construct-rooms-substrate` (hardening). Non-blocking — it's a doc
  footgun, not a code CVE.
- **INFO** — `claude-provider.mjs` untested (D8 design); gate_batch_max is integer-typed so a
  stringified value silently falls back to RATE_BOUND (graceful). Both already noted at review.

## Dissenter
`flatline_protocol.security_audit.enabled` not set → single-auditor verdict; no DEGRADED marker
(disabled, not a failed attempt).

## Verdict
No CRITICAL/HIGH. S3.4 stranding correctly deferred (beads x7l). APPROVED. Sprint 3 may complete.
