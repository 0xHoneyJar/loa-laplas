# External Interfaces

| Interface | Direction | Contract | Evidence |
|---|---|---|---|
| Composition bridge schema (composition.schema.json v1.3, `hitl_by_nature`) | READ | host-owned (loa-constructs); LOA_COMPOSE_SCHEMA override; offline-robust validation (unresolvable remote $refs → allow-anything) | compose-dispatch.sh:60-63; compose-cut.py:8-13 |
| Claude Code agent registry | WRITE | adapters → .claude/agents/construct-<slug>.md; CC >= 2.1.0 | construct-adapter-gen.sh; construct.yaml:108-110 |
| Claude Code Workflow tool | EMIT | one .workflow.js per autonomous segment; `export const meta` + top-level await body; agent() spawns inside workflow (routes around parent Agent-tool allowlist gap) | segment-emitter.py:11-22; README.md:151 |
| CC hooks (SubagentStart/Stop) | OBSERVE | log-only (never block); .run/audit.jsonl + .run/construct-trajectory.jsonl | loa-tool-mandate.sh:15-17,140 |
| Construct packs | READ manifests / WRITE learnings | LOA_ADAPTER_PACKS_DIR; clew → packs/<slug>/LEARNINGS.jsonl (slug normalized: `construct-` prefix stripped) | adapter-generator.py; ledger-append.sh; VENDORED.md:49 |
| Run artifacts | WRITE | .run/compose/<run_id>/{form-c-manifest.json, workflows/, envelopes/, orchestrator.jsonl, composition.json}; .run/rooms/<room_id>.json | compose-dispatch.sh:24-30 |
| loa-hounfour#118 | TRACK | legba schema shapes provisional until merge | scripts/legba/README.md:8-13 |
| GitHub Actions post-merge | CI | classify → simple-release (semver tag) or full cycle pipeline (claude-code-action); submodules: recursive + symlink reconcile | .github/workflows/post-merge.yml |
| Discord webhook | NOTIFY | failure alert via MELANGE_DISCORD_WEBHOOK secret | post-merge.yml notify job |
