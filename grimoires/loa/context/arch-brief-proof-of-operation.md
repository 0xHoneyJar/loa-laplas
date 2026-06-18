---
status: candidate
source_issue: 0xHoneyJar/loa-laplas#57
plane: P3-execution / P1-contract
owner: kranz (poteau/verify) + protocol
classifies_as: enhancement (needs /plan, not /bug)
ground_truth: loa-finn grimoires/loa/specs/enhance-lab-metabolism.md §"Proof-of-OPERATION — the Custodian gets teeth"
created: 2026-06-18
---

# Brief — Proof-of-OPERATION: valid_run proves the run, not the operation

**One line:** a green `valid_run` proves the *chain of stages ran* — it does **not** prove a
stage's *claimed operation* fired. One agent role-playing "FAGAN reviewed this" passes the gate
identically to a real 4-voice council (council-as-theater).

## proof-of-RUN ≠ proof-of-OPERATION

| layer | what `valid_run` checks today | the gap |
|---|---|---|
| run | manifest · segments · orchestrator · envelope chain · legba tokens | ✅ tamper-evident custody of the chain |
| operation | — *(nothing)* | ❌ did the stage's claimed op fire? (e.g. ≥2 model families on a review) |

## Problem (grounded)
`scripts/compose-verify-run.sh` is self-described "proof-of-run gate (the FIRST tooth)"; its
checks (manifest / segments / orchestrator / envelopes / `--legba`) are all envelope+custody
integrity. **None bind a stage's claim to evidence its operation ran.** `scripts/compose-dispatch.sh`
compiles a stage to a *prompted agent* (Form A: emit prompt · Form B: `claude -p`), not a
mechanical skill call (`fagan-review.sh → cheval-council.sh`) — so multi-model review is
actor-dependent. The receipt already exists and is uncaptured: `cheval-council.sh` emits a
per-voice MODELINV envelope (`.run/model-invoke.jsonl`, real `final_model_id`) + `panel:{voices, dropped[], models_ran[]}`,
fail-closed; and `.loa/tools/modelinv-coverage-audit.py` already ships. **The proof is on the floor.**

## Proposed: declare → emit → capture → verify (fail-closed)
1. **declare** — a construct/stage declares its verifiable op + receipt contract in the
   constructs design (`docs/runtime/construct-adapters.md` / `construct.yaml` capabilities):
   `verify: {operation: multimodal-review, receipt: model-invoke.jsonl, min_model_families: 2}`.
2. **emit** — the real skill emits the receipt (FAGAN already does).
3. **capture** — `compose-dispatch.sh` folds the receipt into `.run/compose/<run>/receipts/<stage>.json`,
   bound to `stage_index`+`run_id` (legba custody, like envelopes).
4. **verify** — extend `compose-verify-run.sh` (or poteau): every stage that *declared* a
   verifiable op must carry a matching receipt (≥N distinct `final_model_id`), envelope verdict
   must match. No receipt / single-model receipt → **FAIL (exit-2 deny)**.

## Why the record gate (not dispatch-policing)
You cannot forge 2 distinct provider `final_model_id`s by role-play → demanding the receipt
makes honest execution the only path to a green gate. Same move as verifying against external
ground truth instead of trusting self-report. Don't force the dispatch to shell the script
(fragile); make the gate demand the receipt.

## Acceptance (from the RFC)
- declared `multimodal-review` + no MODELINV receipt → `valid_run` FAILS
- single-model receipt on a `min_model_families: 2` stage → FAILS
- real council (≥2 distinct `final_model_id`) → PASSES; receipt in custody chain + rendered in observatory
- **generalizes**: any construct capability that declares a receipt contract is gate-checked (not FAGAN-specific)
- reuses `.loa/tools/modelinv-coverage-audit.py`; no new hash-chain primitive

## Open questions
- Receipt-contract schema location (construct.yaml capabilities vs runtime schemas).
- How non-multimodal operations declare a receipt contract.
- Receipt-capture overhead in `compose-dispatch.sh`.

## Verified grounding (confirmed against HEAD)
- `compose-verify-run.sh:3` "proof-of-run gate (the FIRST tooth)"; checks are custody-only (manifest/segments/orchestrator/envelopes/legba).
- `compose-dispatch.sh` compiles stages to prompted agents (actor-dependent).
- `.loa/tools/modelinv-coverage-audit.py` ships; reads `.run/model-invoke.jsonl`.
