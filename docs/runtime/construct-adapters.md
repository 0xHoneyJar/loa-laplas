# Construct Native-Agent Adapters

> Cycle: cycle-construct-rooms (simstim-20260509-aead9136)
> Status: Sprint 1-3-6 shipped; Sprint 4-5 follow-up

This document describes how Loa constructs are exposed as Claude Code native subagents through the **adapter** layer at `.claude/agents/construct-<slug>.md`.

## Mental model

```
┌────────────────────┐     ┌─────────────┐     ┌──────────────────┐
│ Manifest layer     │────▶│ Generator   │────▶│ Adapter layer    │
│ construct.yaml     │     │ python +    │     │ .claude/agents/  │
│ (canonical truth)  │     │ template    │     │ (ABI / runtime)  │
└────────────────────┘     └─────────────┘     └──────────────────┘
                                                        │
                                                        ▼
                                            ┌──────────────────────┐
                                            │ Claude Code runtime  │
                                            │ — @-mention typeahead │
                                            │ — claude agents CLI   │
                                            │ — operator subagent UI│
                                            └──────────────────────┘
```

The **manifest** is canonical: edit `construct.yaml` to change construct behavior. The **generator** produces the adapter from the manifest — it is a derivation, not a source. The **adapter** is the static binding to Claude Code's runtime — an ABI that registers the construct as a project agent.

## Two invocation paths (Sprint 0 confirmed)

A construct claims its bounded-context authority **only** when invoked through:

1. **`@agent-construct-<slug>`** — operator typeahead in Claude Code. Primary path. Reaches the operator's main session UI; transcripts visible in the running-subagents panel.
2. **Loa room activation packet** at `.run/rooms/<room_id>.json` — used by composition runner. The runner writes the packet, then writes a dispatch prompt that the operator @-mentions. The packet provides structured inputs and forbidden-context declarations.

**Path NOT supported:** `Agent(subagent_type="construct-<slug>", ...)` from skill code. Sprint 0 Probe 1 confirmed the parent session's `Agent` tool computes its allowlist at session start and does NOT include project agents from `.claude/agents/`. Skills attempting this path receive "Agent type not found" errors.

## Anatomy of an adapter

```yaml
---
# generated-by: construct-adapter-gen 1.0.0
# generated-at: 2026-05-09T23:30:00Z
# generated-from: .claude/constructs/packs/artisan/construct.yaml@sha256:...
# checksum: sha256:...
# DO NOT EDIT — regenerate via: bash .claude/scripts/construct-adapter-gen.sh --construct artisan

name: construct-artisan
description: "Use when the operator needs Artisan/ALEXANDER craft judgment..."
tools: Read, Grep, Glob, Bash, Edit, Write
model: inherit
color: orange

loa:
  construct_slug: artisan
  schema_version: 4
  manifest_schema_version: 3
  canonical_manifest: .claude/constructs/packs/artisan/construct.yaml
  manifest_checksum: sha256:...
  persona_path: .claude/constructs/packs/artisan/identity/ALEXANDER.md
  personas: [ALEXANDER]
  default_persona: ALEXANDER
  skills: [...]
  streams:
    reads: [Signal, Artifact]
    writes: [Verdict, Signal]
  invocation_modes: [room]
  domain:
    primary: visual-surface
    ubiquitous_language: [feel, weight, rhythm, surface, ...]
    out_of_domain: [...]
  cycle:
    introduced_in: simstim-20260509-aead9136
    sprint: cycle-construct-rooms-sprint-3
---

You are operating inside the **Artisan** bounded context, embodying **ALEXANDER**.
...
```

The body contains:
- Bounded-context declaration (domain, ubiquitous language, out-of-domain)
- Invocation authority clause (the @-mention/room-packet contract)
- Persona content (Voice section)
- Skills available to the construct
- Required output: handoff packet contract

## Generator (Sprint 3)

`construct-adapter-gen.sh` reads the manifest and renders the template:

```bash
# Generate one
bash .claude/scripts/construct-adapter-gen.sh --construct artisan

# Generate all (FR-2.6 enforced — pilots must exist)
bash .claude/scripts/construct-adapter-gen.sh

# Idempotency check (CI gate)
bash .claude/scripts/construct-adapter-gen.sh --check

# Dry-run
bash .claude/scripts/construct-adapter-gen.sh --dry-run
```

**Idempotent**: re-running with no manifest changes produces zero diff (the volatile `# generated-at:` timestamp is excluded from comparison).

**FR-2.6 pilot-first ordering**: generator refuses to produce non-pilot adapters until artisan + observer adapters exist. Bypass with `--force` (initial bootstrap only).

## Validators (Sprint 1)

