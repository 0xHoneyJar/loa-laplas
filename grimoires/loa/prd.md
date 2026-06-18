# Product Requirements Document — Verifiable Compose

> **Cycle**: verifiable-compose · **Repo**: loa-laplas (construct-rooms-substrate) · **Date**: 2026-06-18
> **Predecessor (archived)**: `grimoires/loa/cycles/decompose-bridge/` — auto-decomposition + parallel fan-out, sprint-4 COMPLETE.
> **Runtime scope**: the CURRENT Form C compose runtime (`scripts/lib/segment-emitter.py`, `scripts/compose-dispatch.sh`, `scripts/compose-verify-run.sh`) on main. `finn` executor is OUT of scope.
> **Sources**: `grimoires/loa/context/arch-brief-bridge-findings-contract.md` (Epic A · RFC #56); `grimoires/loa/context/arch-brief-proof-of-operation.md` (Epic B · RFC #57); operator discovery decisions (2026-06-18: one PRD / two epics / A→B sequence); verified HEAD facts cited inline. Both epics are ENHANCEMENTS crystallized from RFCs (no observed-failure; they add capability) — NOT bug work.

---

## 1. Problem & Vision

**Problem — claim ≠ evidence in compose.** A compose stage *claims* things, and nothing checks the claim against evidence. Two faces of one gap:

- **Output face (#56).** `/compose` review-class synthesis emits **freeform markdown**. Severity calibration, `file:line` grounding, and observed-vs-claimed all live in the agent's head, not in a contract. An ungrounded finding passes as easily as a grounded one.
  > Source: `arch-brief-bridge-findings-contract.md` ("Format ≠ rigor … the rigor comes from the format being a contract that forces content").
- **Operation face (#57).** A green `valid_run` proves the *chain of stages ran* (custody) but **not that a stage's claimed operation fired**. A single agent role-playing "FAGAN reviewed this" passes the gate identically to a real 4-voice council.
  > Source: `arch-brief-proof-of-operation.md`; verified: `scripts/compose-verify-run.sh:3` self-describes as the "proof-of-run gate (the FIRST tooth)" and its checks are custody-only (manifest/segments/orchestrator/envelopes/legba).

**Vision.** A construct is **exactly as real as the operation you can name and check.** Review-class compose stages (a) emit a structured **findings contract** whose REQUIRED fields force grounding *during analysis*, and (b) where they declare a verifiable operation, carry a **fail-closed receipt** proving the operation ran. Two mechanisms, one principle: *format-forces-content* (A) and *record-gate-forces-honesty* (B) — both are "verify against evidence, never trust self-report."

**Why now.** The compose runtime is on main and is now the substrate constructs actually run through (review compositions, the decompose-bridge fan-out). The integrity of what it *produces* (A) and what it *claims to have done* (B) is the next keystone. The receipts already exist uncaptured (#57) and the schema-validation already exists unused-for-this (#56) — this cycle wires what is already on the floor.

---

## 2. Goals & Success Metrics

> Two epics, sequenced **A → B**. A is lower-risk and additive; B is a fail-closed gate (higher blast radius). They ship independently — no cross-dependency.

**Epic A — bridge-findings output contract (owner: the-weaver / BEAUVOIR):**
| ID | Goal | Metric (testable) |
|----|------|-------------------|
| **VC-A1** | The format forces grounding | A review-class composition adopting the `bridge-findings` schema cannot emit a finding missing `{severity, anchor, recommendation}` — the emitter's existing `output_schema` validation rejects + retries-on-miss. *(verified: `scripts/lib/segment-emitter.py:945`, V1 inline-object-only)* |
| **VC-A2** | Anti-confabulation is mandatory | Every review-class synthesis carries a `claims_ledger`; each claim is tagged `observed`\|`claimed`. A required-field-missing ledger fails validation. |
| **VC-A3** | It composes, doesn't re-invent | `rigorous-review.yaml` is registered (sibling of `tiered-code-review.yaml`); output renders to the BEAUVOIR markdown house-style with `<!-- bridge-findings-start -->` markers already parsed by `post-pr-triage.sh`. |

**Epic B — proof-of-operation (owner: kranz / poteau + protocol):**
| ID | Goal | Metric (testable) |
|----|------|-------------------|
| **VC-B1** | No receipt → no green | A stage declaring `verify:{operation: multimodal-review, min_model_families: 2}` with NO MODELINV receipt → `valid_run` **FAILS** (exit-2 deny). |
| **VC-B2** | Single voice ≠ a council | A single-model receipt on a `min_model_families: 2` stage → **FAILS**. |
| **VC-B3** | Honest run passes | A real council (≥2 distinct provider `final_model_id`) → **PASSES**; the receipt is in the custody chain (legba), bound to `stage_index`+`run_id`. |
| **VC-B4** | Generalizes | Any construct capability that declares a receipt contract is gate-checked — not FAGAN-specific. Reuses `.loa/tools/modelinv-coverage-audit.py`; no new hash-chain primitive. |

---

## 3. Users & Stakeholders

- **Primary**: whoever drives a review/analysis-class `/compose` (operator or orchestrating agent) and needs the output/operation to be *trustworthy*, not just *produced*.
- **Review-class compositions** — the work shapes that adopt the contract (`rigorous-review` is the reference).
- **the-weaver (BEAUVOIR)** — Epic A owner (the findings schema + synthesis-stage persona).
- **kranz / poteau** — Epic B owner (receipt capture + the proof-of-operation gate).
- **GECKO** — standing sensor/doctor seat: surfaces declared-but-unverified operations and contract drift.
- **Automated drivers** (`/run`, `/simstim`, cron) — first-class stakeholder: a fail-closed verify (Epic B) MUST have a **non-deadlocking automated path** (carried from the decompose-bridge run-mode rule). A gate that blocks an autonomous run must emit a handoff, not hang.

---

## 4. Functional Requirements

### Epic A — output-side contract (#56)
- **FR-A1** — A reusable `bridge-findings` `output_schema` (inline JSON-schema object, V1-compatible). REQUIRED `{dimension, severity, anchor, issue, recommendation}` + a `claims_ledger` array of `{claim, grounding, tag: observed|claimed}`. `dimension` is OPEN vocab (code dims for code review; correctness/completeness/risk/coherence for non-code synthesis).
- **FR-A2** — `persona: BEAUVOIR` on the synthesis stage (already shipped: `.loa/.claude/skills/bridgebuilder-review/resources/BEAUVOIR.md`).
- **FR-A3** — A registered `rigorous-review.yaml` composition + a thin renderer projecting structured findings into BEAUVOIR markdown with the `bridge-findings` markers. Structured findings are the source of truth; the markdown is a projection.

### Epic B — operation-side proof (#57)
- **FR-B1** — A construct/stage declares its verifiable operation + receipt contract in the constructs design (`construct.yaml` capabilities / `docs/runtime/construct-adapters.md`): `verify:{operation, receipt, min_model_families}`.
- **FR-B2** — `compose-dispatch.sh` captures the emitted receipt into `.run/compose/<run>/receipts/<stage>.json`, bound to `stage_index`+`run_id` under legba custody (like envelopes).
- **FR-B3** — `compose-verify-run.sh` (or poteau) gains a fail-closed **proof-of-operation** check: every stage that *declared* a verifiable op must carry a matching receipt proving it ran (≥N distinct `final_model_id`), and the envelope verdict must match. No receipt / single-model receipt → FAIL (exit-2).
- **FR-B4** — Automated-driver counterpart: a proof-of-operation FAIL under `/run`/`/simstim`/cron surfaces a non-deadlocking handoff (queued for triage), never a blocking prompt.

---

## 5. Technical & Non-Functional

- **A reuses, doesn't build**: the emitter already validates `output_schema` and retries-on-miss (`segment-emitter.py:945`, V1 INLINE-OBJECT-ONLY), so FR-A1 needs no emitter change — only the schema artifact + the registered composition + the renderer. `claims_ledger` is already produced by the echelon synthesizer; the markers are already parsed by `post-pr-triage.sh`.
- **B reuses, doesn't build**: MODELINV receipts already exist (`cheval-council.sh` → `.run/model-invoke.jsonl`, real `final_model_id`); the audit tooling already ships (`.loa/tools/modelinv-coverage-audit.py`). No new hash-chain primitive — receipts ride the existing legba custody chain.
- **Forcing-function discipline**: the gate demands the *receipt*, it does not police the *dispatch* (which would be fragile). You cannot forge two distinct provider `final_model_id`s by role-play → demanding the receipt makes honest execution the only path to green.
- **Preserved invariants**: determinism (no `Date`/`Math.random` in emitted source), injection-safety (`js()` JSON-escaping), and the single-source preamble all hold.
- **Schema safety (security)**: `bridge-findings` schema keys pass the existing `_assert_safe_schema_keys` guard (`segment-emitter.py:927`).

---

## 6. Scope & Prioritization

- **MVP = Epic A** (output contract). Lower risk (additive, opt-in, no run-blocking gate), faster win, establishes the "contract forces honesty" pattern. Ship first.
- **Epic B** (proof-of-operation) follows. Higher leverage (the council-as-theater fix) but a fail-closed gate with real blast radius — it gets the careful second slot, on the pattern A proved.
- **Independence**: A and B touch disjoint surfaces (A: schema + composition YAML + renderer; B: `compose-verify-run.sh` + `compose-dispatch.sh` capture + `construct.yaml` capabilities). Either can ship without the other.
- **Out of scope**: converging the Bridgebuilder TS app's findings schema (future); receipt contracts for non-multimodal operations beyond the generic declare/verify scaffold (B4 ships the scaffold + multimodal-review as the reference op); the `finn` executor; any change to the decompose-bridge fan-out.

---

## 7. Risks & Dependencies

| Risk | Epic | Mitigation |
|------|------|-----------|
| Format without rigor (grounding fields optional) | A | Keep `anchor`/`severity`/`recommendation` + `claims_ledger` REQUIRED — the schema is the enforcement. |
| Over-application (a code lens on strategy work) | A | Opt-in for review/analysis class only; `dimension` is open/per-composition vocab. Never a default on all `/compose`. |
| A fail-closed gate blocks a *legitimate* run (flaky receipt capture) | B | Distinguish DEGRADED (capture failed) from FAIL (operation didn't run); FR-B4 non-deadlocking automated path; explicit deny reason. |
| Receipt forgery | B | Two distinct provider `final_model_id`s cannot be role-played — the receipt is the un-forgeable evidence. |
| Scope creep of "verifiable operation" | B | Ship the scaffold + `multimodal-review` as the one reference op; generalize later. |
| **Dependency**: B leans on `cheval-council.sh` MODELINV emission staying stable | B | Pin the receipt field contract (`final_model_id`, `panel`) in FR-B1; add a coverage check via the existing `modelinv-coverage-audit.py`. |
| **Dependency**: A's `$ref` resolution | A | V1 is inline-object-only; reference the schema inline per composition until a `$ref` resolver exists. |

---

## 8. Provenance & Ratification

- Epic A ratification path: the-weaver authors the `bridge-findings` schema + BEAUVOIR synthesis-stage wiring → register `rigorous-review.yaml` → no emitter change (inline-object `output_schema` already enforced) → operator ratifies.
- Epic B ratification path: declare the receipt contract in construct capabilities → confirm FAGAN emits it (already does) → add capture in `compose-dispatch.sh` → add the fail-closed check in `compose-verify-run.sh` → operator ratifies.
- Both briefs' "already shipped" claims were verified against HEAD during crystallization (2026-06-18). Source RFCs: 0xHoneyJar/loa-laplas#56, #57.

> **Next**: `/architect` (SDD) — recommend splitting into two design tracks (A: the-weaver; B: kranz/poteau) under this shared PRD, then `/sprint-plan` Epic A first.
