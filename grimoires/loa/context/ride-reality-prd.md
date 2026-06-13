# Product Requirements Document — construct-rooms-substrate

> **Source of Truth notice**: This PRD was reverse-engineered from code by /ride on
> 2026-06-12. It reflects what the code DOES, not an aspirational roadmap. Where this
> document and the code disagree, the code is truth. Supersedes any stale claims in
> README.md flagged in `grimoires/loa/drift-report.md`.

## Document Metadata

| Field | Value |
|---|---|
| Generated | 2026-06-12 |
| Generator | /ride (riding-codebase skill, non-interactive) |
| Codebase state | branch feat/issue-40-cognitive-load-routing @ e22f432; main @ 7164b8a; tag v0.3.0 |
| Scope | App zone only (scripts/, hooks/, data/, compositions/, skills/, tests/, docs/) — `.loa/` framework submodule and `.claude/` System Zone excluded |

## 1. Product Definition

[GROUNDED] construct-rooms-substrate is the composition runtime for Loa constructs: it
compiles a declared chain of construct invocations into Claude Code dynamic-workflow
segments and runs every construct boundary as an isolated, traced, packet-emitting
"room" (README.md:14; compose-dispatch.sh:1-47; segment-emitter.py:1-15).

[GROUNDED] It is substrate, not expertise: the manifest declares `personas: []`,
`skills: []`, `reads: []`, `writes: []`, `gates: {}` — "a manifest that declares its
own emptiness" (construct.yaml:28-48; README.md:128).

## 2. User Types

| User | Evidence |
|---|---|
| [GROUNDED] **The operator** — runs compositions via the /compose skill, answers seam questions, issues `>>clew@<construct>:` corrections | skills/compose/SKILL.md:1-60; scripts/compose-seam-clew.sh |
| [GROUNDED] **Main-loop Claude (the executor)** — runs emitted segments via the Workflow tool, wraps/validates handoffs, drives the seam protocol | skills/compose/SKILL.md:28-37 ("You are the EXECUTOR, not the composer") |
| [GROUNDED] **Constructs (as subagents)** — invoked in rooms via generated adapters at .claude/agents/construct-<slug>.md | scripts/construct-adapter-gen.sh; templates/construct-adapter.template.md |
| [GROUNDED] **Third-party verifiers** — verify a run with only the run dir + gatekeeper public key | scripts/legba/README.md:33-40 |
| [INFERRED] **CI / batch consumers** — the headless (Form B) path exists "for CI / batch / audit-only runs" | compose-dispatch.sh:16-20 |

## 3. Features (verified against code)

### F1 — Adapter generation
[GROUNDED] Generate a Claude Code native-subagent adapter from any construct.yaml,
reading only `tools.{allowlist,denylist,required}` + `adapter.{...}`
(scripts/construct-adapter-gen.sh; scripts/lib/adapter-generator.py:1-30; README.md:126).

### F2 — Form C compilation (validate before spend)
[GROUNDED] `compose-dispatch.sh --form-c` validates the composition offline, cuts the
chain at gate seams, and emits one deterministic `.workflow.js` per autonomous segment
plus per-stage room packets and a run manifest (compose-dispatch.sh; compose-cut.py:1-40;
segment-emitter.py:1-80). Exit 3 = awaiting main-loop run (compose-dispatch.sh:46).

[GROUNDED] Seam predicate: `mode == "blocking"` OR role ∈ {hard-stop, craft-gate, gate}
OR `hitl_by_nature == true`; co-location rule folds an autonomous iterate-pair's terminal
test into the preceding segment (compose-cut.py:15-29, DEFAULT_SEAM_ROLES, AUTONOMOUS_GATE_ROLES).

### F3 — Typed handoff packets (no room finishes silently)
[GROUNDED] Every room emits a construct-handoff packet; required: construct_slug,
output_type, verdict, invocation_mode, cycle_id; three-tier validation (fail-closed /
warn / optional) (data/trajectory-schemas/construct-handoff.schema.json;
scripts/handoff-validate.sh; README.md:39).

### F4 — Room authority
[GROUNDED] Spawned segments receive a room-activation packet (`mode: room`,
`invocation_path: agent_call`); without it the construct self-labels studio_synthesis;
gated by room-packet-validate.sh (data/trajectory-schemas/room-activation-packet.schema.json;
README.md:81).

