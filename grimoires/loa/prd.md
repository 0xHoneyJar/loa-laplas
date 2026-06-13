# Product Requirements Document — The Decomposition Bridge

> **Cycle**: decompose-bridge · **Repo**: loa-laplas (construct-rooms-substrate) · **Date**: 2026-06-13
> **Predecessor (archived)**: `grimoires/loa/cycles/laplas-poteau/` — enforcement + compose-speed, on main.
> **Runtime scope**: the CURRENT compose runtime (the compose-speed fan-out substrate, landed on main). `finn` is parked — named as a future executor target, explicitly OUT of scope for this cycle.

> **Sources**: `grimoires/loa/context/arch-brief-loa-scaffolds-compose.md` (the candidate brief); construct consultation 2026-06-13 (GYGAX — game-systems/party-comp; OSTROM/THE ARCADE — commons-governance/economy); operator decisions in this discovery session; the compose-speed S3 finding (`grimoires/loa/a2a/compose-speed-s3/reviewer.md`); verified facts (REL present in manifests; GECKO installed; `scripts/lib/segment-emitter.py:949`).

---

## 1. Problem & Vision

**Problem.** The compose runtime can fan work out in parallel (compose-speed S1–S3, on main), but **nothing auto-decomposes a goal into `args.items[]`** — the driver hand-writes them. So "fast by default" is not real: fan-out is opt-in, and a normal `/compose` runs the single-context path at the old speed.
> Source: compose-speed S3 reviewer.md ("the win is wall-clock parallelism … but fan-out is opt-in; nothing auto-decomposes"); bead `xbk`; brief §"the one concrete piece".

**Vision.** A goal → an **automatic, construct-routed, REL-weighted task DAG** → fanned across cheap spirits in parallel waves → gated once at the craft-gate → with a **governed in-session summon** for the residual unknown ("loitering"). Loa's *decomposition* layer meets compose's *execution* layer; the interchange is a **task graph (data), not a coupled skill**.
> Source: brief §isomorphism + §clean-seam; operator framing (party-comp + in-session summoning).

**Why now.** The compose-speed substrate landed on main; the decomposition bridge is the keystone that makes it fast *by default*, and it is the cleanest seam between the Loa scaffolding and the laplas/construct runtime.

---

## 2. Goals & Success Metrics

**The objective function (corrected — GYGAX).** *Not* "ensure victory" — unknowns + finite budget *prove* P(success)<1, and pursuing a guarantee *is* the over-provisioning that kills the cheap economy. The honest objective:

> **Maximize `P(complete) × P(true-clear)` under BOTH budget AND latency, with the weights set by REL** — while bounding the silent-catastrophic tail (the gate that *false-clears* bad work) far harder than the cheap tails (stall→summon, false-fail→retry).
> Source: GYGAX consultation (objective reframe); operator (speed/latency as a co-objective, REL-weighted).

**Metrics (named, testable):**
| ID | Goal | Metric |
|----|------|--------|
| **G-1** | Fan-out is automatic | A bare goal (no hand-written items[]) auto-decomposes into ≥2 construct-routed parallel items in ≥1 wave — visible in the emitted workflow + `orchestrator.jsonl`. |
| **G-2** | Speed, REL-weighted | Wall-clock + token cost vs the serial baseline on the same multi-item goal, at `casual` REL; the speedup scales with item count. |
| **G-3** | Opus is surgical | Tier audit: opus appears only at `gate_blind(domain) OR high_centrality(node)` and the one gate — 0 opus on a gate-covered leaf. |
| **G-4** | No quality loss | A planted defect in one item is caught at the single gate, anchored to its `[item-id]` (defect-parity vs per-item review). |
| **G-5** | REL changes rigor without changing the party | The SAME decomposition runs fast (`casual`: cheap tier, sparse gate, generous summon) or careful (`competitive`: opus+council, dense gate, tight summon) by changing the dungeon's `rel`, not the roster. |

---

## 3. Users & Stakeholders

- **Primary**: whoever drives `/compose` with a decomposable goal (operator or orchestrating agent). Pain today: must hand-author `items[]` to get any parallelism.
- **The compositions** — the work shapes (`code-implement-and-review` is the reference; the bridge generalizes).
- **The constructs (spirits)** — first-class workers filling party roles (laplas already names them).
- **GECKO** — the standing **sensor/doctor/guide** seat (operator decision: "this is GECKO's job — the tutorial/guide/doctor").

