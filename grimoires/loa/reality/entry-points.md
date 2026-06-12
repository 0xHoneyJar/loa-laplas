# Entry Points

## Golden path (operator)
1. `bash scripts/construct-adapter-gen.sh` — generate adapters from synced constructs
2. `bash scripts/compose-dispatch.sh compositions/<name>.yaml --form-c` — compile (exit 3 = awaiting main loop)
3. Main loop runs segments via Workflow tool; seam protocol between segments
4. `bash scripts/compose-verify-run.sh <run_id>` — terminal gate
5. `bats tests/integration/` — test suite (NOTE: also run `bats tests/composition/state/`)

In practice: the `/compose` skill drives 2-4 automatically (skills/compose/SKILL.md).

## Diagnostics
- `scripts/compose-doctor.sh` — readiness
- `node scripts/lib/workflow-syntax-check.js <seg>` — offline determinism gate
- `node scripts/lib/run-emitted-segment.js <seg> '<responses>' '<args>'` — dry run, zero spend
- `node scripts/legba/legba.mjs demo` — custody-chain lifecycle + 3 attacks
- `node --test scripts/legba/legba.test.mjs` — legba suite (8)

## Key env knobs
| Var | Effect |
|---|---|
| LOA_PROJECT_ROOT | re-root .run/ + installed paths (standalone tests) |
| LOA_COMPOSE_SCHEMA / _INSTALLED | bridge-schema location override |
| LOA_SEAM_ROLES | extend seam-role set (default hard-stop,craft-gate,gate) |
| LOA_CYCLE_ID / LOA_COMPOSE_RUN_ID | id pinning |
| LOA_ADAPTER_{PACKS_DIR,AGENTS_DIR,TEMPLATE,PROJECT_ROOT} | adapter-gen overrides |
| LOA_CLEW_{LEDGER_ROOT,LOCK_TIMEOUT,AGENT_STATE} | clew capture |
| LOA_COMPOSE_EST_{IN,OUT}_TOKENS · LOA_COMPOSE_PRICES_JSON | cost card |
| LEGBA_{RUN_DIR,SPAN_INDEX,REEXEC_TOOLS} | legba hooks/replay |
| LOA_CONSTRUCT_HANDOFF_DISABLE_FINGERPRINT | hash-core escape hatch |

## System requirements
claude-code >= 2.1.0 · python3 >= 3.10 (jsonschema, pyyaml, rfc8785) · bash >= 4 ·
yq >= 4 · jq >= 1.6 · **node + bats (load-bearing but undeclared in manifest — drift D4)**
