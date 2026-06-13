# Implementation Report — compose-speed S1: THE FAN-OUT MANIFEST

**Sprint plan:** `grimoires/loa/sprint-compose-speed.md` (S1) · **Concern:** make `code-implement-and-review` fast (separate from the laplas-poteau cycle).

## Executive Summary

Re-authored the `code-implement-and-review` tri-manifest so the WHO/WHAT/WHERE express *parallel cheap workers + one opus seam* — a declaration-only change (no runtime code; the RFC #35 fan-out machinery already ships). Operator decision (2026-06-13): the gate seam is a **single opus FAGAN gate** (`review_routing.council: false`), not a 2-voice council — the FR-E cryptographic council stays available for compositions that mandate it. `laplas-ready` PASSES; all three manifests are schema-valid.

## AC Verification

1. **"`laplas-ready` returns a PASS + mints a ready receipt binding quest/party/dungeon hashes (P601–P606 all green)"**
   - ✓ Met — `node laplas/bin/laplas-ready.mjs modules/code-implement-and-review/module.json` → `{"ready":true,"receipt_hash":"sha256:88e57f00…"}`; receipt at `.run/poteau/ready.json` binds quest `31dc0f3…` / party `e50c683…` / dungeon `9490075…`. P601 (roles implementer+reviewer staffed), P604 (gate room `review` ∈ dungeon rooms `[fan-out, review]`), P605 (both competitive), P606 (operator-approval HITL seat present) all pass; P603 vacuous (`council:false`).

2. **"No `seat: work` member carries `tier: opus`"**
   - ✓ Met — `party.json:6` implementer is now `tier: "sonnet"`, `seat: "work"`. Tier audit `jq '.members[]|select(.seat=="work")|.tier'` → `sonnet` (no opus).

3. **"party/quest/dungeon validate against their schemas"**
   - ✓ Met — Draft-7 validation of all three against `laplas/schemas/*.schema.json` → all valid (extensions like `_note`/`_budget_note` sit within `additionalProperties: true` objects; `review_routing:{council:false}` valid under `additionalProperties:false`).

4. **"The opus gate seat is preserved (FAGAN craft-gate `opus`); the HITL operator slot is preserved"**
   - ✓ Met — `party.json` reviewer is `role:reviewer, seat:council, tier:opus` (the single FAGAN gate); operator HITL slot `operator-approval` retained; quest gate `craft-gate → fagan/reviewing-diffs` + `operator-seam → operator-approval` preserved.

## Tasks Completed

| Task | File | Change |
|------|------|--------|
| 1.1 | `modules/code-implement-and-review/party.json` | implementer (worker archetype) `opus→sonnet`; dropped the 2nd council voice (`reviewer-b`); single FAGAN reviewer stays `opus`; operator HITL kept; `_note` rewritten for the fan-out+single-gate intent |
| 1.2 | `…/quest.json` | objectives rewritten (decompose→parallel workers; ONE gate on merged diff, item-anchored); `review_routing: {council:false}` (operator decision); version 1.0.0→1.1.0; gate contract + mandated README read preserved |
| 1.3 | `…/dungeon.json` | rooms `implement→fan-out` (the wave) + kept `review` (the gate seam); wave-aware budget (`tool_calls 50→120`, wall_s unchanged — leaves run concurrently); `_budget_note` states the sizing assumption |
| 1.4 | — | `laplas-ready` green; receipt recorded in NOTES.md |

## Technical Highlights
- **Single-gate decision** preserves the FR-E council elsewhere — `council:false` here is a per-composition choice, not a removal of the hardened enforcement.
- **No churn on gate rooms** — kept the dungeon `review` room name so quest gate `room` refs needed no change (P604 holds); only `implement→fan-out` renamed.
- **Declaration-only** — zero runtime code; the redesign rides the already-shipped RFC #35 fan-out (verified in the plan's grounding table).

## Testing Summary
- `node laplas/bin/laplas-ready.mjs modules/code-implement-and-review/module.json` → PASS, receipt minted.
- Draft-7 schema validation (party/quest/dungeon) → all valid.
- Tier audit → 0 opus workers; opus gate preserved.

## Known Limitations
- The dungeon budget (`tool_calls: 120`) is a stated assumption for ~N parallel leaves — to be tuned against the S3 A/B benchmark.
- The manifest now *declares* the fan-out intent; the executor wiring (`/compose` resolving `args.items[]`) is **S2** — the manifest alone doesn't fan out until S2 lands.

## Verification Steps (reviewer)
1. `node laplas/bin/laplas-ready.mjs modules/code-implement-and-review/module.json` → `ready:true`.
2. `jq '.members[]|select(.seat=="work")|.tier' modules/code-implement-and-review/party.json` → `sonnet` only.
3. Draft-7 validate the three manifests against `laplas/schemas/`.