### F5 — Seam protocol + clew capture
[GROUNDED] Human decision points are workflow boundaries run between segments
(AskUserQuestion + clew); `>>clew@<construct>: <why>` deposits durable learnings into the
construct's LEARNINGS.jsonl (scripts/compose-seam-clew.sh; scripts/clew/;
tests/composition/state/clew-hook-never-blocks.bats). [GROUNDED] Three seam outcomes —
converged / cap_reached / degraded — with cap_reached never folded into converged
(README.md:106; exercised via run-emitted-segment.js harness + compose-terminal-gate.bats).

### F6 — Proof-of-run terminal gate
[GROUNDED] `compose-verify-run.sh <run_id>` distinguishes a real governed run from inline
role-play by verifying manifest, segment files, orchestrator trail, and content-addressed
envelopes; returns valid_run / not_a_run (compose-verify-run.sh:1-46; 25 @test;
skills/compose/SKILL.md:40-46).

### F7 — Observability hooks (log, never block)
[GROUNDED] SubagentStart hook logs denylist violations, missing required tools, and
invocation-authority drift to .run/audit.jsonl + .run/construct-trajectory.jsonl, exit 0
always; SubagentStop hook collects handoffs (hooks/subagent-start/loa-tool-mandate.sh:15-17,140;
hooks/subagent-stop/loa-handoff-collect.sh).

### F8 — Pair-relay composition shape
[GROUNDED] A shipped two-construct relay pattern with schema-validated descriptors and a
FIFO envelope-surfacing path (data/trajectory-schemas/pair-relay-composition.schema.json;
scripts/pair-relay-validate.sh; scripts/surface-envelope.sh; 46 @test across 3 suites).

### F9 — Dry-run + offline gates (zero token spend)
[GROUNDED] run-emitted-segment.js executes an emitted segment with scripted agent
responses; workflow-syntax-check.js gates determinism (no Date/Math.random in source,
typed sentinel present) (scripts/lib/run-emitted-segment.js; scripts/lib/workflow-syntax-check.js).

### F10 — Legba: cryptographically verifiable runs (PROVISIONAL)
[GROUNDED] File-backed custody chain: spans propose, gates validate, ed25519 tokens carry
custody, the run compiles to one receipt hash; `verify` (third-party, public-key-only) and
`challenge` (fraud-proof by re-execution) verbs; zero dependencies
(scripts/legba/legba.mjs; legba-core.mjs; legba.test.mjs 8/8).
[CLAIMED: scripts/legba/README.md:8-13] Schema shapes track loa-hounfour#118 until it merges.

### F11 — Model-tier routing (branch #40, in flight)
[GROUNDED] The emitter routes stage models by intelligence tier — tiny→haiku,
cheap→sonnet, mid/standard/else→opus — honoring capabilities.model_tier /
downgrade_allowed, with a temporal relative gate floor (segment-emitter.py:130-182;
commits 928c356, 05d54fb, c3d4446). [ASSUMPTION] This lands on main via the #40/#41 PR;
not yet merged at ride time.

### F12 — Cost card
[GROUNDED] Per-run cost estimation from token estimates + price table
(scripts/lib/compose-cost-card.py; env LOA_COMPOSE_EST_IN_TOKENS / _OUT_TOKENS / _PRICES_JSON).

## 4. Non-goals (machine-readable in manifest)

[GROUNDED] No process isolation/sandboxing; no non-Claude-Code runtimes; not a
replacement for Loa L1-L5; no new construct expertise; no registry infrastructure;
no workflow/mode prescription (construct.yaml:136-142; README.md:120-129).

## 5. Requirements snapshot

[GROUNDED] Claude Code >= 2.1.0, python3 >= 3.10 (jsonschema, pyyaml, rfc8785),
bash >= 4.0, yq >= 4.0, jq >= 1.6 (construct.yaml:107-122).
[GROUNDED] Undeclared but load-bearing: node (legba, dry-run harness, syntax gate) and
bats (test runner) — drift D4.

## Grounding Summary

| Marker | Count | % |
|---|---|---|
| [GROUNDED] | 24 | 86% |
| [INFERRED] | 1 | 3.5% |
| [ASSUMPTION] | 1 | 3.5% |
| [CLAIMED] | 2 | 7% |

Assumptions requiring validation:
1. F11 merge destiny — confirm #40/#41 PR lands and README model-routing section updates with it.

Quality target met: >80% GROUNDED, <10% ASSUMPTION.
