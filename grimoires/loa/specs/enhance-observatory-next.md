---
hivemind:
  schema_version: "1.0"
  artifact_type: product-spec
  product_area: "Observatory · room-substrate observability"
  workstream: delivery
  priority: medium
  jtbd: {category: functional, description: "let an operator SEE constructs interact in real time as a /compose run plays — a roguelike lens on the room substrate"}
  learning_status: directionally-correct
  source: team-internal
---

# Session — The Observatory (next-level build)

> A roguelike lens on the room substrate: spectate a /compose run as a dungeon of resident
> construct-agents passing an envelope through gatekept doors. The substrate that puts every
> construct in an isolated room, made *visible*.

## Context

A working canvas prototype exists (v2, ALEXANDER pass) at `loa-freeside:grimoires/loa/observatory/{game.html, ORIENTATION.md}` — a tiled dungeon, `@` locked to screen-center, torch FOV, kakukuma-style 8×8 pixel sprites per construct, liveness clock-rings, doors-as-gates, slim HUD + roguelike log. Level 1 = the asson 5-cycle session, ending in THE LOITER CHAMBER. Operator: *"directionally correct,"* likes the pixel/kakukuma aesthetic. **This build inherits that — do NOT restart from zero.**

**THE design correction that drives this session (operator):** the prototype renders ONE `@` hero walking through every room. That is a dungeon-crawler simplification and it is *wrong for the substrate*. The truth the substrate already encodes:

- **Each room has its own RESIDENT construct-agent.** The construct IS the room's agent (construct-rooms-substrate puts every construct in an isolated room). Rooms are *inhabited*, not *visited*.
- **What travels room-to-room is the ENVELOPE** — the typed handoff packet — NOT a single player. The thing in motion is the payload, and the eye should follow *it*.
- **At each door/gate there is ANOTHER agent — a GATEKEEPER** who validates the handoff. The gate is *active* (an agent guards it; maps to Legba gate-validation + the seam protocol), not a passive door.
- **"The agent can change the other agent."** The envelope carries state that can TRANSFORM the receiving room's resident on arrival. Handoff is not inert transfer — it is mutation.

So v-next renders **a network of resident construct-agents · a traveling envelope (the Strong Center now) · door-gatekeeper agents · visible state-transformation on handoff.** Not a lone hero crawling a dungeon.

## Run via — game-feel-loop (REQUIRED)

The driving loop is **`game-feel-loop`** (r3 · kaironic, continuously-steered). It is a **construct case, NOT a compiled workflow** — do NOT `compose-dispatch` it. Run it as a live operator-steered loop: build a variation → the operator spectates the running artifact → names what's off in feel terms → ALEXANDER unpacks to a named value → inherit + iterate (Kocienda creative selection). The artifact IS the argument; the demo is the selection event.

