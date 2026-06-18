# Sprint 3 — Implementation Report

> Cycle: decompose-bridge · Branch: cycle/decompose-bridge · Sprint 3 of 4
> **Status: S3.1–S3.3 complete; S3.4 config-touch complete; S3.4 stranding DEFERRED.**
> S3.1 (split-goal), S3.2 (decompose binary), S3.3 (/compose driver wiring) are done and
> tested. S3.4's **gate-batch-cap config touch** (gate_batch_max → emitter wave width) is done
> and verified (emitter bats 94/94). S3.4's **DEPENDENCY_FAILED stranding rewrite + G-6
> benchmark** is deferred by operator decision (beads `construct-rooms-substrate-x7l`) — it
> rewrites the live emitter's wave-failure semantics (every composition) with an integration-only
> AC. Ready for review/audit on the in-scope work.

## Executive Summary

The bridge now has its LLM stage and its binary. `split-goal.mjs` puts the one sonnet call
behind a provider interface (Flatline D8) so it mocks deterministically; `decompose.mjs` wires
the S1 deterministic core and the S2 security boundary around it into a single typed result
with the §0.2 exit matrix, bounded role-retry (sanitized feedback, B4), and the same-id-set
retry contract (D9). 8 new tests, mocked-provider; full suite **63/63 green**.

G-1 ("`/compose <bare goal>` auto-fans") becomes *real* only once S3.3 wires the binary into
the driver — the binary itself is proven to auto-fan a mocked split (AC-S3.2).

## AC Verification (S3.1 / S3.2 — the in-batch ACs)

### AC-S3.1
> "AC-S3.1: mocked provider returns {valid, fenced, malformed, empty, network-error} → correct
> typed outcome + exit per §0.2."

**✓ Met.** `splitGoal` (`laplas/lib/split-goal.mjs:67`) maps each case: valid/fenced → `raw`
(fence-strip at `:27`), empty → `serial LLM_EMPTY`, malformed (after retry) → `serial
INDIVISIBLE`, provider-throw (after retry) → `fail LLM_FAILURE` (→ exit 5). Evidence:
`laplas/test/decompose-binary.test.mjs:34-46`.

### AC-S3.2 (G-1)
> "AC-S3.2 (G-1): a bare multi-domain goal → ≥2 construct-routed parallel items in ≥1 wave
> (mocked split)."

**✓ Met (binary level).** `decompose` (`laplas/bin/decompose.mjs:37`) runs
loadRoster→size-cap→sanitize→split→derive→dagValidate→typed emit; a mocked 2-domain split
yields a `dag` of 2 role-routed items both runnable in the first wave. Evidence:
`laplas/test/decompose-binary.test.mjs:58-67`. **Runtime G-1** (`/compose <goal>` auto-fans)
lands with S3.3.

### AC-S3.2b
> "AC-S3.2b: a hallucinated role corrected within ROLE_RETRY; persistent → exit 3 (P601). A
> hallucinated role containing injection syntax is sanitized before the retry prompt (Flatline
> B4 fixture)."

**✓ Met.** ROLE_MISS retries with feedback (`decompose.mjs:71-72`); the feedback is stripped to
the role-id charset before re-entering the prompt (`safeFeedback`, `decompose.mjs:31-34`, B4);
persistent → exit 3 P601 (`:73`). Also covered: D9 — a retry with a different id-set → exit 3
P602 (`:58-60`). Evidence: `decompose-binary.test.mjs:77-101` (corrected / persistent / B4 /
D9).

### §0.2 exit matrix
> Exit codes 0/3/4/5/6/7 per §0.2.

**✓ Met.** size→7, sanitize→4, roster→6, LLM→5, dagValidate→3, ok→0. Evidence:
`decompose-binary.test.mjs:104-119` + the AC tests above.

