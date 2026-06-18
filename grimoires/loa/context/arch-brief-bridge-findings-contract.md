---
status: candidate
source_issue: 0xHoneyJar/loa-laplas#56
plane: P1-contract / P2-construct
owner: the-weaver (BEAUVOIR)
classifies_as: enhancement (needs /plan, not /bug)
family: declared-composition-surface (#28 fixed, #29 fixed, #31 open, #55 fixed — this is the OUTPUT-side counterpart)
created: 2026-06-18
---

# Brief — bridge-findings output contract for review-class compositions

**One line:** give review-class `/compose` synthesis a *reusable output contract* whose REQUIRED fields force grounding during analysis — not a formatter bolted on the end.

## Problem (grounded)
`/compose` synthesis (e.g. `gecko → gygax → kranz → synthesizer`) emits freeform markdown.
Severity calibration, `file:line` grounding, and observed-vs-claimed all live in the agent's
head, not the contract. Authoring echelon-core#178 the rigor was applied by hand and
unrepeatably (one over-claim trimmed at a manual grounding-check gate).

## The thing to push back on
Format ≠ rigor. Adding a construct that *formats* synthesis like Bridgebuilder buys the look
without the discipline — it dresses ungrounded findings in severity tags they never earned.
Bridgebuilder's rigor comes from the format being a **contract that forces content**: no
finding without a severity, an anchor, a specific fix. So the proposal is an output *contract*,
not a formatting stage.

## Proposed surface (minimal net-new)
1. **Reusable `bridge-findings` `output_schema`** — inline JSON-schema object (V1-compatible:
   the emitter already validates `output_schema` and retries-on-miss, `scripts/lib/segment-emitter.py:945`,
   V1 INLINE-OBJECT-ONLY). REQUIRED `{dimension, severity, anchor, issue, recommendation}` +
   a **`claims_ledger`** (`{claim, grounding, tag: observed|claimed}`) — the load-bearing
   anti-confabulation primitive (it caught the echelon over-claim).
2. **`persona: BEAUVOIR`** on the synthesis stage (already shipped:
   `.loa/.claude/skills/bridgebuilder-review/resources/BEAUVOIR.md`).
3. **A registered `rigorous-review.yaml`** (sibling of `compositions/experimentation/tiered-code-review.yaml`);
   structured findings are SoT, a thin renderer projects the BB markdown house-style with
   `<!-- bridge-findings-start -->` markers (already parsed by `post-pr-triage.sh`).

## Risks (lead with doubt)
1. Format-without-rigor if grounding fields go optional → keep `anchor`/`severity`/`recommendation` + `claims_ledger` REQUIRED.
2. Over-application → opt-in for review/analysis-class only, never a default on all `/compose`.
3. BB's 4 dims (Security/Quality/Test/Operational) are *code* dims → `dimension` is open/per-composition vocab for non-code synthesis (correctness/completeness/risk/coherence).
4. <4000-char is a PR-comment constraint, not a brief constraint — keep findings severity-ranked.

## Open questions
- Schema location: lean `construct-compositions` shared, inline per composition until a `$ref` resolver exists.
- Converge with the Bridgebuilder TS app's findings schema (one schema for PR-review and compose-review).

## Net-new
One shared schema artifact + one registered composition + one thin renderer.

## Verified grounding (all "already shipped" claims confirmed against HEAD)
- BEAUVOIR.md present · `output_schema` validation + retry at `segment-emitter.py:927-950` (V1 inline-object-only) · `tiered-code-review.yaml` present · bridge-findings markers parsed by `post-pr-triage.sh`.
