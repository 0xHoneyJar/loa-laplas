# The Descent Procedure — take a substrate from app → brakes

> Phase 3 of The Descent (`grimoires/loa/context/goal-the-descent.md`): make the descent
> **reusable**. settle's descent (Phase 1) was the first walk of this rail; this runbook is
> the rail, so the next substrate has a path and no bespoke steps.

**The rail uses existing rails** — the planning pipeline (`/plan → /architect → /sprint-plan
→ /run sprint-N → /implement → /review → /audit`) and the layer-law gate. It does **not**
introduce a parallel orchestrator.

## When a substrate should descend

A substrate belongs in the brakes layer (loa-laplas) when agents in the application layer
(loa-freeside) must honor it but it currently lives *as defectable application code* and/or
**duplicates** a kernel/brakes primitive (its own ed25519/JCS/trail instead of composing
`legba`). The coherence monitor names the gap mechanically: `check-layer-law.mjs`.

## The steps

1. **Locate the duplication.** Identify what the substrate re-implements that already lives
   below it (legba: ed25519 sign/verify, JCS, sha256; poteau: the halt brake). Compose, don't
   copy. If legba is missing an export the substrate needs, extend `legba-core.mjs` *with a
   legba test* first (single-signer invariant: `generateKeyPairSync` stays in legba).
2. **Port scripts-first.** laplas is `.mjs` ESM + `node:test`, not a TS monorepo. Port the
   substrate to a single (or few) `.mjs` file(s) under `scripts/<substrate>/`. No npm-registry
   runtime deps — only `node:*` and relative laplas paths.
3. **Preserve the teeth.** Port the substrate's counter-examples to `node:test`, **including a
   deliberately-broken negative control** that proves the guarantee fires closed. `node --test`
   must exit 0 *with* the negative control asserting failure.
4. **Plan + build through the gates.** Drive it as a sprint (`/sprint-plan`, then `/run
   sprint-N` → implement → review → audit). Do NOT hand-implement outside the pipeline.
5. **Keep it downward-only.** Run the layer-law gate between steps — the descent must not
   introduce an inversion (`VIOLATION=0`). Provenance ("ported from <app repo>") goes in the
   PR/commit body, **not** in laplas code comments (the verifier greps the higher-layer name).
6. **Prove the descent.** Run the generic checker:
   ```
   node scripts/descend-check.mjs scripts/<substrate>
   ```
   It validates: scripts-first · composes legba (no own signer) · has tests · tests pass ·
   layer-law gate passes. Exit 0 = `DESCENDED ✓`.

## Proof this rail is reusable (not settle-bespoke)

`descend-check.mjs` is generic. It passes on the real substrate **and** on a minimal second
substrate that walks the same steps with no bespoke handling:

```
node scripts/descend-check.mjs scripts/settle               → DESCENDED ✓   (real)
node scripts/descend-check.mjs scripts/descent-example-stub → DESCENDED ✓   (stub: composes
                                                              legba + negative control, ~25 lines)
```

The stub (`scripts/descent-example-stub/`) is the worked example: copy its shape for the next
substrate.

## The gate that keeps it honest

`scripts/layer-law-gate.sh` wraps `check-layer-law.mjs` and **exits non-zero on `VIOLATION>0`**
(an inversion). It runs in CI (`.github/workflows/layer-law.yml`) so the stack self-checks every
push, and its teeth are proven by `scripts/layer-law-gate.test.mjs` (an intentionally-inverted
fixture must make the gate bite). `--strict` also fails on `GAP>0`.
