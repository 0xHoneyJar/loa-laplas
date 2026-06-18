# Sprint 4 — Security Audit — APPROVED - LETS FUCKING GO

**Auditor**: Paranoid Cypherpunk · **Verdict**: APPROVED (no CRITICAL/HIGH) · **Cycle**: 2
**Scope**: 5 new laplas modules + 2 schemas + the emitter DAG-wave-loop rewrite (S4.4 + folded
S3.4/x7l). Audited actual code, not just the report.

## Threat model walked

This sprint touches a **code generator** (`segment-emitter.py` → emitted Workflow JS) and a
**wave orchestrator** — so the paranoia went to injection-into-emitted-code, unbounded
hang/DoS, input validation, and prototype pollution. Not auth/secrets/network (none touched).

| Surface | Finding |
|---|---|
| **Injection into emitted code** | CLEAN. The inline block is STATIC trusted code (no composition value flows in) emitted raw; the dispatch determinism guard (`workflow-syntax-check`) greps source for `Date`/`Math.random` and **aborts** — verified passing (a comment mentioning `Date.now` was caught and reworded). `_inline_block` reads a hardcoded filename; `_laplas_const` reads integer constants via anchored regex. No user input reaches the generator. |
| **Input validation (`stall_s`)** | PRESENT. `makeWaveCancel` guards `Number.isInteger(input.stall_s) && input.stall_s >= 1` before use → 0/negative/non-int falls back to `DEFAULT_STALL_S`. `stall_s` is rel-derived (casual 90 / competitive 45), not directly attacker-set. |
| **DoS / unbounded hang** | BOUNDED with timers (the drain deadline abandons laggards, D13). Without `setTimeout` (unverified sandbox) the wave relies on the runtime's own agent timeout — pre-existing runtime behavior, documented (reviewer.md KL§1). `MAX_DAG_ITEMS=64` already caps fan-out; the wave loop is iterative (no unbounded recursion). |
| **Secrets / PII** | NONE added. |
| **Error handling** | Fail-loud: typed sentinels, nonzero stall exit, no silent swallow. |

## Findings (none blocking)

### M1 (MEDIUM, non-blocking) — reserved-key item ids silently drop in `runDag` / the emitted `dagValidate`

**Verified empirically**: an item with id `__proto__` (or `constructor`/`prototype`) is
**silently lost** from `itemResults`/`failed`/`stranded` (per-object prototype reassignment) —
**NOT** global `Object.prototype` pollution (`({}).output === undefined`), and **not** RCE.
The emitted `dagValidate` (`segment-emitter.py:1150-1155`) checks `{id,task}` + dedup but does
NOT reject reserved ids, **inconsistent with the existing prototype-magic guard for
`output_schema`** (`segment-emitter.py:914`, bats 63/64).

- **Impact**: a reserved-id item is silently dropped (could mask a stranding/failure). Requires
  controlling item ids — the decomposer path is behind the S2 security boundary; the pre-supplied
  `args.items[]` path is operator-trusted (RFC #35).
- **Why non-blocking**: not exploitable for RCE or global pollution; mostly pre-existing on the
  `itemResults[id]` path (my change extends it to `failed`/`stranded`).
- **Required follow-up**: add a reserved-id reject to `dagValidate` (and/or `runDag`), matching
  the `output_schema` guard. Filed as a bead.

### L1 (LOW, forward-looking) — `named_gap.evidence` carries raw task content

`diagnose.mjs` puts `String(stalledLeaf.task).slice(0,120)` into `evidence`. In Phase 1 the
`named_gap` is telemetry only (never fed to an LLM), so no live injection path. **When Phase 1.5
wires summon** (feeding `named_gap` into a summon prompt), `evidence` MUST be sanitized — same
class as the B4 retry-feedback sanitization (S3.2). Note for 1.5; not actionable now.

### L2 (LOW) — `incident`/`named_gap` bodies are untrusted at surfacing

Consistent with L5/L6/L7 discipline: the `stalled_no_summon` incident carries `named_gap`
(with task-derived evidence). Consumers must sanitize at surfacing, not interpret as
instructions. Phase-1 it's only written to telemetry. Note.

## Decision

**APPROVED.** No CRITICAL/HIGH. M1 is a real defense-in-depth gap but non-exploitable
(silent loss, not pollution/RCE) and mostly pre-existing — proportionate to fix as a tracked
follow-up, not to block the Phase-1 keystone. The implementation's honesty about the
integration-only `setTimeout` residual (KL§1) is exactly what an auditor wants to see —
no overclaiming. Sprint 4 (and the folded S3.4/x7l) is complete.