- Recipe (read for shape, not to compile): `~/.loa/constructs/substrates/construct-compositions/compositions/delivery/game-feel-loop.yaml`
- For the *discrete* expert passes (sprite gen, the layout pass), a one-shot `/compose` IS appropriate — but **route those rooms to fable/opus, NOT sonnet** (construct-rooms-substrate#40, branch `feat/issue-40-cognitive-load-routing`; a sonnet grounding room loitered 14 min on the prototype's own design pass — the canonical case). Sonnet is for well-defined work fanned out in PARALLEL; open reasoning/design rooms want fable.

## Load Order

1. `~/.loa/constructs/substrates/construct-compositions/compositions/delivery/game-feel-loop.yaml` — the driving loop
2. `loa-freeside:grimoires/loa/observatory/game.html` — the v2 inheritance base (read the render loop + sprite system)
3. `loa-freeside:grimoires/loa/observatory/ORIENTATION.md` — the thesis + data contract + the full reference study
4. this doc
5. the operator's memory `[[observatory-rpg-observability]]` — the running record

## Persona

ARCH = **OSTROM** (the-arcade) for structure + game-UX. Craft lens = **ALEXANDER** (artisan) RESOLVED for visual — material, rhythm, weight, motion, color-as-information, measurable. Bring the expert party: **the-easel** (visual direction, pull the kakukuma/carmack/DelveSurvivors references), **rosenzu** (room/navigation), **kansei** (motion — the envelope's travel-weight, the gatekeeper's validation-beat, the transformation flash), **the-mint** (drive kakukuma's agent CLI to generate the real sprites). Embody OSTROM+ALEXANDER in the main loop (opus/fable); dispatch the-mint/the-easel as discrete fable rooms.

## What to Build (in order)

### 1. LevelData model + trace-gen (the data contract — replaces v2's baked TRACE)
A pure-JSON `LevelData` (carmack-engine shape): `rooms[]` (each = a resident construct-agent, with `construct`, `sprite`, grid pos, `liveness`), `gates[]` (door + key + a `gatekeeper` agent + verdict), `seams[]` (corridors), and crucially an `envelopes[]` stream (the travelers, with `from`, `to`, `payload_digest`, `transforms` = what it changes in the receiver). A `trace-gen.mjs` folds the REAL substrate into it: `.run/compose/<run>/` (rooms + the handoff envelopes — the substrate already emits `envelopes/`!) · `.run/audit.jsonl` (moves) · `.run/model-invoke.jsonl` (custody chain) · `@freeside/asson/liveness#livenessVerdict` (the clocks). **The substrate already produces envelope packets — read them, don't invent them.**

### 2. The renderer (resident agents + traveling envelope + gatekeepers)
Decide the renderer (see Open Decisions): port to **carmack-engine** (its `LevelData`→raycast/sprite render, the facts/meaning law that IS the substrate pattern) OR a carmack-SHAPED self-contained canvas (inherit v2's loop). Either way the render changes from v2: NO single `@`. Instead — each room shows its **resident agent** (idle sprite, the clock-ring above); the **envelope** is a glowing packet that travels the corridors (the new Strong Center — the eye follows it); a **gatekeeper sprite** stands at each door and plays a discrete *validation beat* as the envelope passes (key turns green); on arrival the envelope can **transform** the receiving resident (a visible state-flash — the agent changes the agent).

### 3. kakukuma sprite generation (the-mint, real pixels)
Generate the real sprite set via kakukuma's agent-native CLI (snapshot/describe, PNG/ANSI export): one distinct sprite per construct-agent, the envelope packet, the gatekeeper, the reaper, floor/wall tiles. Export PNG for the renderer (or ANSI for a terminal build). Pull the DelveSurvivors/roguelike texture as the reference (the operator's .mp4 genre).

### 4. The live tail (real-time spectate)
Poll the running `.run/compose/<run>/` + `.run/audit.jsonl` → re-derive LevelData → animate. This is the "see updates in real time" the whole thing exists for: run a /compose on one terminal, spectate it in the Observatory on the other.

### 5. The expert /compose refinement pass (fable rooms)
A discrete `/compose` (FABLE-routed) with the-easel + ALEXANDER + the-arcade + kansei to level up the look/UX/motion past the hand-tuned canvas. This is where the experts compound the craft.

## Quality Rules (ALEXANDER, measurable)
- **Strong Center is now the ENVELOPE**, not a hero — highest contrast + the camera's attention follow the packet in motion; residents are ambient until the envelope reaches them.
- **Resident vs gatekeeper vs envelope must be instantly distinct** — three silhouettes, three roles, never confused. Resident = idle in-room; gatekeeper = at-the-door, distinct posture; envelope = the moving glow.
- **Motion encodes the substrate physics** (kansei): the envelope's travel has *weight* (spring, not linear ease — it's carrying custody); the gatekeeper's validation is a discrete *beat* (a snap, not a fade — a gate is a decision); the transformation is a single *flash* on the receiver (state changed, once). Zero decorative motion (ALEXANDER: nothing moves for beauty alone).
- **The Void is structural** (torch FOV, inherited) — darkness = unseen substrate, not blank canvas.
- **Density-as-Clarity** — info in the map (sprite/clock-ring/door-state), not labels. One status line + the roguelike log only.
- **kakukuma palette** — keep the pixel warmth the operator liked; tighten to a coherent oklch-disciplined set per ALEXANDER.

## What NOT to Build (Barth)
- NOT a player-controlled game — **spectate-only** (read-only lens). No input verbs beyond play/pause/step/speed.
- NOT a true tile-grid with spatial reasoning — **rooms-graph** (flexible count); grid is a LATER graduation (operator + gumi).
- NOT reasoning-trace rendering yet (the NLA thread) — focus = construct-interactions + liveness/cost-gradient + gate/seam. Traces are a later layer.
- NOT a from-scratch renderer if carmack-engine fits — target it; don't rebuild a raycaster.
- NO sonnet in the open design/grounding rooms (#40).

## Verify
- `trace-gen.mjs` on a real `.run/compose/<run>/` produces valid LevelData with ≥1 envelope + ≥1 gatekeeper.
- The renderer shows a resident in each room, an envelope traveling a corridor, a gatekeeper beat at a door, and one transformation flash — with NO single-hero `@`.
- A live `/compose` run, tailed, animates in the Observatory within ~1s of the substrate writing an envelope.
- The operator spectates and the three roles read instantly (the v2's "same character everywhere" critique is gone).

## Review provenance + open operator decisions
- **Harden**: light inline (cosmetic/experimentation stakes) — references verified present (carmack-engine, kakukuma repos; the substrate's `.run/compose/<run>/envelopes/` is real, not invented). No heavy council; no beads skeleton (a visual build — track via the loop, not a bead DAG).
- **Open fork — renderer**: carmack-engine PORT (Next.js/React/Canvas, real LevelData engine, heavier setup) vs a carmack-SHAPED self-contained canvas (inherit v2, lighter, no Next.js). Operator decides at build start.
- **Open fork — Strong Center**: the traveling envelope (recommended — it's what moves) vs the active resident. Resolve by feel in game-feel-loop.
- **Gap I couldn't close**: the operator's `.mp4` reference (no video capability). The next session must pull the DelveSurvivors / kakukuma / carmack references DIRECTLY for the aesthetic ground-truth.

## Key References
| topic | path |
|---|---|
| inheritance base (v2 game) | `loa-freeside:grimoires/loa/observatory/game.html` |
| thesis + data contract + study | `loa-freeside:grimoires/loa/observatory/ORIENTATION.md` |
| driving loop | `construct-compositions/compositions/delivery/game-feel-loop.yaml` |
| model-tier fix (use fable rooms) | construct-rooms-substrate#40 · branch `feat/issue-40-cognitive-load-routing` |
| renderer | github.com/project-purupuru/carmack-engine (LevelData · facts/meaning law) |
| sprites | github.com/0xHoneyJar/kakukuma (agent-native pixel CLI) |
| the liveness engine (clocks) | `@freeside/asson` `src/liveness.mjs` (loa-freeside, leave-local branch) |
| the substrate's envelope output | `.run/compose/<run>/envelopes/` |