| Validator | Purpose |
|---|---|
| `construct-manifest-validate.sh` | Validates `construct.yaml` against v4 schema; backward-compatible with v3 (informational warnings only) |
| `handoff-validate.sh` | Validates handoff packets against three-tier schema (required / recommended / optional) |
| `room-packet-validate.sh` | Validates room activation packets + verifies content-addressable `room_id` derivation |

Schemas:
- `.claude/data/schemas/construct-manifest-v4.schema.json`
- `.claude/data/trajectory-schemas/construct-handoff.schema.json`
- `.claude/data/trajectory-schemas/room-activation-packet.schema.json`

## Composition runner (Sprint 2)

`compose-dispatch.sh` orchestrates multi-stage construct compositions:

```bash
# Interactive (Form A): emits dispatch prompts the operator pastes into their session
bash .claude/scripts/compose-dispatch.sh tests/fixtures/compositions/artisan-observer.composition.yaml --interactive

# Headless (Form B audit-substrate, Sprint 4 completes): claude -p invocations
bash .claude/scripts/compose-dispatch.sh <composition.yaml> --headless

# Dry-run: validate composition + emit room packets without dispatching
bash .claude/scripts/compose-dispatch.sh <composition.yaml> --dry-run
```

Per stage, the runner:
1. Constructs a room activation packet from prior handoff + declared inputs
2. Writes packet to `.run/rooms/<room_id>.json`
3. Form A: emits dispatch prompt at `.run/compose/<run_id>/dispatch-prompts/stage-N.prompt.md` for operator to paste
4. Validates returned handoff packet
5. Logs `stage_enter`/`stage_exit` to `.run/compose/<run_id>/orchestrator.jsonl`

## Migrated validators (Sprint 6)

The legacy `.claude/subagents/` directory has been removed. Its 5 validator specs migrated to:

| Old path | New path |
|---|---|
| `.claude/subagents/architecture-validator.md` | `.claude/agents/loa-validator-architecture.md` |
| `.claude/subagents/documentation-coherence.md` | `.claude/agents/loa-validator-documentation.md` |
| `.claude/subagents/goal-validator.md` | `.claude/agents/loa-validator-goal.md` |
| `.claude/subagents/security-scanner.md` | `.claude/agents/loa-validator-security.md` |
| `.claude/subagents/test-adequacy-reviewer.md` | `.claude/agents/loa-validator-test-adequacy.md` |
| `.claude/subagents/README.md` | `.claude/agents/loa-validators-README.md` |

The `loa-validator-` prefix reserves the `loa-` namespace for future general-purpose Loa agent classes (orchestrators, observers, etc.) — the prefix `loa-` alone is not assumed to mean "validator."

Loaders updated:
- `.claude/commands/validate.md` (path updated)
- `.claude/protocols/subagent-invocation.md` (path updated)
- `.claude/protocols/structured-memory.md` (path updated)

Verification: `bash .claude/scripts/migrate-subagents-verify.sh`. Rollback: `git revert <Sprint-6 merge commit>`.

## Future cycle work (out of scope here)

- **Sprint 4**: `compose-run.sh` headless emission of construct-handoff packets; parity with Form A interactive output (T5 acceptance).
- **Sprint 5**: `SubagentStart`/`SubagentStop` hooks for tool-mandate enforcement (observability primary, per Sprint 0 Probe 1) and AskUserQuestion gate (T6, T7 acceptance).
- **vision-024**: Naming the adapter layer as ABI explicitly; future cycle may add additional ABIs targeting other runtimes.
- **vision-025**: Handoff packets as causal-history DAG; merger of `construct-handoff-lib.sh` and `structured-handoff-lib.sh` (L6) under shared helpers.
- **vision-031** (NEW): Two-tier subagent visibility (CLI/@-mention vs Agent-tool-allowlist) named explicitly in Loa's runtime contract.

## Reference

- PRD: `grimoires/loa/prd.md`
- SDD: `grimoires/loa/sdd.md`
- Sprint plan: `grimoires/loa/sprint.md`
- Sprint 0 spike: `.run/spike/sprint-0-probes-report.md`
- Sprint close summaries: `.run/sprint-2-close.md`, `.run/sprint-3-close.md`
- Bridge iter 1 review: `.run/bridge-reviews/bridge-20260509-b49286-iter1-full.md`
- Source brief: `grimoires/loa/context/private/construct-native-subagent-invocation-boundaries-2026-05-09.md`

## Proof-of-operation: the `verify` capability (verifiable-compose Epic B, RFC #57)

A construct/stage that performs a **verifiable multi-model operation** declares it
in `construct.yaml` capabilities. To earn a `valid_run`, the operation must leave a
**gatekeeper-signed, correlated receipt** proving it actually ran across
≥ `min_model_families` distinct **vendor families** (sprint-4 Check 6 enforces this).