---

## 4. Functional Requirements

**FR-1 — The decomposer (lean, runtime-aligned).** A small step the `/compose` driver calls to turn a goal into a task DAG: `args.items[] = [{ id, task, depends_on, role, tier_hint }]`. It is **sprint-plan-SHAPED, not the sprint-plan skill** — no beads/AC-gate/retrospective weight imported. It MUST aim for **one room → one domain**: the cleanest summon-reducer is a DAG where each item is single-domain (a multi-domain room *manufactures* loitering).
> Source: operator (lean decompose-only step); brief §pushback (data-handoff, not skill-coupling); GYGAX (one-room-one-domain is the cheapest loitering reducer).

**FR-2 — Construct routing via the party (first-class).** The decomposer assigns a **role + tier_hint** per item; the **laplas party resolves role → construct** (the operator's framing — not a per-item construct field, not a separate table). Tier placement follows the **opus predicate**: `opus IFF gate_blind(item.domain) OR high_centrality(item.node)`; otherwise the cheap tier. (The value of a worker's tier is *coupled to gate coverage* — if the gate can re-check it, produce it cheap.)
> Source: operator (route through the party); GYGAX (role-coverage > stat-stacking; the opus-placement predicate).

**FR-3 — GECKO as the standing sensor seat.** Every party carries GECKO (cheap, broad). Its load-bearing job is **sense → diagnose → guide**: sense the loiter (its instrument is the `stall_s` watchdog), *diagnose the missing competence* (GECKO's `diagnose` skill — this produces the **named gap** a summon requires), and guide the stuck/new construct. GECKO turns "send help" into "summon `noether` — this room hit a contracts wall." Never cut to save mana — it is the smoke detector.
> Source: operator (GECKO = tutorial/guide/doctor); GYGAX (the sensing seat); OSTROM (congruence needs a named gap); verified: gecko pack installed.

**FR-4 — REL as the master speed/rigor dial.** REL (`casual`/`competitive`, already in the manifests + gated by P605) weights, in one declaration: party tiers (casual→cheap, competitive→opus+council), gate density (casual→sparse, competitive→dense), AND **summon generosity** (casual→generous+cheap+near-instant, competitive→tight+operator-gated). Speed-vs-rigor becomes a *declaration*, not a discipline.
> Source: operator (speed is a co-objective, REL-weighted; creative=fast, code-with-plan=parallel); verified: `rel: casual|competitive` present in manifests, P605 enforces compatibility.

**FR-5 — The metered summon (TELEMETRY-GATED; Phase 2).** For the residual unknown, a **metered commons-draw**, not an open one. Three dials added to the existing `dungeon.budgets` (`additionalProperties:true` — additive): `summons` (reserve depth), `summon_tier_ceiling` (so opus can't be pulled into the cheap fan-out), `summon_cooldown_s` (anti-thrash). **The budget IS the gate** — O(1) mechanical, *no reviewer* (a reviewer-gated summon is economically inverted — spending opus to ration sonnet — and gates the recovery path). Graduated sanctions in the P-code teaching voice: granted-silent → cooldown-deferred → budget-exhausted-refusal → opus-draw needs `break_glass`/operator. One `summon_drawn` incident per draw; the summon budget bound into the laplas-ready receipt.
> Source: OSTROM (meter-the-withdrawal-not-the-membership; the 8 Ostrom principles mapped to dungeon.budgets + incident.schema; budget-is-the-gate); GYGAX (summon as self-limiting self-insurance; per-use price > staffing).
> **Gate**: ship ONLY if loitering telemetry shows a *few recurring classes*. If it's a long tail of bespoke needs, the meter fails and **re-quest is the honest (expensive) door** — summon would be premature optimization (the GYGAX+OSTROM convergent pushback).

**FR-6 — The retune loop.** Every summon is attributed (who raised it, which competence, room). Repeated same-role draws in the incident log = a **P601 staffing miss** → promote that domain into a *staffed* seat next quest. The log is the feedback that retunes the static comp; the abuse (deliberately under-staff to summon later) is self-defeating because it's self-reporting.
> Source: GYGAX (the log retunes the comp); OSTROM (telemetry → v2 named bench only when justified).

---

## 5. Technical & Non-Functional

- **Builds on the landed compose-speed substrate** (RFC #35 fan-out, on main). The emitter ALREADY accepts `args.items[]` and bakes the DAG machinery (`segment-emitter.py:949` — "the executor resolves topology to items[]; the emitter never shells out").
- **Seam = task-graph as DATA, not skill-coupling.** Do NOT run `/implement` per leaf (it's a session-weight workflow; a leaf is a cheap worker). Take the *pattern* (work→gate), not the orchestrator.
> Source: brief §clean-seam; GYGAX (leaf does work, gate reviews).
- **Verify-the-record posture.** The bridge's gates are **nouns** (a receipt exists), never verbs (the agent did the work). The decomposition's *record* — `items[]`, the party, the receipts/incidents — is what is verified; the agents' *process* is not. The deterministic half (tool calls) is re-executable; the nondeterministic half (verdicts) is attested-not-verified.
> Source: operator's don't-trust-verify thread (attested); the existing poteau noun-gate doctrine.
- **Summon governance is laplas-side + runtime-agnostic** — the dials live in `dungeon.budgets`; the event in `incident.schema.json`. *Enforcement* (does the budget actually meter, does the WAL chain the receipt) is the runtime's job.
- **Trust boundaries**: item `task` literals flow into worker prompts (same injection surface as quest objectives — schema-bounded, `JSON.stringify`'d); the runtime `dagValidate` (dup/unknown id, cycle → fail-loud) guards the DAG.
- **finn: PARKED.** A real sibling (`../loa-finn`) but unwired to laplas (0 refs). Named as the eventual *executor* target; the laplas→finn integration is a **separate, future cycle** — out of scope here.

---

## 6. Scope & Prioritization

**Phase 1 (MVP — the keystone):** FR-1 (lean decomposer, one-room-one-domain) + FR-2 (role→party routing, opus predicate) + FR-3 (GECKO sensor seat) + FR-4 (REL wiring). This makes fan-out *automatic* and reduces loitering *by construction*.

**Phase 1.5 (cheap, enabling):** instrument loitering — `stall_s` sensor + a `loiter`/`summon_drawn` incident (the bones exist). Gathers the distribution that gates Phase 2.

**Phase 2 (telemetry-gated):** FR-5 (the metered summon) — ONLY if Phase-1.5 telemetry shows a few recurring loiter classes. FR-6 (retune loop) rides along.

**Out of scope (explicit):**
- The **named bench** (v2 — `seat: bench` + a P607 cross-check) — defer until telemetry proves repeated same-role draws (OSTROM).
- **finn integration** (the executor target) — future cycle.
- **Coupling the heavy Loa skills** into the runtime (the brief's standing pushback).

---

## 7. Risks & Dependencies

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Loiter is a long tail, not a few classes** (the GYGAX+OSTROM convergent pushback) | High to the summon design | Phase-1.5 instrument FIRST; ship the summon only if the data earns it; re-quest is the door otherwise. |
| Over/under-decomposition (coordination overhead vs no speedup) | Med | Tune DAG granularity; one-room-one-domain discipline; the retune log corrects over time. |
| Decomposer quality (bad split → manufactured loitering + bad fan-out) | Med-High | One-room-one-domain is FR-1's first-class requirement, not an afterthought. |
| **Silent false-clear** (the gate passes bad work) — the worst tail | High | The opus-at-gate-blind predicate (FR-2) buys down exactly this; the single gate keeps teeth. |
| The 4-gate convergence muddling | Med | Keep `laplas-ready` (dispatch) / `craft-gate` (runtime LLM verdict) / `poteau-attest` (cryptographic) at distinct altitudes — do not merge. |
| "Ensure victory" framing leaking into requirements | Med | The objective is explicitly P(complete)×P(true-clear) under budget+latency — *not* a guarantee (§2). |

**Dependencies:** the landed compose-speed substrate (on main); the laplas manifests + schemas (`dungeon.budgets` additive, `rel` present); GECKO installed; the emitter's RFC #35 path.

---

## Appendix — Provenance of the consultation

The construct-routing decision was settled by summoning two constructs to advise on the summon mechanism (self-referential by design): **GYGAX** (game-systems / party-comp / resource-to-victory) and **OSTROM / THE ARCADE** (commons-governance / economy / the loop). They converged independently on: meter the summon (don't gate it with a reviewer), the log retunes the comp, and the same open question — does loitering decompose into a few classes? Full verdicts in this session's trajectory; both flagged the telemetry-gate that Phase 1.5 answers.
