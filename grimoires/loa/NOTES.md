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
