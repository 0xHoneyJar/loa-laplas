---
status: candidate
mode: arch
date: 2026-06-13
topic: How the Loa workflow skills relate to the Form-C compose DAG + laplas constructs
provenance: operator question 2026-06-13 ("how does sprint-plan/implement piece into the runtime")
use_label: background_only
---

# ARCH brief — Loa skills as a SCAFFOLD for compositions (not a coupling)

## The isomorphism the operator spotted (it's real)

| Loa skill layer (SESSION) | Form-C compose layer (RUNTIME) | Laplas (DISPATCH) |
|---|---|---|
| `/sprint-plan` → task graph (sprints → tasks + `depends_on` + ACs) | `args.items = [{id, task, depends_on}]` — Kahn-wave fan-out (RFC #35) | quest = the WHAT (objectives, gates) |
| `/implement` → `/review` → `/audit` (work then gate) | iterate `[[work, craft-gate]]` — `code-implement-and-review` IS this | party = the WHO (constructs/spirits, first-class) |
| beads task lifecycle (deps, status) | wave scheduler (deps → waves) | dungeon = the WHERE (rooms, budgets) |

**The two are the same SHAPE at two altitudes.** `/sprint-plan`'s output is *already* a
task DAG with dependencies — which is *exactly* the args.items[] the compose runtime
fans out. And `/implement→/review` is *exactly* the work→craft-gate the composition
encodes. The operator's instinct is correct: the Loa planning layer is a decomposition
engine; the compose runtime is the execution engine; they want to meet.

## The CLEAN seam: a task-graph DATA handoff — NOT skill coupling

The fit is clean **only if we take the OUTPUT, not the machinery.**

- `/sprint-plan` produces a **task graph** (tasks + `depends_on` + the construct/skill each
  task wants). That graph, serialized, IS `args.items[]` — this is the `xbk` bead
  ("auto-decompose into args.items[]") seen architecturally: *sprint-plan is the
  decomposer; the compose driver consumes its graph.*
- Each item routes to a **construct (spirit)** — laplas already calls constructs
  first-class via the party. So the DAG leaves are not all `general-purpose`; the
  decomposition assigns `intelligence_tier` AND the construct per the item's domain
  (artisan for feel, noether for contracts, fagan for the gate).
- The interchange format is the **task graph**, not the skill. Keep the skills at the
  session level; keep the runtime lean.

## Where it does NOT fit cleanly (the pushback)

1. **Don't run `/implement` per leaf.** The implement skill is a single-context, multi-
   phase, gated SESSION workflow (beads, AC gate, retrospective, ~thousands of tokens).
   A DAG leaf is a *cheap sonnet worker* — running the full skill per leaf destroys the
   fan-out-cheap model. The leaf does WORK; the gate does REVIEW. Take the *pattern*
   (work→gate), not the orchestrator.
2. **Four "gates" are converging — they COMPOSE, they don't MERGE.** Name them so they
   don't collapse:
   - **Laplas ready-check** (P601–P606) — *dispatch precondition* (comp/loadout/lockout).
   - **Compose craft-gate** (fagan) — *runtime composition seam* (LLM review verdict).
   - **Loa review/audit** — *session quality gates* (senior-lead + paranoid-auditor LLM).
   - **Poteau exit-gate** — *cryptographic enforcement* (signed receipt attestation).
   The compose craft-gate and the Loa review are the SAME altitude (LLM judgment) — one
   is runtime, one is session; don't double them. Poteau is a DIFFERENT altitude
   (it *attests that the gate ran*, it doesn't re-judge). The honest stack:
   `laplas-ready → compose fan-out (constructs) → craft-gate → poteau attest`.
3. **The Loa audit is heavier than a craft-gate.** The security audit (OWASP, secrets,
   trust-boundaries) is not the same as a code craft-gate. If a composition needs that
   depth, it's a *second gate stage*, not a beefed-up craft-gate. Don't muddle them
   (the composition's own `operator_note` already says "CLEAR BOUNDARY FROM FLATLINE").

## The one concrete, ready piece (sprint-able)

**The decomposition bridge** (`xbk`): a `/compose` driver step that turns a goal into
`args.items[]` — either by invoking a lean decomposer (sprint-plan-shaped, NOT the full
skill) or by reading an existing sprint plan / beads epic's edges (`segment-emitter.py:
949-950` already says "the executor resolves topology to items[]"). Output: a
construct-routed task DAG. This is the ONE place the two worlds meet cleanly, and it's
the missing half that makes the compose-speed redesign "fast by default" instead of
"fast if you hand-write items[]".

## What is NOT ready (needs more design, not a sprint plan yet)

- Whether the decomposer is the *real* `/sprint-plan` (heavy, session) or a lean
  decompose-only step. (Lean is my bet — keep the runtime cheap.)
- How construct-routing is expressed in the item (an `intelligence_tier` + a
  `construct` field? the party already names constructs — reconcile.)
- Whether poteau should *attest* the craft-gate ran (it can — the gate verdict is the
  packet) — a natural extension, but a separate cycle.

## Recommendation

This is ARCH exploration, not a ready sprint. `/sprint-plan` on the *broad* integration
would produce a premature plan (`/plan is the END of exploration`). Crystallize THIS
brief first; then sprint-plan the ONE ready piece — the decomposition bridge (`xbk`) —
once the decomposer-shape + construct-routing questions above are decided.
