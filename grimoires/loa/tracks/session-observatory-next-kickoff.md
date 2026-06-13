---
session: observatory-next
date: 2026-06-12
type: kickoff
status: planned
hivemind:
  schema_version: "1.0"
  artifact_type: meeting-notes
  product_area: "Observatory · room-substrate observability"
  workstream: delivery
  priority: medium
  jtbd: {category: functional, description: "session continuity — the Observatory next-level build was planned and why"}
  learning_status: smol-evidence
  source: team-internal
---

# Session — The Observatory next-level (kickoff)

## Scope
- Level up the Observatory from a one-`@`-hero dungeon-crawler to the substrate's TRUE shape: **resident construct-agents · a traveling envelope · door-gatekeeper agents · state-transformation on handoff**.
- Graduate the renderer from hand-tuned canvas → target **carmack-engine** (LevelData) + **kakukuma**-generated real sprites; wire the **live tail** of `.run/compose/<run>/` for real-time spectate.
- Refine via **game-feel-loop** (kaironic, operator-steered) + discrete expert `/compose` passes on **fable rooms, NOT sonnet** (#40).

## Artifacts
- Build doc (source of truth): `specs/enhance-observatory-next.md`
- Inheritance base (v2 game): `loa-freeside:grimoires/loa/observatory/game.html`

## Prior session (this one)
- Shipped the asson 5-cycle ladder (PR loa-freeside#281), built the Observatory v0→v2 (canvas roguelike, ALEXANDER pass). The design `/compose` LOITERED on sonnet → filed construct-rooms-substrate#40 (model-tier cognitive-load routing; branch already cut). Operator: shape directionally correct, likes the pixel/kakukuma look.

## Decisions made
- **Resident agents, not a wandering hero** — the construct IS the room's agent; the ENVELOPE is what travels; a GATEKEEPER guards each door; the handoff can transform the receiver.
- **Spectate-only · rooms-graph** (grid later) · focus = construct-interactions + liveness/cost-gradient + gate/seam (reasoning-traces later).
- **Fable/opus for open design rooms; sonnet only for well-defined parallel work** (#40).
- Renderer + Strong-Center forks left OPEN for the build session to resolve by feel.
- Aesthetic ground-truth gap: pull the DelveSurvivors / kakukuma / carmack references directly (the operator's .mp4 is un-watchable by the agent).
