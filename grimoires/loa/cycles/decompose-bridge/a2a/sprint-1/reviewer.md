# Sprint 1 Implementation Report — Deterministic Routing Core + Roster Contract

**Cycle**: decompose-bridge · **Branch**: cycle/decompose-bridge · **Date**: 2026-06-13

## Executive Summary

Sprint 1 ships the **deterministic routing core** of the decomposition bridge — the pure, fully-testable foundation that turns a raw item DAG + a composition manifest into routed, validated `items[]` (or a typed `serial`/`refusal`/`fail`), with **no LLM in the loop**. 8 source modules + 2 schema files under `laplas/`, zero new dependencies (house zero-dep pattern; reuses the existing draft-07-subset validator convention). 8 new tests, all green; full laplas suite 43/43.

## AC Verification

Every AC walked verbatim from `grimoires/loa/sprint.md` Sprint 1.

> **AC-S1.1**: `relPolicy('casual','automated').summon_approval==='auto'`; `relPolicy('competitive','automated').summon_approval==='fail'`.
- **✓ Met** — `laplas/lib/rel-policy.mjs:13-17` (run_mode override); asserted `laplas/test/decompose-core.test.mjs:34-41`.

> **AC-S1.2**: declared `covers_domains:['code']` → `gateBlind('code')===false`, `gateBlind('contracts')===true`; undeclared gate covers room domain only.
- **✓ Met** — `laplas/lib/gate-coverage.mjs:11-22` (back-compat: declared domain only, never `*`); asserted `decompose-core.test.mjs:45-56` (incl. the no-wildcard + covers-nothing cases).

> **AC-S1.4**: opus **iff** gate_blind OR high_centrality; gate-covered low-centrality leaf → `tier_default`. (G-3 unit.)
- **✓ Met** — `laplas/lib/opus-predicate.mjs:11-13` + `placeTier` 17-25; asserted `decompose-core.test.mjs:60-82` (covered→sonnet, blind→opus, high-centrality→opus).

> **AC-S1.5** (determinism): identical inputs → byte-identical `items[]` across two runs (stable order, sorted deps).
- **✓ Met** — `laplas/lib/derive-routing.mjs:24-46` (map preserves order; `depends_on` sorted at :32; primitive fields); asserted `decompose-core.test.mjs:95-113` (byte equality + sorted deps).

> **AC-S1.6**: the fixture table {cycle, dangling, dup, role-miss, multi-domain, below-`CONFIDENCE_FLOOR`(0.6), 0-items, >`N_MAX_ITEMS`} → the exact typed outcome + exit code per §0.2.
- **✓ Met** — `laplas/lib/dag-validate.mjs:14-49`; asserted `decompose-core.test.mjs:117-138` — CYCLE/DANGLING_DEP/DUP_ID/ROLE_MISS/BOUNDS → `fail`; DOMAIN_AMBIGUOUS/EMPTY → `refusal`; LOW_CONFIDENCE → `serial`; happy → `dag`.

> **AC-S1.7**: empty/malformed roster → exit 6.
- **✓ Met** — `laplas/lib/roster.mjs:12-29` (`rosterFromParty`/`loadRoster`); asserted `decompose-core.test.mjs:142-152` (empty members, no members, bad tier → `{ok:false, exit:6}`).

> **AC-S1.7b** (tier_ceiling, Flatline D5): a role whose `opus_predicate` tier exceeds its roster `tier_ceiling` → clamped + flagged.
- **✓ Met** — `laplas/lib/opus-predicate.mjs:20-24` (clamp); asserted `decompose-core.test.mjs:86-91` (gate-blind leaf w/ role ceiling sonnet → `tier:'sonnet'`, `tier_clamped:true`).

## Tasks Completed

| Task | File | Lines | Approach |
|------|------|-------|----------|
| S1.8 | `laplas/lib/constants.mjs` | 11 | The §0.4 pinned constants, single source for S1+S3. |
| S1.8 | `laplas/schemas/raw-item.schema.json` | 14 | §0.3 raw-item contract (draft-07 subset). |
| S1.8 | `laplas/schemas/decompose-result.schema.json` | 16 | §0.1 typed envelope (dag\|serial\|refusal); `fail` is internal→exit 3, excluded. |
| S1.1 | `laplas/lib/rel-policy.mjs` | 19 | REL→policy struct; run_mode override (no headless deadlock). |
| S1.2 | `laplas/lib/gate-coverage.mjs` | 22 | per-composition coverage; back-compat domain-only default (B2). |
| S1.3 | `laplas/lib/centrality.mjs` | 21 | transitive downstream-dependent count. |
| S1.4 | `laplas/lib/opus-predicate.mjs` | 25 | opus predicate + tier_ceiling clamp. |
| S1.5 | `laplas/lib/derive-routing.mjs` | 49 | raw→routed; validator-confidence vs model-self-confidence telemetry (B7). |
| S1.6 | `laplas/lib/dag-validate.mjs` | 73 | typed outcomes; iterative DFS cycle detection. |
| S1.7 | `laplas/lib/roster.mjs` | 38 | party.members → roster; exit 6 on invalid. |
| tests | `laplas/test/decompose-core.test.mjs` | 154 | 8 tests, one per AC. |

## Technical Highlights

