# Agent Working Memory (NOTES.md)

> This file persists agent context across sessions and compaction cycles.
> Updated automatically by agents. Manual edits are preserved.

## Active Sub-Goals
<!-- Current objectives being pursued -->

## Discovered Technical Debt
<!-- Issues found during implementation that need future attention -->

## Blockers & Dependencies
<!-- External factors affecting progress -->

## Session Continuity
<!-- Key context to restore on next session -->
| Timestamp | Agent | Summary |
|-----------|-------|---------|
| 2026-06-12T20:10Z | riding-codebase | First full /ride. 17/17 artifacts persisted. Drift 8.2/10 (0 hallucinated/ghost): README test counts stale (claims 115/8 suites, reality 223/11 + 13 more in tests/composition/state), construct.yaml contributes/tests/requirements lag codebase (missing Form C core, legba, clew; node+bats undeclared), README model-routing section stale vs emitter tier routing (#40 branch). Consistency 9/10. Governance gaps: CHANGELOG/SECURITY/CONTRIBUTING missing; tags lag at v0.3.0. Phase 8 deprecation deliberately skipped (docs are live authority, README.md:228). Reality files at grimoires/loa/reality/ (~2.4K tokens). |

## Ride Results (2026-06-12)
- CLI surface: 14 entry scripts + 5 validators + 7 lib tools + legba CLI (no web routes)
- Entities: 5 typed artifacts (handoff, room packet, pair-relay, manifest v4, clew line)
- Tech debt: 2 TODOs (R-F001 segment-emitter.py:146; clew upstream fix VENDORED.md:49)
- Tests: 236 bats @test + 8 legba node asserts
- Drift score: 8.2/10 · Consistency: 9/10 · Governance gaps: 4

## Decision Log
<!-- Major decisions with rationale -->

### verifiable-compose sprint-2 (2026-06-18) — anchor observed/claimed is shape-derived
| Decision | Choice | Rationale |
|----------|--------|-----------|
| observed-vs-claimed signal for a finding's anchor | Derive from anchor *shape* (cites a file → observed/resolve; no file ref → claimed/skip) | The sprint-1 `bridge-findings` finding schema is `additionalProperties:false` with no `tag` field, so an explicit per-finding tag would fail schema validation upstream. Shape-derivation matches SDD §2.6 ("text-anchor → quoted text in the cited file" / "non-file synthesis tags findings claimed"). `--on-dangling downgrade` exposes the composition-configurable reclassification. Default is fail (SDD §2.6). |

### decompose-bridge cycle (2026-06-13) — SDD architecture (operator-signed)
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Decomposer host | Lean laplas binary `laplas/bin/decompose.mjs` | Sits where party/manifests/dagValidate live; keeps the Python emitter lean (PRD §5 seam). Driver calls it before RFC#35 fan-out. |
| gate_blind source | Derive from the composition's own manifests (gate rooms/seats `covers_domains[]`) | Gate coverage is per-composition, not global; no new registry that drifts. Back-compat: undeclared gate → covers its room domain / `*`. |
| Decomposition LLM tier | sonnet (cheap) | The split is structured; opus stays reserved for gate-blind/central leaves (G-3). confidence_floor catches weak splits → serial fallback. |

PRD hardened against Flatline (9 blockers + 9 high-consensus) before SDD; entered /simstim at `--from architect`. SDD: `grimoires/loa/sdd.md`.

### decompose-bridge Sprint 2 (2026-06-13) — worker prompt boundary
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sanitize score bands (`BLOCK_SCORE=0.7`, `CONTAIN_SCORE=0.4`) placement | Live in `sanitize-goal.mjs` (opts-overridable), NOT `constants.mjs` | They are detector-tuning knobs local to the S2 security boundary, not values shared across the S1↔S3 layers (which is what `constants.mjs` §0.4 is for). Promotion to §0 would be deliberate, not default. |
| S2 refusal carries its own `exit` code | Yes — `{type:'refusal', refusal_reason, exit}` | S2 *is* the security boundary; the exit code (§0.2: 4 vs 7) is part of its contract, making ACs testable without the S3 binary. S3's `decompose.mjs` just propagates `result.exit`. |
| `dungeon.readonly_tools` schema | **[ACCEPTED-DEFERRED]** consumed by `containmentLoadout` but not yet added to `dungeon.schema.json` | New optional field, low-risk; schema addition rides S3 or a follow-up. Containment fails closed (empty floor) when absent, so the missing schema cannot cause unsafe behavior. |

### decompose-bridge Sprint 3 (2026-06-13) — split + binary; live-wiring deferral
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sprint 3 batched | S3.1 + S3.2 first (mocked-provider); then S3.3 + S3.4-config-touch on operator "Continue"; **only S3.4 DEPENDENCY_FAILED stranding DEFERRED** (beads `x7l`) | The real /compose seam: `compose-bridge.mjs` is envelope-chaining, NOT goal→items; the emitter ALREADY has the RFC #35 DAG fan-out — so S3.3 is a driver decision (`resolveComposeItems` + `compose-resolve.mjs` CLI + SKILL.md step 2.5), not an emitter change. S3.4 splits: the gate_batch_max **config touch** (boundedParallel width, backward-compatible, bats 94/94) shipped; the **stranding rewrite** (fail-whole-DAG → strand-dependents, every-composition blast radius, integration-only G-6 AC) deferred to a focused session with a real run. |
| S3.4 gate_batch_max width | `boundedParallel(thunks, width=RATE_BOUND)`; DAG path passes `gateBatchMax = input.gate_batch_max \|\| RATE_BOUND` | Backward-compatible by construction (default = old constant), so non-DAG and existing DAG callers are byte-identical; only the decompose-driven fan-out tightens to competitive's 4. The "one config touch" the sprint header scoped. |
| split-goal failure taxonomy | throw = transport failure (retry → exit 5); successful-but-unusable (empty/non-JSON) → `serial`, never exit 5 | A model that *ran* but declined/fumbled is a safe-degrade case (single-context), not a hard failure. Only a provider/transport throw is exit 5. |
| `claude-provider.mjs` (real sonnet call) | Shipped behind the provider boundary, **runtime-only / not unit-tested** | No real LLM in tests by design (Flatline D8); ~10 lines, isolated, swappable. Does NOT touch the live /compose runtime (it's the standalone binary's default), so it was in-scope for the S3.1/S3.2 batch. |

## laplas-poteau cycle (2026-06-12)
- Hounfour module-format ascension PROPOSAL: `grimoires/loa/proposals/hounfour-module-format-ascension.md` (schemas attached, trinity framing). Return trigger: S6 close or +30 days (2026-07-12). loa-hounfour is local — operator files when ready (the kit proposes; hounfour ratifies).
- S2 close = the PR #43 (observatory) rebase-vs-stack checkpoint (U7).

## [2026-06-13T05:03:27Z] bug-20260612-b2936d triage
- Triaged BLOCKER-class poteau gate forgery (work agent self-mints valid poteau_gate_pass). Sprint: sprint-bug-1. Beads: construct-rooms-substrate-chk.
- WARN: grimoires/loa/ledger.json is empty/invalid JSON — skipped ledger cycle registration per /bug failure-mode protocol. next-bug-sprint-id.sh returned sprint-bug-1 (handled empty ledger gracefully). Ledger entry can be backfilled when ledger is reinitialized.

## 2026-06-13 — compose-speed sprint (SEPARATE concern from laplas-poteau)

New sprint plan written to `grimoires/loa/sprint-compose-speed.md` (NOT clobbering the laplas-poteau prd/sdd/sprint). Goal: make `code-implement-and-review` FAST via parallel cheap-tier fan-out + gate-once.

Key grounding: the SPEED machinery already exists at the runtime level — RFC #35 `args.items` fan-out, wave scheduling, cheap≡sonnet leaf default, and "loop wraps WAVES not items so gate cost does not multiply" — all in `scripts/lib/segment-emitter.py` (verified). The gap is module/composition declaration + executor wiring ONLY; no runtime code changes.

The cost mistake to fix: `modules/code-implement-and-review/party.json` staffs the implementer at `tier: opus`; composition loops the opus FAGAN gate up to 3×. Target: sonnet workers, opus gate fires ONCE on merged output.

No PRD/SDD grounds this work — operator brief treated as the requirements per uncertainty protocol. 3 sprints (S1 manifest · S2 wiring · S3 prove-the-speedup A/B). OUT OF SCOPE: the 3 friction findings (false-positive council arming, no aborted verdict path, flat-vs-run-scoped packet.json refusal message) — separate follow-up.

## compose-speed S1 — fan-out manifest (2026-06-13)
- `laplas-ready` PASS on redesigned `code-implement-and-review`: receipt `sha256:88e57f00dda0bb91159677f6a0cb8346faaae503f520f8bbd81fc918fbddafb7` (binds quest 31dc0f3 / party e50c683 / dungeon 9490075).
- Operator decision: gate seam = single opus FAGAN gate (`review_routing.council:false`); FR-E council stays available for council-mandating compositions.
- Worker archetype → sonnet (fanned at runtime via RFC #35); opus reserved for the gate. Declaration-only; S2 wires the executor.

## compose-speed S2 — executor wiring (2026-06-13)
- `compositions/code-implement-and-review.yaml` declares RFC #35 fan-out (`dag_fanout` block) + executor instruction + fan-out invocation example.
- Emitted workflow verified: DAG machinery present (TIER_MODEL_JS/leafModel/dagWaves/boundedParallel/dagItems); leaves route sonnet, FAGAN gate opus on the merged diff; `items`-less path → single-context (backward-compat). Stage models {1:sonnet, 2:opus}.
- Declaration+proof only; no runtime code. S3 = live A/B speedup proof.

## compose-speed S3 — live A/B (2026-06-13, run s3ab-e033d1)
- Fan-out PROVEN live: iter 1 fanned 2 parallel sonnet leaves (clamp+slugify) in 1 wave; opus FAGAN gate fired once/cycle on the MERGED diff, item-anchored; census 4 sonnet work + 3 opus gate (7 agents, ~8.3min, 285k tok, converged in 3 iters).
- Gate teeth INTACT: caught a fabricated-file diff (clamp not in repo), a BSD-sed `\+` portability regression, scope overreach, a malformed hunk — converged only after real fixes.
- HONEST cost finding: the win is WALL-CLOCK parallelism (scales with item count), NOT tokens — the emitter already role-routes the work stage to sonnet (party tier:opus was dead metadata). Slowness was sequential work + gate looping, not opus workers. Clean cost-delta number needs a 1-pass multi-item task (deferred).
- dag_fanout YAML over-claim softened (review+audit follow-up).
