# Architecture Overview

## System diagram (Form C, cycle-053)

```
                       COMPILER (bash — "bash can't run agents")
composition.yaml ──> compose-dispatch.sh --form-c
                       │ yq YAML→JSON
                       │ compose-cut.py ── bridge-schema validate (offline-robust)
                       │                └─ is_seam cut → segments + seams
                       │ segment-emitter.py ── one .workflow.js per segment
                       ▼                       (js() injection+determinism guard,
   .run/compose/<run_id>/                       baked room packets, tier routing)
     ├ form-c-manifest.json
     ├ workflows/<comp>.segment-K.workflow.js
     ├ orchestrator.jsonl          .run/rooms/<room_id>.json
     ▼
                       EXECUTOR (Claude Code main loop)
   Workflow({scriptPath, args}) per segment
     └─ agent() spawns constructs in ROOM AUTHORITY (room packet passed in)
   ── seam between segments ──
     ├ compose-handoff-wrap.sh  → validated envelope (content-addressed id)
     ├ AskUserQuestion: converged | cap_reached | degraded   (never folded)
     └ >>clew@<construct>: <why> → LEARNINGS.jsonl  (clew fires ONLY at seams)
     ▼
   compose-verify-run.sh <run_id>  ──>  valid_run | not_a_run   (TERMINAL GATE)
                                         "no valid_run = role-play, not a run"
```

## Division of labor

| Role | Who | Responsibility |
|---|---|---|
| Compiler | bash + python (offline) | validate BEFORE token spend; cut; emit deterministic JS |
| Executor | CC main loop | run segments, wrap/validate handoffs, drive seam protocol |
| Verifier | compose-verify-run.sh / legba | proof-of-run; cryptographic custody (provisional) |
| Observer | SubagentStart/Stop hooks | log-only audit trail (.run/audit.jsonl) |

## Invariants (enforced, with evidence)

1. No room finishes silently — typed handoff, 5 required fields, fail-closed gate
   (construct-handoff.schema.json; handoff-validate.sh).
2. Content travels as packets (`output_refs`), never transcript (README.md:43).
3. Every composition value enters emitted JS only via js(); no Date/Math.random in
   emitted source; failure is never empty (typed sentinels) (segment-emitter.py:20-45).
4. Human decisions are workflow boundaries — no mid-run human input; hitl_by_nature
   stages are seams forever (compose-cut.py; README.md:106-110).
5. A room is NOT a security boundary — hooks log, never block (loa-tool-mandate.sh:140).
6. A run is proven, not asserted (compose-verify-run.sh; skills/compose/SKILL.md).

## Tech stack

Bash 4+ (set -euo pipefail) · Python 3.10+ stdlib+{jsonschema,pyyaml,rfc8785} ·
Node (workflow harness + legba zero-dep ESM) · yq/jq · bats. No package manifests
by design. CI: GitHub Actions post-merge (classify → tag or full cycle pipeline).

## Data flows

- Compile-time: composition.yaml + construct manifests (tools.*/adapter.* only) +
  clew LEARNINGS.jsonl (recent_learnings baked as background guidance, sanitized
  in <untrusted-content>) → emitted segments (segment-emitter.py:46-53).
- Run-time: room packets in → handoff envelopes out → orchestrator.jsonl trail →
  envelope_digest (content-addressed, construct-handoff-lib.sh compute-id).
- Learning loop: seam corrections → clew capture → LEARNINGS.jsonl → (cold path,
  human-gated) distill → ratify → PR.
