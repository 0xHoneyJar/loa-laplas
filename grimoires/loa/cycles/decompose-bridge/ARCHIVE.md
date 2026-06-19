# Archived Cycle — The Decomposition Bridge

**Archived**: 2026-06-18 · **Status at archive**: sprint-4 COMPLETED (Phase 1)
**Successor cycle**: verifiable-compose (canonical `grimoires/loa/prd.md` from 2026-06-18)
**Predecessor**: `grimoires/loa/cycles/laplas-poteau/`

## What this cycle delivered
Automatic goal → construct-routed, REL-weighted task DAG → parallel-wave fan-out → single
craft-gate, with governed in-session summon for the residual unknown. Made compose "fast by
default" (fan-out no longer opt-in / hand-authored `args.items[]`). Phase-1 keystone + the
stall path landed in sprint-4 (`5c386d7`, `feat(sprint-4): Phase-1 stall path keystone …`).

## Artifacts here
- `prd.md` / `sdd.md` / `sprint.md` — the cycle's planning docs (Flatline-hardened 2026-06-13).
- `flatline-{prd,sdd,sprint}-review.json` — the 3-model review records.
- `a2a/sprint-{1..4}/` — per-sprint implementation/review/audit artifacts (sprint-4 has COMPLETED).

## Why archived now
Moved out of the canonical `grimoires/loa/` slots so the **verifiable-compose** cycle (PRD for
GitHub RFCs #56 output-contract + #57 proof-of-operation) can occupy the golden-path workflow
slots. Phase 1 was the stated stopping point; no Phase 2 was active. Manual archive (mirrors
the `cycles/<name>/` pattern of `laplas-poteau` + `observatory-graduation`; the `/archive-cycle`
skill was N/A — it requires a `grimoires/loa/ledger.json` that this repo does not maintain).

## Left in canonical (cross-cycle, intentionally not archived)
`NOTES.md`, `/ride` reports (`consistency-report.md`, `drift-report.md`, `governance-report.md`,
`trajectory-audit.md`), `reality/`, and predecessor `a2a/compose-speed-s{1,2,3}/`.
