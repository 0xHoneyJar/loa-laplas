# construct-rooms-substrate

> a substrate that puts every loa construct into an isolated room.
> kids in a classroom, each with a role, passing envelopes that show how they thought.

[![status](https://img.shields.io/badge/status-experimental-yellow)](#status--origin)
[![type](https://img.shields.io/badge/type-composition--runtime-blueviolet)](#what-this-is)
[![runtime](https://img.shields.io/badge/runtime-claude--code--workflows-blue)](#runtime-target)
[![scope](https://img.shields.io/badge/scope-pan--construct-green)](#what-this-is)
[![thesis](https://img.shields.io/badge/thesis-observability--first-orange)](#the-thesis-observability)

---

`construct-rooms-substrate` is the **composition runtime** for Loa constructs. It takes a composition — a declared chain of construct invocations — and runs it as a sequence of Claude Code dynamic-workflow segments, with every construct boundary enforced as a traced, packet-emitting **room**. It ships the adapter generator, the Form C compiler, the handoff/room/composition schemas, the validators, the observability hooks, and a set of reference compositions.

It is **substrate, not expertise**. It does not know what `artisan` does or what `k-hole` finds. It knows how to put either of them into a room, watch the room run, and record what came out. It has no persona, no skills, no domain opinion — it prescribes a runtime *shape*, never a domain answer.

The pipeline:

```
composition.yaml
  → validate (offline, before token spend)
  → cut at gate seams         (compose-cut.py · is_seam)
  → emit one .workflow.js per autonomous segment + per-stage room packets + a run manifest
  → CC main loop runs each segment via the Workflow tool (agent() spawns inside the workflow)
  → seam protocol between segments  (AskUserQuestion + clew capture)
```

---

## The thesis: observability

The point of a runtime substrate isn't to make agents work — agents work fine. The point is to make their work **legible to an outside observer**.

The originating brief framed this as a school-handoff metaphor: a classroom of students, each with a role, passes envelopes between desks. To delegate cleanly the teacher must **read into the envelopes** and see how each student thought — not just what they wrote on the front. When chains of agents pass results to each other, the bug almost never lives in any single agent. It lives in the gap between *what one agent thought it was producing* and *what the next agent thought it was receiving*. That gap is invisible until envelopes carry a WHY.

Three observability invariants:

1. **No room finishes silently.** Every room returns a typed `construct-handoff` packet — required: `construct_slug`, `output_type`, `verdict`, `invocation_mode`, `cycle_id` — gated by `handoff-validate.sh` (three-tier: required fail-closed · recommended warn · optional). School rule: you don't leave the room without handing in your work.

2. **Stated reasoning is suspect — pair it with diffable signal.** Per the [Anthropic NLA paper (2026)](https://transformer-circuits.pub/2026/nla/), a model's verbalized rationale can diverge from its actual behavior. So the packet pairs the `verdict` with fields an observer can cross-check against the transcript: `evidence` (file:line refs, excerpts, prior packet IDs), `pushback_invitation` (the construct's own `primary_uncertainty` + a specific `operator_check`), `kaironic_context` (why/when it fired), and `gates_passed` / `gates_failed`.

3. **Content travels as packets, not transcript.** Anything longer than the verdict is referenced via `output_refs`, never embedded — so a chain is legible from its envelopes alone, without replaying a single room.

Observability now extends past the packet: Form C makes spawns visible in `/workflows`, and the clew-at-seam loop captures operator corrections as durable construct learnings.

---

## What this is

When `construct-rooms-substrate` is installed in a repo with constructs synced, every construct becomes invocable as a Claude Code native subagent in an **isolated room** — its own context, its own tool allowlist, its own transcript — emitting a typed **handoff packet** when it finishes. Compositions chain rooms via packets, never via raw transcript.

### Concretely, this pack ships

| Component | Path | Purpose |
|---|---|---|
| Adapter generator | `scripts/construct-adapter-gen.sh` | produces `.claude/agents/construct-<slug>.md` from any `construct.yaml` |
| Adapter template | `templates/construct-adapter.template.md` | the canonical native-subagent shape (emits the typed handoff at the boundary) |
| **Form C compiler** | `scripts/compose-dispatch.sh --form-c` | validate → cut at seams → emit workflow-segments + room packets + manifest |
| **Seam cut** | `scripts/lib/compose-cut.py` | `is_seam` + co-location rule; cuts a composition into segments |
| **Segment emitter** | `scripts/lib/segment-emitter.py` | emits one deterministic `.workflow.js` per autonomous segment |
| **Handoff wrap** | `scripts/compose-handoff-wrap.sh` | seeds → validates → envelopes a typed handoff at each seam |
| **Clew-at-seam** | `scripts/compose-seam-clew.sh` + `scripts/clew/` | captures `>>clew@<construct>: <why>` corrections into construct `LEARNINGS.jsonl` |
| **Dry-run harness** | `scripts/lib/run-emitted-segment.js` | runs an emitted segment with scripted agent responses, zero token spend |
| Syntax/determinism gate | `scripts/lib/workflow-syntax-check.js` | offline check of emitted JS (no `Date`/`Math.random`, typed sentinel present) |
| Schemas | `data/trajectory-schemas/`, `data/schemas/` | handoff · room-activation-packet · pair-relay-composition · construct-manifest-v4 |
| Validators | `handoff-validate.sh` · `room-packet-validate.sh` · `construct-manifest-validate.sh` · `pair-relay-validate.sh` | gate every packet/schema |
| Pair-relay | `scripts/pair-relay-validate.sh` · `scripts/surface-envelope.sh` | a shipped two-construct relay composition shape |
| Parity checker | `scripts/handoff-parity-check.sh` | diffs native vs headless packets; allowed-only vs substantive divergence |
| Hooks | `hooks/` (`subagent-start` / `subagent-stop`) | tool-mandate observability + handoff collection |
| Reference compositions | `compositions/` | `code-implement-and-review.yaml` (pilot) · `access-relay` · `fidelity-relay` · `frame-relay` |
| Tests | `tests/integration/*.bats` | **115 `@test` assertions across 8 suites** |

### Why "rooms"?

A room is **one explicit construct invocation boundary**. It distinguishes two modes:

- **Studio mode** — natural-language synthesis where the agent "thinks with" several constructs at once. Useful, but cannot claim individual construct authority.
- **Room mode** — explicit invocation: this construct, these inputs, this output type, this transcript, finished by this packet.

Rooms make construct boundaries operationally enforceable. Studios stay studios. Form C *hardens* this: a spawned segment is passed its room-activation packet (`mode: room`, `invocation_path: agent_call`), so `agent()` runs in **room authority** — without the packet the construct self-labels `studio_synthesis`. `room-packet-validate.sh` gates it.

---

## The runtime: Form C (cycle-053)

A composition is **not one workflow** — it is a **chain of workflow-segments cut at gate seams**. Form C replaces the Form A (operator @-mention paste) and Form B (`claude -p` stub) dispatch hacks with the primitive they were faking: programmatic subagent spawn via the Claude Code **Workflow tool**, with `/workflows` visibility.

**Division of labor** — bash can't run agents; the main loop can.

| Role | Who | What |
|---|---|---|
| **Compiler** | `compose-dispatch.sh --form-c` (bash) | validate (offline-robust, **before spend**) → cut at seams → emit `.workflow.js` segments + per-stage room packets + a run manifest. Emitted JS cannot touch the filesystem. |
| **Executor** | the CC **main loop** | run each segment via `Workflow({scriptPath, args})`; wrap+validate its handoffs; at each seam run the **seam protocol** (`AskUserQuestion` + clew capture); fire the next segment with explicit JSON. |

**The cut.** A stage is a seam when:

```
is_seam(stage) := stage.mode == "blocking"
              OR  stage.role in {hard-stop, craft-gate, gate}   # LOA_SEAM_ROLES, --seam-roles
              OR  stage.hitl_by_nature == true                  # v1.3 third seam class
```

The co-location rule folds an autonomous iterate-pair's terminal test into the preceding segment; only the human verdict becomes a terminal seam. **N seams → up to N+1 segments.**

**The seam protocol cannot live inside a workflow** — a CC workflow run takes no mid-run human input. Every human decision point is therefore a workflow boundary, run by the main loop *between* segments. Three outcomes surface via `AskUserQuestion`: `converged` → confirm; `cap_reached` → operator gate (auto-approved-at-cap, the most clew-worthy); `degraded` → operator gate (handoff untrusted). **`cap_reached` is never folded into `converged`** — distinct end-to-end.

**Clew fires only at a seam.** No human is present mid-run, so there is **no clew hook inside an autonomous workflow body** — a seamless (all-primary) composition gathers zero learnings by construction. Gate = guidance + clew; no gate = no clew. One `>>clew@<construct>/<skill>: <why>` gesture both steers the next segment and deposits a durable learning (`scripts/clew/` → construct `LEARNINGS.jsonl`; capture-only — distill→ratify→PR stays cold-path, human-gated).

**`hitl_by_nature` stays human.** `feel-image` (image generation) and `game-feel-loop` (kaironic) are seams *forever* — never auto-migrated into an autonomous span. They mark the construct-vs-workflow boundary: the line between what the substrate automates and what stays human.

**Injection hardening.** Composition values reach emitted JS only via the `js()` escaper (`json.dumps` + determinism-escape); runtime values reach prompts only via `JSON.stringify`; clew/steer text reaches capture via argv/stdin, **never** shell-interpolated. A thrown stage → a typed `{__stage_failed: true, …}` sentinel; an `agent()` → `null` (operator-skip) is distinct. Failure is never empty.

> Authority for the seam protocol: `docs/compose-as-cc-workflow.md`.

**Form A/B are the legacy fall-through**, retired once the loom ribbon re-points at `/workflows` (the compat `orchestrator.jsonl` stream keeps them working until then). Do not treat them as gone yet.

---

## Boundaries (what this is NOT)

| It is NOT… | Because |
|---|---|
| **a security sandbox** | A room is a *named, traced, packet-emitting* boundary — no process isolation, cgroups, chroot, or capability dropping. Tool mandates are **observability-primary**: the `SubagentStart` hook **logs** violations, it does not **block** spawn. Do not treat a room boundary as a security boundary. |
| **a non-Claude-Code runtime** | Targets the `.claude/agents/*.md` registry **only** — not the OpenAI Agent SDK, Anthropic API direct, local LLM frontends, or custom orchestrators. The runtime-agnostic part is the **handoff packet schema**, not the adapter. |
| **a redefinition of construct identity** | `construct.yaml` is identity, `identity/<PERSONA>.md` is persona, `skills/<slug>/SKILL.md` are skills. The substrate reads **only** `tools.{allowlist,denylist,required}` + `adapter.{…}` from the manifest — nothing else. |
| **a replacement for Loa's L1-L5** | It complements the framework's in-session construct support; it does not replace it. Different operators want different runtimes. |
| **its own embodied construct** | It now ships a real `construct.yaml` (`type: skill-pack`, `personas: []`, `skills: []`) — a manifest that declares its own emptiness. It is an installable *runtime* construct, but there is nothing to embody: `@construct-construct-rooms-substrate` yields nothing useful. Mechanism, not voice. |

---

## Responsibilities

| Concern | Owner |
|---|---|
| What a construct *knows / does* (persona, skills, taste) | the construct's own pack |
| How a construct is *invoked, traced, composed* (rooms, packets, Form C) | **this pack** |
| The composition runtime + seam-cut shape | **this pack** |
| Which *model* a construct runs on | Hounfour routing (see below) — **not** this pack |
| The composition *bridge schema* (`composition.schema.json`, v1.3 `hitl_by_nature`) | the **host** (`loa-constructs`); the substrate only **reads** it |
| Cross-construct + cross-runtime concerns | the Loa framework |

**Where does X go?** Does it know about a specific construct? → construct pack. A specific runtime? → substrate pack. *All* constructs **and** *all* runtimes? → Loa framework.

---

## Runtime target

Claude Code **v2.1.0+** — the version where project agents at `.claude/agents/<name>.md` are loaded into the registry and surfaced via `@`-mention typeahead.

Sprint-0 probe facts that still hold: transcripts persist; the agent registry is read at session start. The probe also found that the parent session's `Agent` tool has a **fixed `subagent_type` allowlist computed at session start** that excludes project agents — which is precisely the gap Form C routes around: it spawns via the **Workflow tool** (`agent()` inside a CC dynamic workflow), not the parent `Agent` tool. `agentType` resolution is **probe-validated** (`construct-the-mint` resolves → embodies CELLINI → refuses out-of-domain).

---

## Acceptance gates → tests

The 8 PRD gates (T1–T8) are covered by **115 `@test` assertions across 8 bats suites**:

| Suite | `@test` |
|---|---|
| `form-c-dispatch.bats` | 34 |
| `pair-relay-validate.bats` | 20 |
| `surface-envelope.bats` | 14 |
| `pair-relay-orchestrator.bats` | 12 |
| `pilot-adapter-discovery.bats` | 10 |
| `tool-mandate.bats` | 10 |
| `composition-pilot.bats` | 8 |
| `headless-parity.bats` | 7 |

Form C runtime behavior (`converged` / `cap_reached` / `degraded` / operator-skip / throw) is exercised through the `run-emitted-segment.js` dry-run harness — scripted agent responses, zero token spend.

---

## How to use

```bash
# 1. generate native-subagent adapters from synced constructs
bash scripts/construct-adapter-gen.sh            # → .claude/agents/construct-<slug>.md

# 2. compile a composition into Form C workflow-segments (validates BEFORE spend)
bash scripts/compose-dispatch.sh compositions/code-implement-and-review.yaml --form-c
#    → .run/compose/<run_id>/{ workflows/<comp>.segment-K.workflow.js,
#                              form-c-manifest.json, composition.json, orchestrator.jsonl }
#    → .run/rooms/<room_id>.json   (per-stage room-activation packets)
#    exit 3 = "awaiting main-loop run": the CC main loop runs each segment via the
#             Workflow tool and drives the seam protocol between segments.

# 3. (optional) gate an emitted segment offline
node scripts/lib/workflow-syntax-check.js .run/compose/<run_id>/workflows/<seg>.workflow.js
node scripts/lib/run-emitted-segment.js   <seg>.workflow.js '<responsesByAgentType>' '<args>'

# 4. run the test suite
bats tests/integration/
```

In practice you do not hand-run this — the **`/compose` skill** reaches for the Form C runtime automatically when composition work appears (run / fire / dogfood a composition, audit-feel / code-implement-and-review / pair-relay chains, "use construct X then Y with a gate").

Single-construct, interactive invocation (`@construct-<slug>`) remains available as the legacy single-room path.

---

## Model routing & token cost (open design)

Generated adapters inherit the framework default (`model: inherit`), which can cascade Opus across an estate of constructs. **The substrate does not decide which model a construct runs on** — it is mechanism, not opinion. When Hounfour's task-adaptive routing contract finalizes, it becomes the source of truth and the substrate's only job is to render that decision into adapter frontmatter.

Interim overrides remain manual (per-adapter frontmatter, per-manifest `adapter.model`, or a mass `sed` over `.claude/agents/`). A central `LOA_ROOMS_DEFAULT_MODEL` knob is **not yet implemented**.

---

## Trade-offs (the honest version)

**The bet:** operator-visible, packet-emitting Claude Code subagents are a useful runtime affordance, worth the additional machinery.

**Its costs:**
- A compile step before every composition run (validate → cut → emit), plus main-loop orchestration overhead (run segment → wrap/validate handoff → seam protocol → fire next).
- A composition is now an *opinionated* shape (segments cut at seams), not a free-form pipe — the substrate prescribes a runtime shape even though it holds no domain opinion.
- Form A/B retirement is gated on the loom ribbon re-pointing at `/workflows`; two paths coexist until then.
- The bridge schema (`hitl_by_nature`, v1.3) lives host-side, so a schema bump is a cross-repo coordination, not a local edit.

**The alternative** — staying L1-L5-only — costs you the visible spawn surface, the typed handoff, and the clew loop, but carries none of the above machinery. Different operators want different runtimes. This pack is one runtime; the framework's L1-L5 is another. Neither is wrong.

---

## Status & origin

Experimental, **v0.3.0**, spun out to its own repo (`0xHoneyJar/construct-rooms-substrate`). Form C merged to `main` as `fc9897a` (PR #4, cycle-053); 115 tests green; `compositions/` is live with the `code-implement-and-review` pilot plus three relay references.

Authored as the deliverable of `cycle-construct-rooms`; the runtime + adapters are this repo's own source, edited directly here (framework `/implement` is walled off from the consumer `.claude/` System Zone). The composition bridge schema stays host-side in `loa-constructs`. Originating brief / PRD / SDD remain local-only under `grimoires/` (activation-receipt required before treating them as doctrine).

---

## See also

- `docs/compose-as-cc-workflow.md` — Form C runtime + seam-protocol authority
- `docs/cycles/cycle-053-compose-as-cc-workflow.md` — the build-spec
- `docs/runtime/construct-adapters.md` · `docs/runtime/composition-patterns.md`
- loa#452 · loa-constructs#181 / #234 — originating threads

---

## License

AGPL-3.0.