```yaml
# construct.yaml — the FAGAN reference declaration
capabilities:
  verify:
    operation: multimodal-review        # the verifiable op this construct performs
    receipt: model-invoke.jsonl         # evidence source (cheval MODELINV log)
    min_model_families: 2               # FAMILIES (vendors), not final_model_ids
```

**FAMILY = vendor, not tier.** `claude-opus` and `claude-sonnet` are BOTH the
`anthropic` family — a 2-family declaration is NOT satisfied by opus+sonnet
(Flatline B6/B7). Genuine cross-vendor diversity (e.g. anthropic + openai) is
required. The pinned `final_model_id → family` table is
`scripts/data/model-family-map.json`; its **source of truth** is
`.claude/defaults/model-config.yaml` provider sections, and it is **drift-guarded**
by `tests/integration/compose-proof.bats` (`[B7]`). An id absent from the map
resolves to `null` and **cannot** satisfy a family slot (sprint-4 SB6 fail-closed).

### Receipt schema (normalized, Flatline B7)

`compose-proof-capture.py capture` writes `.run/compose/<run>/receipts/<idx>.json`:

```json
{
  "payload": {
    "compose_run_id": "...", "stage_index": 4, "stage_id": "synthesize",
    "operation": "multimodal-review", "envelope_hash": "sha256:...",
    "invocations": [ {"final_model_id","model_family","provider","invocation_id","provider_response_hash","timestamp"} ],
    "families": ["anthropic","openai"], "family_count": 2
  },
  "signing_key_id": "<gatekeeper key id>",
  "sig": "<base64 Ed25519 over canonical(payload)>"
}
```

The signature is produced by the **isolated writer** (the dispatcher/cheval process
that holds the gatekeeper key — the stage under verification cannot access it),
reusing `.claude/scripts/lib/audit-signing-helper.py` — **no new primitive**
(SDD B2/B3). Canonicalization is centralized in `compose-proof-capture.py`
`_canonical()` so capture (sign) and sprint-4 Check 6 (verify) use byte-identical
input. A forged receipt can copy field *values* but cannot produce a signature that
verifies under the gatekeeper public key.

### Dispatch integration contract (the sprint-3 → sprint-4 seam)

The proof-of-operation machinery is delivered as standalone, hermetically-tested
subcommands; the runtime wires them at two points:

1. **Before invocation** — for a stage where `compose-proof-capture.py should-verify
   --spec <construct.yaml|composition.yaml> [--stage-index N]` exits 0, the dispatcher
   writes the **attempted-marker**:
   `compose-proof-capture.py mark --run-dir .run/compose/<run> --stage-index <N>`.
2. **After invocation** — the isolated MODELINV writer folds the receipt:
   `compose-proof-capture.py capture --run-dir … --run-id … --stage-index … --stage-id …
   --operation … --envelope-hash … --modelinv .run/model-invoke.jsonl --key-id … --key-dir …`.

`mark`/`capture` create `attempted/` + `receipts/` `0700` and write atomically
(temp+rename) — SDD B4 isolation.

**Status (sprint-4 complete):** Check 6 is **LIVE** — `compose-verify-run.sh
--proof-of-operation` runs `compose-proof-capture.py check` (same canonicalizer +
sig verify; the verifier independently recomputes families from the SIGNED
invocations via the pinned map). Verdict mapping: forged/uncorrelated/under-family/
never-ran → `broken_run` (3); attempted-but-no-receipt → `degraded_run` (2, a
retryable deny queued to `verify-fail.jsonl`, never green); no declaration →
no-op (back-compat). Default-off (opt-in `--proof-of-operation`), mirroring
`--legba`'s default-off→default-on rollout. Proven by `compose-proof-check.bats`
(9, the negative battery: VC-B1..B4 + forgery/replay/marker-bypass/unmapped/
degraded/back-compat) + `compose-verify-proof-wiring.bats` (3, end-to-end through
`compose-verify-run.sh`).

**The remaining coherent seam — the Form C executor.** `declare` (run start),
`mark` (before each declaring stage's invocation), and `capture` (after, by the
isolated cheval/MODELINV writer) must land TOGETHER in the Form C executor (the
main loop that runs segments via the Workflow tool — NOT `compose-dispatch.sh`,
which only compiles + hands off) plus the cheval MODELINV `final_model_id`
tagging. They are deliberately not split: a `declare`-only hook would make a
`--proof-of-operation` run with a declaring stage fail closed (no marker/receipt
→ `broken_run`) before the executor can produce the evidence. Until the executor
is wired, the gate enforces whenever the artifacts are present (proven e2e) and is
a safe no-op otherwise.
