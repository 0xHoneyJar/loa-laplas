# Software Design Document — The Decomposition Bridge

> **Cycle**: decompose-bridge · **Repo**: loa-laplas · **Date**: 2026-06-13 · **Branch**: cycle/decompose-bridge
> **Traces**: `grimoires/loa/prd.md` (hardened, Flatline-integrated). Every component maps to a PRD FR (§10).
> **Architecture decisions (operator-signed, 2026-06-13)**: decomposer = **lean laplas binary** (`laplas/bin/decompose.mjs`); gate-blind = **derived from the composition's own manifests**; decomposition LLM call = **sonnet**. (NOTES.md Decision Log.)
> **Hardened by Flatline** (3-model, 2026-06-13, 85% agreement): 12 blockers + 8 high-consensus integrated — see §11 (flatline log). Result: `grimoires/loa/a2a/flatline/sdd-review.json`.
> **Runtime scope**: the landed compose-speed fan-out substrate (RFC #35, on main). `finn` parked.

---

## 1. Architecture Overview

The bridge is a **pre-pass** in front of the existing RFC #35 fan-out. The `/compose` driver calls one new lean binary; everything downstream is unchanged.

```
/compose <goal> [--module M.json] [--run-mode interactive|automated]
  │
  ├─ laplas/bin/decompose.mjs ─────────────────────── THE BRIDGE (new, Phase 1)
  │     0. loadRoster(module)        ── §4 roster contract (validate or exit 6)
  │     1. sanitizeGoal(goal)        ── §5 advisory pre-flight (stdin to detector)
  │     2. splitGoal(goal, roster)   ── ONE sonnet call, hardened (retry/schema/fences)
  │     3. deriveRouting(raw, M)     ── domain · centrality · gate_coverage ·
  │                                      opus_predicate→tier · rel_policy · confidence
  │     4. dagValidate(items, roster)── cycle/dangling/dup · role↔roster (retry-w-feedback) ·
  │                                      one-room-one-domain · confidence floor
  │     5. emit                      ── DAG  |  serial-fallback{reason}  |  refusal{reason}
  │
  └─ scripts/lib/segment-emitter.py (RFC #35) ──────── UNCHANGED
        resolves topology → waves → fan-out workers → single craft-gate (batch-capped)
        stall path: stall_s watchdog → GECKO diagnose → named_gap → stallExit(run_mode)
```

**Design invariant**: the interchange is **`args.items[]` (data)** — the emitter never imports the decomposer, and vice-versa (PRD §5 seam).

**Two halves, by determinism**: `splitGoal` is the *only* nondeterministic step (one LLM call). Everything after — routing derivation, validation, tier placement — is **deterministic code** over the raw split + the composition manifests. This is what makes the opus_predicate and rel_policy *computable* (Flatline-PRD B2/B9), not LLM-judged. **Corollary (Flatline-SDD)**: because the one nondeterministic step can fail or hallucinate, C2 and C8 carry explicit failure-handling (retry-with-feedback, schema validation, fence-stripping, typed exit codes) — see C2/C8.

---

## 2. Components

| # | Component | File | PRD FR |
|---|-----------|------|--------|
| C1 | Decomposer binary (entry) | `laplas/bin/decompose.mjs` | FR-1 |
| C2 | Goal splitter (the hardened LLM call) | `laplas/lib/split-goal.mjs` | FR-1 |
| C3 | Routing derivation | `laplas/lib/derive-routing.mjs` | FR-2, §9 |
| C4 | rel_policy compiler | `laplas/lib/rel-policy.mjs` | FR-4, §9 |
| C5 | gate-coverage / gate_blind | `laplas/lib/gate-coverage.mjs` | FR-2, §9 |
| C6 | centrality / high_centrality | `laplas/lib/centrality.mjs` | FR-2, §9 |
| C7 | opus_predicate | `laplas/lib/opus-predicate.mjs` | FR-2, G-3 |
| C8 | dagValidate (extended, retry-aware) | `laplas/lib/dag-validate.mjs` | FR-1, FR-2 |
| C9 | named_gap schema + GECKO sense | `laplas/schema/named-gap.json` | FR-3 |
| C10 | Phase-1 stall: **minimal watchdog + exit** | `laplas/lib/stall-watch.mjs` + `stall-exit.mjs` | FR-4.5 |
| C11 | prompt boundary (sentinel + sanitizer) | `laplas/lib/prompt-boundary.mjs` | §5.1 |
| C12 | gate batch cap | emitter config via rel_policy | §5, G-6 |
| C13 | summon dials (Phase 2, deferred) | `dungeon.budgets` additive | FR-5 |

### C1 — `decompose.mjs` (the binary)
CLI: `decompose.mjs --goal <str> --module <module.json> --run-mode <interactive|automated> [--rel casual|competitive]`.
Stdout is exactly one of three typed results (**Flatline-SDD B5** — degradation ≠ refusal):
- **DAG**: `{ kind: "dag", items: [<item>…], rel_policy, decomposition_confidence }`
- **Serial fallback** (safe, runnable): `{ kind: "serial", items: [<single spanning item>], fallback_reason: "LOW_CONFIDENCE|INDIVISIBLE|LLM_EMPTY" }` — the goal still runs, single-context.
- **Refusal** (no runnable item; driver MUST handle): `{ kind: "refusal", refusal_reason: "SANITIZE_REJECT|DOMAIN_AMBIGUOUS|ROSTER_INVALID|LLM_FAILURE" }` — emits NO item; the driver decides (abort / re-goal).

Exit codes (typed, never silent): `0` dag|serial · `3` dagValidate fail after retry (role↔roster/cycle, P601 voice on stderr) · `4` sanitize hard-block · `5` LLM_CALL_FAILURE · `6` ROSTER_INVALID.

### C2 — `split-goal.mjs` (the hardened LLM call) — Flatline-SDD B4/B7/B8/B12
- Model: **sonnet** (operator-signed). One logical call, with a bounded retry budget.
- **Failure modes (B8)**: network error / rate-limit / empty / non-JSON each handled. Retry budget: **1 retry, 2s backoff, then fast-fail** → exit 5 with structured stderr. An empty or non-JSON response after retry is treated as `INDIVISIBLE` → serial fallback (not an unhandled throw).
- **Output parsing (B4)**: strip markdown fences, then **schema-validate** the raw output (Zod, or a hand-rolled validator if we avoid the dep) against the raw-item schema `[{ id, task, depends_on[], role, domain_hint, confidence }]`. Unparseable → serial fallback.
- **Confidence is telemetry, not the gate (B7)**: the LLM's self-reported `confidence` is recorded for the Phase-1.5 calibration set but does NOT by itself gate fan-out. The *gating* confidence is computed by deterministic checks in C3/C8 (domain resolved? role in roster? dag acyclic? single-domain?). Model self-confidence and validator confidence are separate fields.
- The goal + emitted tasks are wrapped by C11's sentinel; the model is instructed the goal is untrusted data (§5).

### C3 — `derive-routing.mjs` (deterministic)
Per raw item, compute (§9): `domain` (resolve `domain_hint` to exactly one registry entry or flag DOMAIN_AMBIGUOUS) · `centrality` (C6) · `gate_coverage`/`gate_blind` (C5) · `tier` via `opus_predicate` (C7) · `rel_policy` ref · `decomposition_confidence` = the *validator* confidence (deterministic), with model self-confidence carried separately as telemetry. Pure, testable.

### C4 — `rel-policy.mjs`
`relPolicy(rel, run_mode)` → `{ tier_default, gate_density, gate_batch_max, confidence_floor, stall_s, summon_generosity, summon_approval }`.
- `casual` → `{ sonnet, sparse, 8, 0.5, 90, generous, auto }`
- `competitive` → `{ sonnet, dense, 4, 0.7, 45, tight, break_glass }`
- **run_mode override (Flatline-PRD DISPUTED-1)**: `automated` resolves `summon_approval` non-interactively — `casual`→`auto` (within budget); `competitive`→`fail` (never operator-wait). REL never compiles to a headless deadlock.

### C5 — `gate-coverage.mjs` (derive-from-composition — operator-signed)
`gateCoverage(dungeon, party)` → the SET of domains a *declared* gate in THIS composition can re-check, from gate rooms + council/reviewer seats. Additive manifest field: a gate room/seat declares `covers_domains: [..]`. `gateBlind(domain) = domain ∉ gateCoverage`.
- **Back-compat default (Flatline-SDD B2 — corrected)**: an undeclared gate covers its **room's declared domain ONLY — never `["*"]`**. A generic craft-gate with no domain declaration covers the **empty set**, so undeclared-domain leaves are gate-blind → opus-tiered. Conservative: the failure mode is over-provision (opus where maybe unneeded), never under-gate (cheap where unverifiable). A migration test asserts `code-implement-and-review` declares its gate's `covers_domains` so it stays cheap.

### C6 — `centrality.mjs`
`centrality(item, dag)` = out-degree + transitive-downstream-dependent count. `highCentrality(node) = centrality ≥ centrality_threshold` (default 2). Pure graph metric (Flatline-PRD B2).

### C7 — `opus-predicate.mjs`
`opusPredicate(item) = gateBlind(item.domain) || highCentrality(item.node)` → `tier = opus` else `rel_policy.tier_default`. Drives G-3. The gate's own tier is separate from leaf tiers.

### C8 — `dag-validate.mjs` (extended, retry-aware) — Flatline-SDD B12
Existing: dup id, unknown `depends_on`, cycle → fail-loud. **Added**:
- **role↔roster with bounded retry (B1-PRD + B12-SDD)**: every `item.role` ∈ roster. A miss is likely an LLM hallucination, so instead of an immediate exit 3: feed the specific failure (`role 'X' not in roster {…}`) back to C2 for a **bounded correction retry (max 2)**; only after the budget is spent → exit 3 with the P601 refusal (recruit-or-re-quest). Never dispatch a leaf to nobody.
- **one-room-one-domain (HC2-PRD)**: `item.domain` resolves to exactly one entry, else DOMAIN_AMBIGUOUS → refusal (not serial — ambiguous routing is unsafe to run).
- **confidence floor**: validator confidence below `rel_policy.confidence_floor` → serial fallback.
- **bounds**: `1 ≤ items ≤ N_max` (16); 0 items → refusal (LLM_EMPTY handled in C2).

### C9 — `named-gap.json` + GECKO sense
Schema: `{ item_id, missing_role, evidence, recommendation: "re-quest"|"summon:<role>"|"escalate", confidence }`. The stable **FR-3↔FR-4.5↔FR-5 interface** (Flatline-PRD HC6). Phase 1 ships the schema + GECKO `diagnose` emitting it.

### C10 — Phase-1 stall: minimal watchdog + exit (the keystone) — Flatline-SDD B1
**Ships as one atomic unit in Phase 1** so the exit is not dead code:
- `stall-watch.mjs` — a *minimal* `stall_s` watchdog: a leaf producing no progress-bearing event for `rel_policy.stall_s` wall-seconds fires the stall. (Phase 1.5 enriches this into full loiter telemetry; Phase 1 needs only the trigger.)
- `stall-exit.mjs` — `stallExit(named_gap, run_mode)`: `interactive` → surface `named_gap`, **escalate to operator** (kaironic boundary); `automated` → **fail the item loud** (`STALLED_NO_SUMMON` incident + named_gap + re-quest rec; nonzero). Never silent retry/re-queue/block.
- **Wave cancellation (Flatline-SDD B11)**: a stall exit issues a **cooperative cancel to in-flight siblings in the same wave**, then drains and emits the wave result with the stall recorded — bounded, no zombie workers, no partial-wave ambiguity. Already-completed siblings' receipts are preserved.

### C11 — `prompt-boundary.mjs` (§5.1) — Flatline-SDD B3/B9/B10
- **Sentinel (B10 — specified)**: `sentinelWrap(literal)` interpolates the goal/task only inside a **per-invocation random UUID tag** — `<goal id="{uuid}">…</goal>` — generated fresh each call (UUID passed in via `args`/env since the runtime forbids `Math.random()` in some paths; the binary uses `crypto.randomUUID()`). The prompt template checks the input for a sentinel collision (the literal already containing the tag/uuid) and exits 4 if found.
- **Sanitizer (B9 — advisory, not the primary control)**: `sanitizeGoal(goal)` is **advisory + logged**, with structural containment (the sentinel + schema-validated, constrained LLM output) as the *primary* control. Reuses `.claude/scripts/injection-detect.sh`. A high-confidence match is a hard block (exit 4) with a reviewable reason; lower matches log + proceed under containment. Adversarial test corpus required.
- **Detector invocation (B3 — CRITICAL)**: the untrusted goal is passed to `injection-detect.sh` strictly via **stdin** (never argv / shell interpolation) to avoid command injection at the detector boundary.
- **Worker invariant + privilege floor**: workers receive fixed system instructions the task literal cannot override; tools derive from role+loadout, never the literal.
- **Gate-verifies-goal**: the craft-gate checks worker output against `item.task` + the original goal, NOT the worker's self-report.

### C13 — summon dials (Phase 2, deferred, telemetry-gated)
Additive to `dungeon.budgets`: `summons`, `summon_tier_ceiling`, `summon_cooldown_s`. Budget-exhaustion → `STALLED_NO_SUMMON` → C10. NOT built until Phase-1.5 telemetry clears `P%/K` (FR-5). Forward-compat only.

---

## 3. Data Flow

`/compose <goal>` → `decompose.mjs`: loadRoster → sanitizeGoal (advisory; stdin) → splitGoal (sonnet, retry/schema/fences) → deriveRouting → dagValidate (role retry-w-feedback; floor) → **{dag | serial | refusal}** → (if runnable) segment-emitter RFC #35 → waves → fan-out → single craft-gate (batched `gate_batch_max`; overflow sequential). **Stall path**: leaf stalls (`stall_s`) → GECKO diagnose → named_gap → stallExit(run_mode) → cooperative sibling cancel + drain.

---

## 4. Contracts

### 4.1 Party roster (Flatline-SDD B6 — was undefined)
Schema: `roster = { roles: [ { id, domain, tier_ceiling } ] }`. Source: the `party` field of `module.json` (the laplas party manifest). C1 calls `loadRoster(module)` first and validates: non-empty, each role unique, each `tier_ceiling` a known tier. Empty/malformed → exit 6 (ROSTER_INVALID), refusal — no LLM call wasted on an un-routable party.

### 4.2 Other contracts
- **Driver → decomposer**: CLI (C1); typed stdout (dag|serial|refusal); exit codes 0/3/4/5/6.
- **Decomposer → emitter**: `args.items[]` element schema (C8 fields). Emitter reads `id, task, depends_on, role, tier`; routing fields carried for audit + the gate.
- **Manifest additive**: gate room/seat `covers_domains: [..]` (C5); undeclared → room domain only.
- **named_gap** (C9); **rel_policy** (C4).

---

## 5. Security Architecture (PRD §5.1 + Flatline-SDD)

| Threat | Control | Component |
|--------|---------|-----------|
| Command injection at the detector boundary (CRITICAL B3) | goal to injection-detect.sh via **stdin only**, never argv | C11 |
| Sentinel boundary failure / collision (CRITICAL B10) | per-call UUID tag `<goal id=uuid>`; collision check → exit 4 | C11 |
| Sanitizer over-trusted as hard gate (CRITICAL B9) | sanitizer **advisory + logged**; structural containment (sentinel + schema-constrained output) is primary; adversarial corpus | C11 |
| Semantic prompt injection (CRITICAL B6-PRD) | sentinel + sanitizer + gate-verifies-goal + privilege floor (defense-in-depth) | C11 |
| Tainted decomposition / priv-esc (CRITICAL B4-PRD) | goal untrusted-by-default; worker tools from role+loadout | C11, C2 |
| Worker self-report trusted (B5-PRD) | gate verifies vs item.task+goal | emitter gate |
| Role spoof / dispatch-to-nobody (B1-PRD) | role↔roster validate (retry then fail-loud) | C8 |

No single point of trust: sanitizer + sentinel + schema-validated constrained output + gate-verifies-goal each hold independently.

---

## 6. Scalability & Performance

- Decomposer cost: **one sonnet call** (+ ≤1 retry) + O(V+E) deterministic derivation. Not an opus cost center (G-3).
- Gate is **bounded**: `gate_batch_max` (8 casual / 4 competitive); overflow → sequential passes. **G-6**: gate wall-clock ≤ a stated fraction of wave time, measured on a *large* DAG (Flatline-PRD B8).
- centrality O(V+E); gate-coverage O(rooms); cheap.

---

## 7. Phasing (maps PRD §6, adjusted for Flatline-SDD B1)

- **Phase 1 (this cycle)**: C1–C11 — decomposer + routing + GECKO schema + **stall watchdog + exit (atomic, C10)** + security. The stall exit fires day one (not dead code). Fan-out automatic, loiter-reduced by construction, fails safe.
- **Phase 1.5**: enrich the watchdog into full loiter telemetry (`loiter`/`summon_drawn` incidents bucketed by `missing_role`). Gathers the `P%/K` distribution.
- **Phase 2 (telemetry-gated)**: C13 summon dials — only if the bar clears. FR-6 retune loop.
- **Out of scope**: named bench (v2), finn integration, heavy-Loa-skill coupling.

---

## 8. Testing Strategy

- **Deterministic core** (C3–C8): unit tests over fixed raw-item fixtures — domain resolution, centrality, gate_blind (incl. the back-compat default), opus_predicate, dagValidate (cycle/dangling/dup/role-miss/one-domain/floor/bounds). No LLM in the loop.
- **C2 robustness**: mock the sonnet call to return: valid JSON, fenced JSON, malformed JSON, empty, network-error, hallucinated-role-then-corrected — assert the typed outcome + exit code for each.
- **Security**: adversarial goal corpus (instruction-override, role-confusion, exfiltration, encoding-evasion, sentinel-collision) → assert sanitize block / containment; assert detector receives input via stdin (no argv leak).
- **Migration**: `code-implement-and-review` declares gate `covers_domains` and stays cheap (no opus regression).
- **G-6**: a large-DAG benchmark asserts gate wall-clock stays within the bound.

---

## 9. Operational Definitions → Code (PRD §8 made concrete)

| Term | Function | File |
|------|----------|------|
| `run_mode` | CLI flag, threaded | C1 |
| `stall` | `stall_s` watchdog (minimal in P1) | C10 |
| `loitering` | `named_gap` events by `missing_role` | C9 |
| `one-room-one-domain` | dagValidate domain-resolves-to-one | C8 |
| `gate_blind` | `gateBlind(domain)` | C5 |
| `high_centrality` | `highCentrality(node)` | C6 |
| `opus_predicate` | `opusPredicate(item)` | C7 |
| `decomposition_confidence` | validator (deterministic); model self = telemetry | C3/C2 |
| `rel_policy` | `relPolicy(rel, run_mode)` | C4 |

---

## 10. PRD Traceability

| PRD FR | SDD components |
|--------|----------------|
| FR-1 decomposer + contract | C1, C2, C3, C8, §4.1 |
| FR-2 routing + opus predicate | C3, C5, C6, C7, C8 |
| FR-3 GECKO sensor + named_gap | C9 |
| FR-4 REL → rel_policy | C4 |
| FR-4.5 Phase-1 stall exit | C10 |
| FR-5 metered summon (Phase 2) | C13 (deferred) |
| FR-6 retune loop (Phase 2) | C9 attribution |
| §5.1 worker prompt boundary | C11 |
| G-3 opus surgical | C7 |
| G-6 gate doesn't re-serialize | C12, §6 |

---

## 11. Flatline integration log (SDD, 2026-06-13)

3-model pass (85% agreement, 12 blockers / 8 high-consensus). All 12 integrated:

| # | Blocker | Where |
|---|---------|-------|
| B1 | C10 dead code (exit w/o trigger) | C10 ships minimal watchdog atomic with exit (Phase 1) |
| B2 | gate back-compat `["*"]` suppresses opus | C5 default = room domain only, never `*` |
| B3 | command injection via detector argv (CRIT) | C11 detector via stdin |
| B4 | LLM JSON parse failure unhandled | C2 fence-strip + schema-validate → serial fallback |
| B5 | fallback conflates degrade vs refuse | C1 typed {dag\|serial\|refusal} |
| B6 | roster never defined | §4.1 roster contract + exit 6 |
| B7 | LLM self-confidence trusted as gate | C2/C3 validator-confidence gates; model-confidence = telemetry |
| B8 | C2 no failure modes/exit/retry | C2 exit 5 + 1-retry-2s-backoff + empty→serial |
| B9 | sanitizer over-trusted (CRIT) | C11 advisory + structural containment primary |
| B10 | sentinel delimiter unspecified (CRIT) | C11 per-call UUID `<goal id=uuid>` + collision check |
| B11 | wave cancellation on stall unstated | C10 cooperative sibling cancel + drain |
| B12 | hard exit-3 on hallucinated role brittle | C8 bounded retry-with-feedback (max 2) then fail |

Disputed: D1 (zero-item path explicitness) → C8 0-items→refusal; D2 (define "finn" shorthand) → noted as parked sibling in header.