### AC-S3.3
> "AC-S3.3: `/compose <goal>` auto-fans; `refusal`→no worker; `serial`→single-context; a
> pre-supplied items[] skips the decomposer (RFC #35 unchanged)."

**✓ Met.** `resolveComposeItems` (`laplas/lib/compose-items.mjs`) branches decompose's typed
result: `dag`→`{mode:'fanout', items}` (emitter-shaped, with the tier→intelligence_tier map so
an opus leaf is `deep`, never silently downgraded), `serial`→`{mode:'single'}`,
`refusal`→`{mode:'refuse'}` (do not run). A pre-supplied `items[]` returns `{mode:'bypass'}`
**without ever consulting decompose** (D10). Driver CLI: `laplas/bin/compose-resolve.mjs`;
wired into the executor at `skills/compose/SKILL.md` step 2.5. Evidence:
`laplas/test/compose-driver.test.mjs:18-71` (bypass proven by an oversized goal that still
bypasses; fanout shape; opus→deep; single; refuse).

### AC-S3.4
> "AC-S3.4 (G-6): a >8-item DAG (casual) → sequential gate passes; gate wall-clock ≤
> `GATE_LATENCY_BOUND` (25% of wave) on the benchmark; a failed batch strands dependents with
> `DEPENDENCY_FAILED`, independent batches complete."

**⚠ Partial — config touch Met, stranding [ACCEPTED-DEFERRED].** The gate-batch-cap is wired:
the emitter's DAG fan-out now batches each wave by `rel_policy.gate_batch_max` (casual 8 /
competitive 4) instead of the hardcoded `RATE_BOUND` — `boundedParallel` is width-parameterized
(`scripts/lib/segment-emitter.py`, default `RATE_BOUND` so existing callers are byte-identical),
`gateBatchMax` derived from `input.gate_batch_max`, passed at the wave dispatch; surfaced to the
driver as `compose-items.mjs` `gate_batch_max`. Verified: emitter bats **94/94** green; emitted
JS inspected for the wiring; driver test asserts casual→8.
The **`DEPENDENCY_FAILED` stranding** (rewrite the wave loop so a failed item strands only its
dependents while independent batches complete) and the **G-6 wall-clock benchmark** are deferred
to beads `construct-rooms-substrate-x7l` — a live-emitter behavioral change with an
integration-only AC, paired out by operator decision (NOTES Decision Log).

## Tasks Completed

| Task | File | Tests |
|------|------|-------|
| S3.1 split-goal provider boundary | `laplas/lib/split-goal.mjs` | AC-S3.1, stripFences |
| S3.2 decompose binary (core + main) | `laplas/bin/decompose.mjs` | AC-S3.2, AC-S3.2b, §0.2, D9 |
| S3.3 driver decision + CLI | `laplas/lib/compose-items.mjs`, `laplas/bin/compose-resolve.mjs`, `skills/compose/SKILL.md` (step 2.5) | AC-S3.3 (bypass, fanout, tier-map, single, refuse) |
| S3.4 gate-batch-cap (config touch) | `scripts/lib/segment-emitter.py` (boundedParallel width + gateBatchMax) | emitter bats 94/94; driver test casual→8 |
| (runtime provider) | `laplas/lib/claude-provider.mjs` | runtime-only (see Limitations) |

## Technical Highlights
- **Provider boundary (D8).** `splitGoal`/`decompose` take `opts.provider`; the failure taxonomy
  is principled — a *throw* is a transport failure (retry → exit 5), a *successful-but-unusable*
  response (empty/non-JSON) degrades to `serial`, never a hard failure.
- **B4 feedback sanitation** strips the hallucinated role to `[A-Za-z0-9_-]` before it re-enters
  the LLM — closing the loop where an injected role name could otherwise re-prompt the model.
- **D9 id-set contract** rejects a retry that returns a structurally-different DAG, so the retry
  fixes the role, not the plan.

## Known Limitations
- **`claude-provider.mjs` is runtime-only, not unit-tested** — no real LLM in tests by design
  (D8). It is ~10 lines, isolated behind the provider boundary; if the `claude` CLI shape drifts
  it is the single line to fix.
- **S3.3/S3.4 deferred** — the binary does not yet run inside `/compose`; the gate batch cap is
  not yet in the Python emitter. Sprint 3 is not complete until these land.

## Verification Steps
1. `node --test laplas/test/*.test.mjs` → expect `63 pass / 0 fail`.
2. `node --test laplas/test/decompose-binary.test.mjs` → the 8 S3.1/S3.2 ACs.
