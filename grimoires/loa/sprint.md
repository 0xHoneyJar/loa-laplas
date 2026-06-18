# Sprint Plan — Verifiable Compose

> **Cycle**: verifiable-compose · **PRD**: `grimoires/loa/prd.md` · **SDD**: `grimoires/loa/sdd.md`
> **Sequence**: Epic A (sprints 1–2) ships first — additive, opt-in, no run-blocking gate. Epic B (sprints 3–4) ships second — the fail-closed gate, independent. A and B share no files and can merge separately.

---

## Epic A — bridge-findings output contract (MVP)

### sprint-1: rigorous-review composition + inline bridge-findings schema

**Sprint Goal**: A registered `rigorous-review` composition whose BEAUVOIR synthesis stage carries an inline `bridge-findings` `output_schema` — so a review-class synthesis mechanically cannot emit an ungrounded finding (the emitter's existing validate-and-retry enforces it).

**Deliverables**
- [ ] `compositions/experimentation/rigorous-review.yaml` (sibling of `tiered-code-review.yaml`)
- [ ] Inline `bridge-findings` `output_schema` on the synthesis stage (per SDD §2.1)
- [ ] Integration tests proving required-field enforcement + claims_ledger
- [ ] No emitter change (inline-object `output_schema` already enforced at `segment-emitter.py:945`)

**Technical Tasks**
1. **Author `rigorous-review.yaml`** — `schema_version: "1.0"`, `kind: workflow`, `inputs:[{type:Artifact,name:target,required:true}]`, a chain of N configurable analysis lenses (default: gecko → gygax → kranz) each writing Signal/Verdict, then a terminal stage `persona: BEAUVOIR` with `writes:[Artifact]` and the inline `output_schema`. File: `compositions/experimentation/rigorous-review.yaml`.
2. **Embed the bridge-findings schema** — `required:[summary,findings,claims_ledger]`; each finding `required:[dimension,severity,anchor,issue,recommendation]`; `claims_ledger` items `required:[claim,grounding,tag]` with `tag enum:[observed,claimed]`. `dimension` open vocab.
3. **Tests** (`tests/integration/rigorous-review.bats`, hermetic) — emit the composition; assert the synthesis stage's emitted `output_schema` contains the REQUIRED finding fields + the `claims_ledger` required keys; assert `workflow-syntax-check.js` stays green; assert `_assert_safe_schema_keys` accepts the schema.

**Acceptance Criteria**
- [ ] **VC-A1**: the emitted synthesis stage carries the bridge-findings `output_schema`; a synthesis payload missing `anchor`/`severity`/`recommendation` triggers the emitter's retry-on-miss (validation rejects). *(test)*
- [ ] **VC-A2**: `claims_ledger` is a REQUIRED top-level field; a ledger item missing `grounding`/`tag` fails validation. *(test)*
- [ ] No emitter source change; `workflow-syntax-check.js` green; existing `form-c-dispatch.bats` suite unregressed.

### sprint-2: structured→BEAUVOIR renderer + post-pr-triage marker integration

**Sprint Goal**: A thin, deterministic renderer that projects the structured findings into the BEAUVOIR markdown house-style with `<!-- bridge-findings-start/end -->` markers — making the structured output human- and GitHub-consumable with zero net-new parser (reuses `post-pr-triage.sh`).

**Technical Tasks**
1. **Renderer** — `scripts/render-bridge-findings.{sh,py}`: structured findings JSON → BEAUVOIR markdown (summary, severity-ranked findings with anchor + recommendation, positive_callouts, the claims_ledger), wrapping the machine block in the `bridge-findings` markers. Deterministic (no time/random).
2. **Marker integration test** — assert `post-pr-triage.sh` parses the rendered markers without modification.

**Acceptance Criteria**
- [ ] **VC-A3**: `rigorous-review` output renders to BEAUVOIR markdown with `bridge-findings` markers that `post-pr-triage.sh` parses unchanged. *(test)*
- [ ] Renderer is deterministic; structured findings remain the source of truth (markdown is a projection).

---

## Epic B — proof-of-operation gate (independent, ships second)

### sprint-3: receipt-contract declaration + dispatcher capture

**Sprint Goal**: A construct can DECLARE a verifiable operation + receipt contract, and `compose-dispatch.sh` CAPTURES the emitted MODELINV receipt into the custody tree bound to `stage_index`+`run_id`.

**Technical Tasks**
1. **Declaration schema** — `capabilities.verify:{operation, receipt, min_model_families}` in `construct.yaml`; document in `docs/runtime/construct-adapters.md`. Wire FAGAN's `construct.yaml` as the reference (`operation: multimodal-review, receipt: model-invoke.jsonl, min_model_families: 2`).
2. **Capture** — `compose-dispatch.sh` folds the per-stage receipt → `.run/compose/<run>/receipts/<stage_index>.json`, bound to `stage_index`+`run_id` (mirror the envelope binding). Source receipt already emitted by `cheval-council.sh` → `.run/model-invoke.jsonl`.

**Acceptance Criteria**
- [ ] A stage whose construct declares `verify.operation` produces a captured `receipts/<idx>.json` bound to the run; a stage declaring none produces no receipt (no-op). *(test)*

### sprint-4: Check 6 proof-of-operation verifier (fail-closed) + tests

**Sprint Goal**: `compose-verify-run.sh` gains Check 6 — every stage that declared a verifiable op must carry a matching receipt (≥`min_model_families` distinct `final_model_id`), else `broken_run` (exit 3). Behind a `--proof-of-operation` flag (default-off → default-on once stable, mirroring `--legba`).

**Technical Tasks**
1. **Check 6** — per SDD §3.3: absent receipt → `_verdict broken_run 3`; under-min families → `broken_run 3`; envelope/receipt verdict mismatch → `broken_run 3`. Reuse `.loa/tools/modelinv-coverage-audit.py` for family extraction.
2. **DEGRADED vs FAIL** — receipt present-but-unreadable → distinct degraded note (capture fault), not silent pass; receipt ABSENT → always FAIL.
3. **Automated-driver non-deadlock** — under `/run`/`/simstim`/cron a Check-6 FAIL surfaces a non-deadlocking handoff, never a blocking prompt.
4. **Tests** (`tests/integration/compose-verify-run.bats` extended).

**Acceptance Criteria**
- [ ] **VC-B1**: declared `multimodal-review`, no receipt → `broken_run` exit 3. *(test)*
- [ ] **VC-B2**: single-model receipt on `min_model_families:2` → exit 3. *(test)*
- [ ] **VC-B3**: ≥2 distinct `final_model_id` → `valid_run` exit 0; receipt in custody. *(test)*
- [ ] **VC-B4**: a non-FAGAN construct declaring a receipt contract is gate-checked identically. *(test)*
- [ ] Back-compat: a composition declaring no verify op → Check 6 no-op; verdict unchanged. *(test)*

---

## Success Criteria (cycle)

- Epic A: a review-class composition cannot emit an ungrounded finding (schema-enforced) and renders to the BEAUVOIR house-style; **no emitter change**.
- Epic B: `valid_run` fails when a declared multimodal operation cannot prove ≥2 model families ran; generalizes beyond FAGAN; reuses existing MODELINV tooling; **no new hash-chain primitive**.
- Every sprint lands with failing-first integration tests; `workflow-syntax-check.js` and the existing `form-c-dispatch.bats` / `compose-verify-run.bats` suites stay green.

## Sequencing & Dependencies
- **A → B**. A has no dependency on B. B depends only on existing infra (`cheval-council.sh` MODELINV emission, `modelinv-coverage-audit.py`, legba custody).
- Each sprint is independently mergeable. Start: **sprint-1**.
