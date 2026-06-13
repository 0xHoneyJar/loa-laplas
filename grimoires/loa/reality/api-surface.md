# API Surface (CLI substrate — no web routes)

## Compiler / runner

| Command | Purpose | Exit codes |
|---|---|---|
| `compose-dispatch.sh <comp.yaml> --form-c` | validate → cut → emit segments + room packets + manifest | 0 ok · 1 invalid · 2 stage-fail · 3 awaiting main-loop run |
| `compose-dispatch.sh <comp.yaml> [--interactive\|--headless]` | legacy Form A/B fall-through | same |
| `compose-verify-run.sh <run_id>` | proof-of-run terminal gate; verifies manifest + segments + orchestrator + content-addressed envelopes | valid_run / not_a_run |
| `compose-doctor.sh` | runtime readiness check | — |
| `compose-handoff-wrap.sh` | seed → validate → envelope a handoff at a seam | — |
| `compose-seam-clew.sh` | capture `>>clew@<construct>: <why>` (argv/stdin, never shell-interpolated) | — |
| `compose-output-schema-preflight.sh` | stage output_schema preflight | — |
| `construct-adapter-gen.sh` | construct.yaml → `.claude/agents/construct-<slug>.md` | — |
| `surface-envelope.sh` | pair-relay FIFO envelope surfacing | — |

## Validators (fail-closed gates)

handoff-validate.sh (3-tier: required fail / recommended warn / optional) ·
room-packet-validate.sh · construct-manifest-validate.sh · pair-relay-validate.sh ·
handoff-parity-check.sh (native vs headless; allowed-only vs substantive divergence)

## Library layer

| Tool | Contract |
|---|---|
| `lib/compose-cut.py <comp.json\|-> --schema <p> [--validate-only] [--seam-roles]` | stdout `{ok, composition, segments, seams}`; exit 0/1/64 |
| `lib/segment-emitter.py --segment --composition --room-packets --cycle-id --run-id --authored-at` | emits one deterministic .workflow.js |
| `lib/run-emitted-segment.js <seg> '<responsesByAgentType>' '<args>'` | dry-run harness, zero token spend |
| `lib/workflow-syntax-check.js <seg>` | offline gate: no Date/Math.random in source, typed sentinel present |
| `lib/construct-handoff-lib.sh compute-id` | THE hash core; envelope content-addressing |
| `lib/compose-cost-card.py` | per-run cost estimate |

## Legba CLI (zero-dep node)

`legba.mjs demo | provision | record | gate | verify <run-dir> | challenge <run-dir> --span N --seq K`
— verify exit 0 ok / 1 failed (custody chain + receipt hash); challenge = fraud-proof by re-execution.

## Hooks

`hooks/subagent-start/loa-tool-mandate.sh` — logs denylist/required/authority-drift findings
to .run/audit.jsonl + .run/construct-trajectory.jsonl; **never blocks, exit 0** (line 140).
`hooks/subagent-stop/loa-handoff-collect.sh` — collects handoff packets.

## Skill

`/compose` (skills/compose/SKILL.md) — browse + run compositions; the executor contract;
"a result without a valid_run verdict is role-play, not a run."
