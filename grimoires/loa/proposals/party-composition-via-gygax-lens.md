---
status: candidate
authored: 2026-06-15
author: operator direction (kaironic) + agent sketch
supersedes: the weaver/dealer authoring paradigm (construct-compositions, archived 2026-06-15)
grounding: laplas/schemas/party.schema.json · the module/quest/party/dungeon decomposition
---

# Party composition via the game-design (Gygax) lens

> Candidate direction — a sketch, not doctrine. Promote through /plan before it drives build work.

## The reframe

A composition is a **party**: the team of constructs you send into a piece of work.
Authoring a composition is **party-building**. We just retired the weaver/dealer way of
doing it ("read the dance" → emit a flow), which in practice produced *random gibberish*
parties — lineups with no coverage discipline. The replacement is a **game-design lens**:
assemble and **balance** the party the way a GM (Gygax) builds an adventuring party for a
dungeon — by role coverage, power budget, and survivability, not by vibe.

This is not a new abstraction bolted on. laplas **already** speaks party:

- `laplas/schemas/party.schema.json` — a party is `members[]`, each a
  `{role, kind: agent|hitl, seat: work|council, tier}`. The operator is a **HITL slot**, a
  real seat in the party, "not ambient magic."
- The `module / quest / party / dungeon` decomposition already separates the **WHO** (party)
  from the **WHAT** (quest) and the **WHERE** (dungeon).

So the move is: give the *party* (the WHO) a real design discipline.

## TTRPG ↔ laplas mapping

| TTRPG | laplas party | The balance question |
|---|---|---|
| Class (tank/healer/dps/utility) | `role` + `seat: work\|council` | Is every needed role covered? Any gap? |
| Power level / encounter budget | `tier` (opus/sonnet/haiku/fable) | Is the party over-leveled (all-opus = cost) or under-leveled for the dungeon's difficulty? |
| The party leader / player agency | `kind: hitl` slot | Is the operator seated where decisions actually happen (gates), not babysitting? |
| The dungeon | the quest's difficulty/surface_class | Does THIS party survive THIS dungeon? |

## What Gygax brings (that weaver didn't)

1. **Role-coverage check** — a party with a `craft-gate` but no `primary` work seat, or three
   reviewers and no implementer, is a *broken party*. Gygax's job is to name the gap.
2. **Encounter/power budget** — match `tier` to dungeon difficulty. A `defi-strict` outage
   dungeon earns opus council seats; a `culturetech-loose` polish pass should be a sonnet/haiku
   party. (This already half-exists as the emitter's role→tier routing — Gygax makes it a
   *design decision*, not an emergent default.)
3. **Council vs. work ratio** — too many `council` seats = analysis paralysis; all `work`,
   no gate = no quality bar. There's a healthy ratio per dungeon class.
4. **The playtest** — before spend, ask "does this party clear the dungeon?" the way a GM
   pre-checks an encounter. This is the `validate-before-spend` gate with a *balance* opinion.

## Concrete next steps (not built)

- **`party-fit` sensor** — sibling to `scripts/summon-lint.py`: given a composition, score its
  party for role-coverage gaps, tier/cost balance, council:work ratio, and HITL placement.
  DETECTOR-tier (surfaces, never gates). This is the smallest first step and reuses the
  summon-lint shape.
- **Gygax as a composing stage** — a `/compose-party` (or gygax skill) that takes a
  quest+dungeon and *proposes a balanced party*, then lets the operator adjust seats. Gygax
  already carries 460+ game-design heuristics and a party-design vocabulary; point it at
  `party.schema.json`.
- **Re-author the 4 dropped intents** — `listen-and-weave`, `dogfood-cycle`, `find-and-play`,
  `persona-bot-creative-direction` had valid *intents* but weaver parties. Rebuild them as
  Gygax-balanced parties (git preserves the originals for reference).
- **Maybe salvage** `rendering-mermaid` from archived cc — paradigm-agnostic party/chain
  visualization; useful for *seeing* a party before firing it.

## Open questions

- Does Gygax compose the party, or just *critique* a proposed one (the adversarial-balance
  seat)? Critique-first is cheaper and safer to trial.
- Where does the party-fit opinion gate? Advisory on `culturetech-loose`, enforced on
  `defi-strict` — mirror the existing `surface_class` pattern.
