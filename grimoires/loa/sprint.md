# Sprint Plan — Verifiable Compose

> **Cycle**: verifiable-compose · **PRD**: `grimoires/loa/prd.md` · **SDD**: `grimoires/loa/sdd.md`
> **Sequence**: Epic A (sprints 1–2) ships first — additive, opt-in, no run-blocking gate. Epic B (sprints 3–4) ships second — the fail-closed gate, independent. A and B share no files and can merge separately.

---

## Epic A — bridge-findings output contract (MVP)

### sprint-1: rigorous-review composition + inline bridge-findings schema

**Sprint Goal**: A registered `rigorous-review` composition whose BEAUVOIR synthesis stage carries an inline `bridge-findings` `output_schema` — so a review-class synthesis mechanically cannot emit an ungrounded finding (the emitter's existing validate-and-retry enforces it).

**Deliverables**
- [ ] **Task 0 pre-check** resolved (validator recurses into array-item `required`, or emitter fix scoped in)
- [ ] `compositions/experimentation/rigorous-review.yaml` (sibling of `tiered-code-review.yaml`)
- [ ] Inline `bridge-findings` `output_schema` on the synthesis stage (per SDD §2.1)
- [ ] Integration tests proving required-field enforcement + claims_ledger

**Technical Tasks**
0. **[SB3] Premise pre-check (failing-first, BEFORE anything else)** — write a test that feeds the existing emitter an `output_schema` with a *nested* array-item `required` and a payload whose array item omits that field; assert the emitter **rejects** it. If it passes (validator only checks top-level `required`), the "no emitter change" premise is FALSE → add an emitter task to make `_validated_output_schema` recurse into array items. **VC-A1/VC-A2 are hollow until this is green.**
1. **Author `rigorous-review.yaml`** — `schema_version: "1.0"`, `kind: workflow`, `inputs:[{type:Artifact,name:target,required:true}]`, a chain of N configurable analysis lenses (default: gecko → gygax → kranz) each writing Signal/Verdict, then a terminal stage `persona: BEAUVOIR` with `writes:[Artifact]` and the inline `output_schema`. File: `compositions/experimentation/rigorous-review.yaml`.
2. **Embed the bridge-findings schema** — `required:[summary,findings,claims_ledger]`; each finding `required:[dimension,severity,anchor,issue,recommendation]`; `claims_ledger` items `required:[claim,grounding,tag]` with `tag enum:[observed,claimed]`. `dimension` open vocab.
3. **Tests** (`tests/integration/rigorous-review.bats`, hermetic) — emit the composition; assert the synthesis stage's emitted `output_schema` contains the REQUIRED finding fields + the `claims_ledger` required keys; assert `workflow-syntax-check.js` stays green; assert `_assert_safe_schema_keys` accepts the schema.

**Acceptance Criteria**
- [ ] **VC-A1**: the emitted synthesis stage carries the bridge-findings `output_schema`; a synthesis payload missing `anchor`/`severity`/`recommendation` triggers the emitter's retry-on-miss (validation rejects). *(test)*
- [ ] **VC-A2**: `claims_ledger` is a REQUIRED top-level field; a ledger item missing `grounding`/`tag` fails validation. *(test)*
- [ ] **[SB2]** sprint-1 proves *structural* enforcement only (required fields present). *Grounding* (anchor resolves; observed-claim is real) is sprint-2's job — a finding with all fields but a fabricated anchor is NOT rejected until sprint-2's resolve step. Do not over-claim sprint-1.
- [ ] No emitter source change **IF Task 0 passes**; else the scoped emitter recursion fix lands here. `workflow-syntax-check.js` green; existing `form-c-dispatch.bats` suite unregressed.

### sprint-2: structured→BEAUVOIR renderer + post-pr-triage marker integration

**Sprint Goal**: A thin, deterministic renderer that projects the structured findings into the BEAUVOIR markdown house-style with `<!-- bridge-findings-start/end -->` markers — making the structured output human- and GitHub-consumable with zero net-new parser (reuses `post-pr-triage.sh`).

**Technical Tasks**
1. **Renderer** — `scripts/render-bridge-findings.{sh,py}`: structured findings JSON → BEAUVOIR markdown (summary, severity-ranked findings with anchor + recommendation, positive_callouts, the claims_ledger), wrapping the machine block in the `bridge-findings` markers. Deterministic (no time/random).
2. **Anchor-resolution step [B1]** — per SDD §2.6: resolve every `observed`-tagged finding's `anchor` against the reviewed tree (`file:line` exists / text-anchor found); a dangling `observed` anchor fails synthesis (or downgrades to `claimed`, default fail). `claimed` findings skip resolution.
3. **Marker integration test** — assert `post-pr-triage.sh` parses the rendered markers without modification.

**Acceptance Criteria**
- [ ] **VC-A3**: `rigorous-review` output renders to BEAUVOIR markdown with `bridge-findings` markers that `post-pr-triage.sh` parses unchanged. *(test)*
- [ ] **[B1]** an `observed` finding with `anchor: foo.ts:999` (no such line) fails the synthesis; a real anchor passes; a `claimed` finding skips resolution. *(test)*
- [ ] Renderer is deterministic; structured findings remain the source of truth (markdown is a projection).

---

## Epic B — proof-of-operation gate (independent, ships second)

> **Flatline-hardened** (PRD §9): Epic B grew — the receipt must be *correlated + provider-attested* (trust boundary), count distinct *families*, and separate DEGRADED from FAIL via an attempted-marker. The capture+declaration work (sprint-3) now carries the trust-boundary + normalized schema; the verifier (sprint-4) carries the family/attestation/correlation checks + a negative-test battery. If sprint-3 overflows, split the marker+capture from the attestation+correlation.

### sprint-3: receipt-contract declaration + attested, correlated capture

**Sprint Goal**: A construct can DECLARE a verifiable operation, the dispatcher emits an **operation-attempted marker** before invocation, and the **isolated MODELINV writer** captures a **normalized, provider-attested, correlated** receipt into the custody tree.

**Technical Tasks**
1. **Declaration schema** — `capabilities.verify:{operation, receipt, min_model_families}` in `construct.yaml`; document in `docs/runtime/construct-adapters.md`. Wire FAGAN as the reference. **[B6]** `min_model_families` counts FAMILIES.
2. **Normalized receipt + pinned family map** — `{provider, model_family, final_model_id, invocation_id, timestamp, compose_run_id, stage_index, stage_id, operation, envelope_hash}`; a pinned `final_model_id → model_family` table (source named, drift-guarded by a test). **[B7]**
3. **Attempted-marker** — `compose-dispatch.sh` writes `.run/compose/<run>/attempted/<stage_index>` BEFORE model invocation, independent of the receipt write. **[B3]**
4. **Attested + correlated capture** — the isolated cheval/MODELINV writer (NOT the stage) records the provider-returned `final_model_id` + `provider_response_hash`, binds `compose_run_id`/`stage_index`/`stage_id`/`operation`/`envelope_hash`, and **signs the payload with the gatekeeper Ed25519 key** (reuse `audit_emit_signed`; the stage cannot access the key). **[B2/B4/B5 + SDD B2/B3]**
5. **Isolation controls [SDD B4]** — `receipts/` + `attempted/` created `0700`/cheval-owned; atomic temp-then-rename writes; append-only / legba-chained.

**Acceptance Criteria**
- [ ] A declaring stage produces an attempted-marker + a signed, correlated `receipts/<idx>.json`; a non-declaring stage produces neither (no-op). *(test)*
- [ ] **[B5]** the receipt `sig` verifies under the gatekeeper public key; a receipt written without the key fails verification. *(test)*
- [ ] **[B7]** the `id → family` map resolves `opus`+`sonnet` to ONE family. *(test)*

### sprint-4: Check 6 proof-of-operation verifier (fail-closed) + negative-test battery

**Sprint Goal**: `compose-verify-run.sh` Check 6 demands a **correlated, attested** receipt proving **≥`min_model_families` distinct families**, with DEGRADED-vs-FAIL separated by the attempted-marker. Behind `--proof-of-operation` (default-off → default-on, mirroring `--legba`).

**Technical Tasks**
1. **Check 6** — per SDD §3.3 verdict table, **signature-verify first**: bad sig → `broken_run 3`; tamper/isolation breach → `broken_run 3`; uncorrelated → `broken_run 3`; under-family → `broken_run 3`; signed-marker∧¬receipt → `degraded_run 2`; ¬marker∧¬receipt → `broken_run 3`. Family count via the pinned map + `modelinv-coverage-audit.py`.
2. **[SB6] Unmapped-id fail-closed** — a `final_model_id` absent from the pinned map does NOT satisfy a family slot; emit a loud audit signal; document map updates as release-blocking.
3. **[SB7] Canonical `envelope_hash`** — define the hash input (canonical bytes, when captured) and verify it jointly with `compose_run_id`/`stage_index`/`stage_id`/`operation`.
4. **[SB5] Automated-driver: DEGRADED is deny** — Check-6 FAIL *or* `degraded_run` under `/run`/`/simstim`/cron → named queue `.run/compose/<run>/verify-fail.jsonl`; DEGRADED never lands a green gate. **[H6]**
5. **Negative-test battery** (`tests/integration/compose-verify-run.bats`).

**Acceptance Criteria**
- [ ] **VC-B1**: declared op, no marker + no receipt → `broken_run` exit 3. *(test)*
- [ ] **VC-B2** **[B6]**: two *same-family* ids on `min_model_families:2` → exit 3. *(test)*
- [ ] **VC-B3**: ≥2 distinct *families*, correlated + sig-valid → `valid_run` exit 0. *(test)*
- [ ] **VC-B4**: a non-FAGAN construct declaring a receipt contract is gate-checked identically. *(test)*
- [ ] **[B5/SB1] Forgery**: a receipt with two invented ids but **no valid gatekeeper signature** → exit 3. *(test)*
- [ ] **[B4] Replay**: a valid signed receipt from another run/stage copied in → exit 3 (correlation mismatch). *(test)*
- [ ] **[SB5] Marker bypass**: signed marker present + invocation aborted (no real call) → `degraded_run` / deny, NEVER `valid_run`. *(test)*
- [ ] **[SB6] Unmapped id**: a `final_model_id` not in the map cannot satisfy a family slot → exit 3 + audit signal. *(test)*
- [ ] **[B3] DEGRADED**: signed marker present, receipt absent → `degraded_run` exit 2 (deny under autonomous). *(test)*
- [ ] Back-compat: a composition declaring no verify op → Check 6 no-op; verdict unchanged. *(test)*

---

## Success Criteria (cycle)

- Epic A: a review-class composition cannot emit an ungrounded finding — *structural* enforcement (sprint-1, **conditional on the Task-0 nested-required premise**) + *grounding* via anchor resolution (sprint-2); renders to the BEAUVOIR house-style.
- Epic B: `valid_run` fails unless a declared multimodal op carries a **gatekeeper-signed**, correlated receipt proving ≥`min_model_families` distinct families (unmapped ids fail closed); DEGRADED is a deny, not a bypass; generalizes beyond FAGAN; reuses existing MODELINV + legba Ed25519 — **no new hash-chain primitive**.
- Every sprint lands with failing-first integration tests; `workflow-syntax-check.js` and the existing `form-c-dispatch.bats` / `compose-verify-run.bats` suites stay green.

## Sequencing & Dependencies
- **A → B**. A has no dependency on B. B depends only on existing infra (`cheval-council.sh` MODELINV emission, `modelinv-coverage-audit.py`, legba custody).
- Each sprint is independently mergeable. Start: **sprint-1**.
