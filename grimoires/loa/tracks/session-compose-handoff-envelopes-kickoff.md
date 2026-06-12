---
session: compose-handoff-envelopes
date: 2026-06-08
type: kickoff
status: planned
---

# Compose Form C handoff envelopes (kickoff)

## Scope
- PRIMARY (design-heavy): the emitter declares-vs-honors typed handoffs. Let a stage declare `output_schema` + `intelligence_tier`; segment-emitter.py emits them (fallback WORK_SCHEMA). Conform the two audit compositions + re-run via /compose; prove typed handoffs with proof-of-run.
- SECONDARY: land the SoT cutover UPSTREAM (survive a framework update); wire sensing-deployment-seam into gecko/patrol; cleanup SMELLs; cherry-pick 003d3fc onto crs main.

## Artifacts
- Build doc: `grimoires/loa/specs/enhance-compose-handoff-envelopes.md`

## Prior session (this chapter)
Diagnosed the deployment-seam class via a proof-of-run Opus audit (audit-ecosystem-coherence). Landed the SoT-manifest cutover (~/.loa/deployment.yaml; adapter-generator + construct-manifest-validate + construct-ensure read it; band-aid symlinks RETIRED; install-path SoT-forced) — all sensor-verified 0 CONFLICT. Built + INSTALLED GECKO's 4th eye (sensing-deployment-seam), loop-closed. bd-ii1m closed (ghost-construct validator + fagan first-class). Committed: construct-gecko 1a142df, construct-compositions 9173597; ~/.claude edits .bak-deployseam backed up.

## Decisions made
- Single global SoT (~/.loa) — operator decision; per-project .claude/constructs is a cache, not separate truth.
- The emitter cannot generically schema an abstract stream → compositions DECLARE per-stage schemas (the PoC proved the shape).
- Backwards-compat invariant: no output_schema → WORK_SCHEMA; the 49 form-c-dispatch.bats stay green.

## Open forks (operator decides)
- inline JSON-schema vs `$ref` in the composition YAML (recommend: support both, start inline)
- where the Loa framework upstream-source that installs ~/.claude lives (needs a DIG)
- beads store: crs has none — create in crs, or track in loa-constructs (recommend loa-constructs, keeps the chapter's beads together)
