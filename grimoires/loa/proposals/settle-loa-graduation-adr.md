# ADR / Proposal — settle graduates to the loa kernel (PROPOSAL ONLY)

> Phase 4 of The Descent (`grimoires/loa/context/goal-the-descent.md`): begin the absorption
> arc. **This is a proposal, not a merge.** The loa System Zone is NEVER-EDIT; absorption is
> operator- and cycle-gated and must be *earned*. This document lives in loa-laplas and changes
> **nothing** in loa.

- **Status:** proposed · not accepted · not merged
- **Date:** 2026-06-23
- **Scope:** loa-laplas (brakes) → loa (kernel). Authority to merge into loa rests with the
  operator + a loa cycle gate, not this document.

## The claim

settle has descended to the brakes layer and is now enforced from below (Phases 1–3:
`scripts/settle/`, freeside consumer in shadow, the reusable rail + layer-law gate). The
*eventual* home for its core invariant is the **kernel** — what graduates to loa, every layer
gets for free. settle's graduable core is not the whole substrate; it is one primitive:

> **the tier ladder + verdict→tier mapping as a first-class field of loa's audit/verdict
> envelope** — so any L1–L7 audit event can carry a `claimed→settled` tier, and
> `compute_verdict_status` refuses to report `clean`/`APPROVED` when the earned tier is below
> what the posture requires (the same fail-closed rule settle's `checkSync` enforces).

## The named loa primitive

loa already has the seam: `compute_verdict_status` (`.claude/adapters/cheval.py`) +
the cycle-109 **verdict-quality** conformance suite
(`tests/fixtures/cycle-109/verdict-quality-conformance/`, e.g.
`bug-809-status-clean-misleading.json` — "status clean is misleading when verdict quality is
degraded"). That is precisely settle's thesis at the verdict layer: a green status is
impossible when the underlying verification is degraded.

**Proposed graduation:** wire settle's `tier` (`abstained<claimed<pinned<settled`) +
`verdictToEarnedTier` + the G-7 degraded-chain cap into the verdict envelope that
`compute_verdict_status` reads, as an optional `earned_tier` / `required_tier` pair. When
present, `status: clean | APPROVED` is impossible if `earned_tier < required_tier` — the brake
becomes a kernel invariant, not a brakes-layer composition.

## Criteria that earn absorption (the gate)

Absorption is earned, not asserted. It is eligible when ALL hold:

1. **Proven descent** — Phases 1–3 complete: settle in laplas composes legba (one signer); the
   counter-example teeth + negative control pass; the layer-law gate is wired and bites; the
   reusable rail is proven on a second substrate. *(Done as of 2026-06-23.)*
2. **Proven enforcement-from-below** — at least one real consumer has run under the brake in
   **enforce** (not shadow) mode for ≥ N cycles with the trail showing real verdicts and no
   false HALTs. *(Phase 2 is in shadow; shadow→enforce is operator-gated and not yet flipped.)*
3. **Stable surface** — the `tier`/`earned_tier`/`required_tier` shape has not changed across
   those cycles (a kernel field must be stable; see `schema-is-not-the-contract`).
4. **A loa cycle + operator sign-off** — the merge into loa System Zone goes through a loa
   planning cycle, with the verdict-quality conformance suite extended to cover the tier field.

Until all four hold, settle stays in the brakes layer and freeside composes it downward.

## What this proposal explicitly does NOT do

- It does **not** edit any file under `loa/.claude/` (System Zone) or anywhere in the loa repo.
- It does **not** merge, open a PR against loa, or stage a loa change.
- Verification (run from loa-laplas): `git -C ../loa status --porcelain -- .claude/` shows the
  **same** set of changes before and after this proposal — this document added zero of them.

## Out of scope

The actual kernel merge (a future loa cycle). This ADR only names the primitive, the
integration seam, and the criteria — so when the descent has earned it, the absorption is a
decision, not a discovery.
