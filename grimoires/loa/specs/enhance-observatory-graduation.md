---
hivemind:
  schema_version: "1.0"
  artifact_type: product-spec
  product_area: "Observatory · Agent-Infra design instrument"
  workstream: delivery
  priority: high
  jtbd: {category: personal, description: "make gate design, consumption gradients, and agent moves visible, rehearsable, and decidable — in the game"}
  learning_status: strongly-validated
  source: team-internal
---

# Session — The Observatory Graduation (implementation)

> The Observatory graduates to THIS repo as the operator's design instrument for Agent-Infra
> game design. The planning trilogy is COMPLETE and TRIPLE-FLATLINED (21 blockers integrated).
> This session implements — do NOT re-plan.

## The trilogy (source of truth — read in order)

1. `loa-freeside:grimoires/loa/cycles/observatory-graduation/prd.md` — FLATLINE-REVIEWED (4 blockers in)
2. `loa-freeside:grimoires/loa/cycles/observatory-graduation/sdd.md` — FLATLINE-REVIEWED (7 blockers in; §2 layout, §3 contract rev 2, §5 shell)
3. `loa-freeside:grimoires/loa/cycles/observatory-graduation/sprint.md` — FLATLINE-REVIEWED (10 blockers in; S1–S5 + dispatch gates)
4. The artifacts to graduate: `loa-freeside:grimoires/loa/observatory/{game.html, level-contract.mjs, trace-gen.mjs, sim-gen.mjs, serve.mjs, obs.mjs, veve.json, panel-patch-plan.md, ORIENTATION.md}`
5. Memory: `[[observatory-rpg-observability]]` (the running record)

Copy the trilogy into `grimoires/loa/cycles/observatory-graduation/` HERE at S1 (the cycle's tracker of record is THIS repo's beads + the coord-ledger mirror in loa-freeside).

## The spine (one paragraph)

The game is the instrument: G-1 = ≥3 gate-design decisions made BECAUSE the game made them visible, logged with rendered-beat citations in `decisions.md`. Contract rev 2 brings IMPASSE + the clew thread (retrace/rotate/heal — GECKO summon is the dungeon's first NPC) and gate-hardness honesty (DECLARED data from `hardness-manifest.json`; hook = SOLID, prose/unknown = HOLLOW — fail-honest). Agents are players: registry-only policies, episode JSONL, `obs play`. Redacted-then-public Vercel. Receipts, never rituals.

## Sprint order + the hard gates (from the flatlined plan)

- **S1 GRADUATE**: branch `cycle/observatory-graduation` · move by PR (loa-freeside copy stays canonical until merge) · shell skeleton (`app/observatory/`, same-origin iframe, agentation dev-only, /api/sim with clamps + token bucket) · **1.4 k-hole loiter diagnosis** (structured: symptom/evidence/root_cause/verdict_on_A3) · **1.3 A-2 checkpoint = operator review before S2 may open** (dispatch gate).
- **S2 REV 2 + VOCABULARY**: contract rev 2 (IMPASSE, gate block, clews, **HTML sanitization — `<script>`-in-gateline renders inert, tested**) · hardness-manifest v1 (≥6 real gates) · FR-A beats · re-vector + re-attest veve.
- **S3 THE THREAD**: voluntary + watchdog clews (identical packet, JCS-sha256 digests) · thread polyline + retrace/rotate/heal beats · three prices render · **3.4 blocked-by 1.4**.
- **S4 AGENTS PLAY**: policies.mjs registry (pure/total/cap-bounded; `--policy <path>` exits 2) · episode schema · one construct-agent plays end-to-end · G-1 ledger ≥1 entry.
- **S5 SHARE** (wave 2): salted-HMAC allowlist redaction (salt never persisted) · Vercel (sim-first; /api/level does NOT ship; deployed `?live=`/`?level=` same-origin-only) · gumi link · G-3 attempt.

Cross-cutting: determinism env pinned (Node ≥22, LANG=C TZ=UTC, JCS digests, 1440×900 captures) · coord-ledger rows close sprints · dual-state rollback checkpoint after 2 sprints unmerged.

## Method

Run via `/run sprint-plan` HERE (beads tasks from the sprint plan; implement→review→audit per sprint). The engine work continues the game-feel-loop register (operator spectates increments — kaironic steers welcome mid-sprint). Open design rooms on opus/fable; sonnet only for well-defined parallel work (#40 lives here — its routing fix is on `feat/issue-40-cognitive-load-routing`).

## Provenance

simstim-20260612-3693fe7e (loa-freeside) phases 1–6 complete; Phase 7 = handed off to THIS session by operator choice (2026-06-12). Flatline artifacts beside the trilogy. Prior proof trail: compose run obs-panel-20260611 `valid_run` · sim golden vectors in veve.json · engine v5 commits loa-freeside `f05589b0`→`7e8e714c`+.
