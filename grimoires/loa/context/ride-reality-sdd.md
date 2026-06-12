# Software Design Document — construct-rooms-substrate

> **Source of Truth notice**: Reverse-engineered from code by /ride on 2026-06-12.
> Code is truth; citations are file:line into this repo at branch
> feat/issue-40-cognitive-load-routing @ e22f432.

## Document Metadata

| Field | Value |
|---|---|
| Generated | 2026-06-12 |
| Codebase size | 99 files / 33,839 lines (probe) — ~9,000 lines of script source in the app zone |
| Languages | Bash (entry points + validators), Python 3 (compiler core), Node (harness, gates, legba), YAML/JSON (compositions, schemas) |

## 1. Tech Stack (verified)

| Layer | Tech | Evidence |
|---|---|---|
| [GROUNDED] Entry points / orchestration | Bash, `set -euo pipefail` | compose-dispatch.sh:48; all scripts/*.sh |
| [GROUNDED] Compiler core | Python 3 stdlib + jsonschema/pyyaml/rfc8785 | compose-cut.py; segment-emitter.py; construct.yaml:111-113 |
| [GROUNDED] Workflow harness + offline gates | Node (.js) | scripts/lib/run-emitted-segment.js; workflow-syntax-check.js |
| [GROUNDED] Legba | Node ESM (.mjs), zero deps (`node:crypto`, `node:fs`) | scripts/legba/README.md:4-6 |
| [GROUNDED] YAML/JSON plumbing | yq >= 4, jq >= 1.6 | construct.yaml:117-122 |
| [GROUNDED] Tests | bats (13 suites, 236 @test) + `node --test` (legba, 8) | tests/; scripts/legba/legba.test.mjs |
| [GROUNDED] CI | GitHub Actions post-merge pipeline (classify → simple-release tag OR full cycle pipeline via claude-code-action) | .github/workflows/post-merge.yml |

## 2. Module Structure

```
scripts/
  compose-dispatch.sh        # COMPILER entry: validate → cut → emit (Form C); legacy Form A/B fall-through
  compose-verify-run.sh      # proof-of-run terminal gate (valid_run | not_a_run)
  compose-handoff-wrap.sh    # seed → validate → envelope a handoff at each seam
  compose-seam-clew.sh       # >>clew@ capture at seams
  compose-doctor.sh          # runtime readiness check
  compose-output-schema-preflight.sh
  construct-adapter-gen.sh   # construct.yaml → .claude/agents/construct-<slug>.md
  *-validate.sh              # handoff / room-packet / construct-manifest / pair-relay gates
  handoff-parity-check.sh    # native vs headless packet diff
  surface-envelope.sh        # pair-relay FIFO surfacing
  migrate-subagents-*.sh
  lib/                       # compose-cut.py · segment-emitter.py · adapter-generator.py ·
                             # construct-handoff-lib.sh (hash core) · run-emitted-segment.js ·
                             # workflow-syntax-check.js · compose-cost-card.py
  clew/                      # VENDORED from loa-constructs (VENDORED.md provenance log)
  legba/                     # custody-chain verification CLI (PROVISIONAL)
hooks/subagent-{start,stop}/ # observability hooks (log-only)
data/{schemas,trajectory-schemas}/  # manifest-v4 · handoff · room-packet · pair-relay
compositions/                # pilot + 3 relay references
skills/compose/SKILL.md      # the /compose executor contract
templates/construct-adapter.template.md
tests/{integration,composition/state,fixtures}/
```

[GROUNDED] Division of labor: bash is the COMPILER ("bash can't run agents"), the Claude
Code main loop is the EXECUTOR running each segment via the Workflow tool
(README.md:89-94; segment-emitter.py:5-9; skills/compose/SKILL.md:21-25).

## 3. Core Pipeline (Form C)

```
composition.yaml
  → yq YAML→JSON                                  (compose-dispatch.sh)
  → compose-cut.py: schema-validate (offline-robust; unresolvable remote $refs
    treated allow-anything so validate-before-spend never needs network)
    + cut chain[] into maximal gate-free segments  (compose-cut.py:8-18)
  → segment-emitter.py: one .workflow.js per segment
    (meta literal, baked room packets, top-level await body, typed return)
  → .run/compose/<run_id>/{workflows/*.workflow.js, form-c-manifest.json,
    composition.json, orchestrator.jsonl} + .run/rooms/<room_id>.json
  → main loop: Workflow({scriptPath, args}) per segment; agent() spawns in room authority
  → compose-handoff-wrap.sh at each seam; AskUserQuestion + clew between segments
  → compose-verify-run.sh <run_id> — terminal gate
```

## 4. Security / hardening design (emitted-code injection surface)

[GROUNDED] Single choke point `js()`: every composition value enters emitted JS only via
`json.dumps(ensure_ascii=True)` + determinism escape; no bare f-string interpolation
anywhere (segment-emitter.py:20-27, 70-77).

[GROUNDED] Determinism: `js()` \uXXXX-escapes the leading byte of Date / Math.random
tokens so prose mentions cannot place the literal token in emitted SOURCE (the runtime
greps source and aborts); runtime VALUE unchanged (segment-emitter.py:55-66).

[GROUNDED] Failure is never empty: thrown stage → typed `{__stage_failed: true, ...}`
sentinel; `agent() → null` (operator-skip) distinct; StructuredOutput miss → validate →
retry once → degrade (segment-emitter.py:33-39; README.md:112).

[GROUNDED] Sync-throw safety: every stage body and boundedParallel thunk wrapped in
safe() (segment-emitter.py:40-42). Rate limits: boundedParallel chunks fan-out; iterating
loop sequential by construction (segment-emitter.py:43-45).

[GROUNDED] Clew/steer text reaches capture via argv/stdin, never shell-interpolated
(README.md:112; compose-seam-clew.sh).

[GROUNDED] **A room is NOT a security boundary** — tool mandates are observability-primary;
the SubagentStart hook logs and exits 0 regardless of findings
(loa-tool-mandate.sh:16-17,140; README.md:124).

## 5. Data Model

See grimoires/loa/reality/data-models.txt for full field inventories. The five typed
artifacts: [GROUNDED]
- **construct-handoff packet** (required: construct_slug, output_type, verdict,
  invocation_mode, cycle_id) — the inter-room envelope; content travels as output_refs,
  never transcript (construct-handoff.schema.json; README.md:39-43).
- **room-activation packet** (required incl. mode, invocation_path) — room authority.
- **pair-relay composition descriptor** — relay shape.
- **construct manifest v4** — substrate reads only tools.* + adapter.*.
- **clew ledger line** (LEARNINGS.jsonl) — captured operator corrections.

[GROUNDED] Envelopes are content-addressable: id recomputed via the single hash core
(construct-handoff-lib.sh compute-id), folded in stage order into an envelope_digest
(compose-verify-run.sh:34-43).

## 6. Model routing (branch state)

[GROUNDED] Tier map in emitter: tiny→haiku, cheap→sonnet (explicitly NOT haiku —
"the pre-reconciliation cheap≡haiku mapping silently mis-routed every cheap stage"),
mid/standard/else→opus singleton-up routing; honors capabilities.{model_tier,
downgrade_allowed}; relative gate floor is temporal (preceding peers only)
(segment-emitter.py:130-182; commits 928c356/05d54fb/c3d4446).
[GROUNDED] Open gap R-F001: model-alias provenance verified only offline; live
runtime-dispatch probe TODO (segment-emitter.py:140-146).

## 7. External Contracts / Integration Points

| Contract | Direction | Evidence |
|---|---|---|
| [GROUNDED] Composition bridge schema (composition.schema.json, v1.3 hitl_by_nature) | READ from host loa-constructs install; LOA_COMPOSE_SCHEMA override | compose-dispatch.sh:60-63; README.md:140 |
| [GROUNDED] Claude Code agent registry (.claude/agents/*.md, CC >= 2.1.0) | WRITE (adapters) | construct-adapter-gen.sh; construct.yaml:108-110 |
| [GROUNDED] Claude Code Workflow tool | emitted .workflow.js consumed by main loop | segment-emitter.py:16-22 (runtime shape "verified against the live Workflow tool") |
| [GROUNDED] CC hooks (SubagentStart/Stop) | observability | hooks/; SUBAGENT-HOOKS-INSTALLATION.md |
| [GROUNDED] Construct packs (.claude/constructs/packs/) | READ manifests; WRITE LEARNINGS.jsonl via clew | adapter-generator.py (LOA_ADAPTER_PACKS_DIR); ledger-append.sh |
| [CLAIMED: scripts/legba/README.md:8-13] loa-hounfour#118 | schema-shape tracking (SpanMove/GateToken/RunReceipt) | cross-repo, not locally verifiable |
| [GROUNDED] Run artifacts | WRITE .run/compose/<run_id>/, .run/rooms/, .run/audit.jsonl, .run/construct-trajectory.jsonl | compose-dispatch.sh:24-30; loa-tool-mandate.sh:10-12 |

## 8. Configuration Surface (env)

[GROUNDED] 41 distinct env refs (reality/env-vars.txt). Key knobs: LOA_PROJECT_ROOT
(re-rooting for standalone tests), LOA_COMPOSE_SCHEMA(_INSTALLED), LOA_SEAM_ROLES,
LOA_CYCLE_ID, LOA_ADAPTER_{PACKS_DIR,AGENTS_DIR,TEMPLATE,PROJECT_ROOT},
LOA_CLEW_{LEDGER_ROOT,LOCK_TIMEOUT,AGENT_STATE}, LEGBA_{RUN_DIR,SPAN_INDEX,REEXEC_TOOLS},
LOA_COMPOSE_EST_{IN,OUT}_TOKENS + LOA_COMPOSE_PRICES_JSON (cost card).
[GROUNDED] LOA_ROOMS_DEFAULT_MODEL does NOT exist (README.md:206 accurate on this point).

## 9. Test Architecture

[GROUNDED] 13 bats suites / 236 @test: tests/integration/ (11 suites, 223) +
tests/composition/state/ (2 suites, 13); legba via node --test (8). Form C runtime
outcomes (converged/cap_reached/degraded/operator-skip/throw) exercised via the
run-emitted-segment.js dry-run harness at zero token spend (README.md:170;
reality/test-files.txt). [GROUNDED] Fixture taxonomy: valid-*/invalid-* under
tests/fixtures/{handoff-packets,pair-relay,form-c,room-packets,probe-adapters}.

## 10. Known Gaps

1. [GROUNDED] R-F001 live model-alias probe (segment-emitter.py:146).
2. [GROUNDED] Clew slug-normalization fix not yet upstreamed (VENDORED.md:49).
3. [GROUNDED] Manifest `contributes`/`tests`/`requirements` lag the codebase (drift D2-D4).
4. [INFERRED] Form A/B retirement pending loom-ribbon repoint (README.md:116) — cross-repo dependency.

## Grounding Summary

| Marker | Count | % |
|---|---|---|
| [GROUNDED] | 28 | 90% |
| [INFERRED] | 1 | 3% |
| [ASSUMPTION] | 0 | 0% |
| [CLAIMED] | 2 | 7% |

Quality target met: >80% GROUNDED, <10% ASSUMPTION.