- **Determinism by construction** (B7 + AC-S1.5): the only nondeterministic step (the LLM split) is S3's; S1 is pure functions. `decomposition_confidence` is a **deterministic** signal (domain ∈ known-domain set), NOT the model's self-report (which is carried separately as `model_confidence` telemetry).
- **Conservative gate default** (Flatline-SDD B2): an undeclared gate covers its room's domain *only* — never `*` — so the failure mode is over-provision (opus), never under-gate. Verified by the no-wildcard test.
- **Distinct domain failure modes**: a *multi-valued/empty* domain → `DOMAIN_AMBIGUOUS` refusal (unsafe to route); a *single-but-unknown* domain → lowers confidence → `LOW_CONFIDENCE` serial (safe degradation). These never collide.
- **Zero-dep**: no Zod/ajv (the SDD's "Zod" reconciled to the house `validate-schema.mjs` subset convention); only Node builtins.

## Testing Summary

- **New**: `laplas/test/decompose-core.test.mjs` — 8 tests (one per AC) + `resolveDomain` unit. All pass.
- **Full suite**: `node --test laplas/test/*.test.mjs` → **43 pass / 0 fail** (8 new + 35 existing; no regression).
- **Run**: `node --test laplas/test/*.test.mjs`

## Known Limitations

- **Pre-existing (not introduced here)**: `node --test laplas/test/` (the bare-directory form in the existing test headers) fails on Node 23.3 with `MODULE_NOT_FOUND` on the directory — the explicit glob `node --test laplas/test/*.test.mjs` is the working invocation. Flagged for a separate doc/CI fix, out of Sprint-1 scope.
- The "domain registry" for `resolveDomain` is minimal in S1 (single-value resolution + known-domain set from coverage∪role-domains). A richer registry is deferred; the one-room-one-domain invariant is enforced (multi-value → refusal).
- The role-hallucination **retry hook** is a no-op stub here (ROLE_MISS → `fail` directly); S3 wraps `dagValidate` with bounded retry-with-feedback before the hard exit, per the sprint plan.
- `centrality` uses transitive downstream-dependent count (the load-bearing-node intent); documented at `centrality.mjs:5-7`.

## Verification Steps (for reviewer)

1. `node --test laplas/test/*.test.mjs` → expect 43 pass / 0 fail.
2. Inspect `laplas/lib/gate-coverage.mjs:11-22` — confirm no `['*']` default.
3. Inspect `laplas/lib/derive-routing.mjs:40-43` — confirm gating confidence is deterministic, model self-confidence is telemetry-only.
4. Confirm scope is surgical: only new files under `laplas/lib`, `laplas/schemas`, `laplas/test`; the emitter and S2/S3/S4 untouched.

## Feedback Addressed (review iteration 1)

Reviewer APPROVED (43/43) with non-blocking concerns. Each real concern is fixed; the deferred S3 footgun is left intentionally. Suite now **44/44** (one new regression test).

| # | Reviewer concern | Resolution | Where |
|---|------------------|-----------|-------|
| 1 | **`rosterFromParty` cannot load the repo's own `party-good.json`** — `tier:"external"` exit-6'd, and the HITL `operator` member (no `role`) would also fail. | Widened the valid tier set to include `external` (typos like `gpt9` still reject); HITL members (`kind==='hitl'`) are skipped as operator seats, not routable roles; zero agent roles after skipping → still exit 6. | `laplas/lib/roster.mjs:10` (TIERS), `:21` (hitl skip), `:35` (no-agent-roles → exit 6) |
| 2 | **`EMPTY` refusal contract drift** — schema invented an `EMPTY` `refusal_reason`; §0.1 maps 0-items to a SERIAL (`LLM_EMPTY`), not a refusal. | 0-items → `{type:'serial', fallback_reason:'LLM_EMPTY'}`; removed `"EMPTY"` from the schema's `refusal_reason` enum. | `laplas/lib/dag-validate.mjs:22` (serial LLM_EMPTY), `laplas/schemas/decompose-result.schema.json:11` (enum) |
| 3 | **Duplicate-role first-write-wins footgun** — second member's tier silently dropped; ceiling decided by array order. | Dedup now keeps the **most restrictive** (lowest-rank) tier as `tier_ceiling` (haiku<sonnet<opus, external≡opus-rank); order-independent / deterministic. | `laplas/lib/roster.mjs:13,29` (TIER_RANK + min-ceiling merge) |
| — | **Speculative `seat:'review'` gate branch** — no fixture uses it; only `council`/`work` exist. | Dropped the `seat==='review'` branch; gate coverage adds `council` seats only. | `laplas/lib/gate-coverage.mjs:16` |
| — | **`TIER_RANK` missing `external`** (so a clamp could wrongly drop opus below an external ceiling). | Added `external: 2` to the opus-predicate rank map. | `laplas/lib/opus-predicate.mjs:6` |

**New regression test** (the one that would have caught concern #1): `laplas/test/decompose-core.test.mjs:145` — loads `party-good.json` via `fileURLToPath`/`import.meta.url`, asserts `ok:true` with the 4 agent roles (`auditor`, `scribe`, `reviewer-a`, `reviewer-b`) and the HITL `operator` skipped, and that the `external` ceiling is carried through. AC-S1.6's 0-items case updated to expect `serial/LLM_EMPTY` (`:120-121`).

**Deferred (not touched, per reviewer agreement)**: the "strict confidence → all-serial silent footgun" — emitting a distinct signal when the known-domain set was empty (un-migrated composition) — is S3's job, not S1's.

**Verification**: `node --test laplas/test/*.test.mjs` → **44 pass / 0 fail** (was 43; +1 regression test). `loadRoster("./laplas/test/fixtures/module-good.json")` now returns `ok:true` (was exit 6). Schema JSON re-validated; no bare `"EMPTY"` token remains. Scope surgical: `laplas/{lib,schemas,test}` + `sprint.md` AC-S1.6 one-line reconcile.
