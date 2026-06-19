# Product Requirements Document — Verifiable Compose

> **Cycle**: verifiable-compose · **Repo**: loa-laplas (construct-rooms-substrate) · **Date**: 2026-06-18
> **Predecessor (archived)**: `grimoires/loa/cycles/decompose-bridge/` — auto-decomposition + parallel fan-out, sprint-4 COMPLETE.
> **Runtime scope**: the CURRENT Form C compose runtime (`scripts/lib/segment-emitter.py`, `scripts/compose-dispatch.sh`, `scripts/compose-verify-run.sh`) on main. `finn` executor is OUT of scope.
> **Sources**: `grimoires/loa/context/arch-brief-bridge-findings-contract.md` (Epic A · RFC #56); `grimoires/loa/context/arch-brief-proof-of-operation.md` (Epic B · RFC #57); operator discovery decisions (2026-06-18: one PRD / two epics / A→B sequence); verified HEAD facts cited inline. Both epics are ENHANCEMENTS crystallized from RFCs (no observed-failure; they add capability) — NOT bug work.
> **Hardened by Flatline** (claude-headless + codex-headless live; gemini down — see loa#1089; 2026-06-18, 90% agreement): 7 blockers + 7 high-consensus integrated. Load-bearing: Epic B's receipt is only un-forgeable with a specified **trust boundary** (§4 FR-B5) — the original "≥N distinct `final_model_id` under legba custody" is necessary but not sufficient. Full traceability: §9.

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
  - **[Flatline B1/H4] Schema presence ≠ grounding.** The schema only enforces a *non-empty* `anchor` — `anchor: foo.ts:999` passes identically to a real reference, which is the exact "format ≠ rigor" sin Epic A exists to prevent. So: (a) `anchor`/`grounding` carry non-empty *format* constraints (not just non-empty strings), and (b) a **post-validation resolve step** for every `observed`-tagged finding asserts the `anchor` points to an existing path/line in the reviewed tree, **failing the synthesis on a dangling anchor**. Presence is checked by the schema; *truth* is checked by the resolve step. Where resolution is impossible (non-file synthesis), the finding must be tagged `claimed`, not `observed`.
- **FR-A2** — `persona: BEAUVOIR` on the synthesis stage (already shipped: `.loa/.claude/skills/bridgebuilder-review/resources/BEAUVOIR.md`).
- **FR-A3** — A registered `rigorous-review.yaml` composition + a thin renderer projecting structured findings into BEAUVOIR markdown with the `bridge-findings` markers. Structured findings are the source of truth; the markdown is a projection.

### Epic B — operation-side proof (#57)
> **Flatline-hardened.** The original spec ("≥N distinct `final_model_id` under legba custody") is necessary but not sufficient: a receipt is only un-forgeable if its **trust boundary** (who writes it, isolated from the verified stage) and its **family semantics** (distinct families, not ids) are specified. The four CRITICAL/HIGH blockers below are now first-class requirements.
- **FR-B1** — A construct/stage declares its verifiable operation + receipt contract in `construct.yaml` capabilities / `docs/runtime/construct-adapters.md`: `verify:{operation, receipt, min_model_families}`. **[B6/B7]** The threshold counts **distinct model FAMILIES, not distinct `final_model_id`s** (`opus`+`sonnet` are two ids but one family; `gpt-5.2`+`gpt-5.2-mini` likewise). The receipt is a **normalized schema** — `{provider, model_family, final_model_id, invocation_id, timestamp}` — with a deterministic, **pinned `final_model_id → family` mapping** (the pin source is named so it can't silently change) and fixtures for aliases, provider gateways, repeated same-family models, and renamed models.
  - **[SB6] Unmapped ids fail CLOSED.** A `final_model_id` not in the pinned map MUST NOT satisfy a family slot — it resolves to no family (never `null`/`unknown`-that-counts), emits a **loud audit signal**, and a stage that needs it to reach `min_model_families` **FAILS**. A new provider model is a *release-blocking* map update, not a silent pass. (The "drift-guard test" only checks the table against itself; it cannot see a production model the map has never heard of — so the *runtime* must fail-closed, not just the test.)
- **FR-B2** — `compose-dispatch.sh` captures the receipt into `.run/compose/<run>/receipts/<stage_index>.json`. **[B4] Correlation is mandatory**: each captured record carries `compose_run_id`, `stage_index`, `stage_id`, `operation`, and the stage's envelope/segment hash; verification **rejects any receipt lacking an exact correlation match** (defeats cross-stage / cross-run replay). **[B2] Tamper-evidence**: the receipt is bound to the envelope hash and rides the legba chain, so a post-hoc edit breaks custody.
- **FR-B5 (load-bearing trust boundary — Flatline B5 + SDD B2/B3, CRITICAL)** — `final_model_id` MUST be **provider-attested by a verifier-checkable cryptographic artifact**, not merely written by an isolated process. *Write-time isolation is necessary but NOT sufficient*: Check 6 runs **post-hoc on a file on disk**, and the named threat actor — "a stage that can write the receipt path" — can write a *well-formed* "attested" receipt too. So the receipt MUST carry one of: **(a)** an **Ed25519 signature** over the record by the isolated MODELINV writer, using the gatekeeper key the verified stage cannot access (reuses the existing legba / audit-chain Ed25519 infra — no new primitive); or **(b)** the **provider-returned response-id + a hash of the raw provider response**, cross-checked by the verifier against the legba-chained envelope. Check 6 **verifies the signature/hash**; a hand-written receipt fails. Isolation gives write-time separation; the signature/hash gives **verify-time checkability** — both are required. **Negative tests REQUIRED**: forged (unsigned / wrong-key) receipt, replayed receipt, mismatched-run, mismatched-stage, two-same-family ids.
- **FR-B3** — `compose-verify-run.sh` (or poteau) gains the fail-closed **proof-of-operation** check: every stage that *declared* a verifiable op must carry a **correlated, attested** receipt proving **≥`min_model_families` distinct families** ran, and the envelope verdict must match. **[B3] DEGRADED vs FAIL is mechanically defined** by a positive **operation-attempted marker** emitted *before* model invocation.
  - **[SB5] The marker cannot be the bypass.** It must be written by the **isolated writer** (same boundary as the receipt) and **co-signed / pre-recorded** — NOT by the gated `compose-dispatch.sh` alone, or a caller would write the marker, abort the real invocation, and downgrade a hard FAIL to a soft DEGRADED. An unsigned/uncorrelated marker is treated as **absent**. And **DEGRADED is deny, not pass** under autonomous drivers (FR-B4): it never lands a green gate.
  | attempted-marker (isolated, signed) | receipt | verdict |
  |---|---|---|
  | absent / unsigned | absent | **FAIL** (`broken_run` 3) — operation never ran |
  | present, signed | absent / incomplete | **DEGRADED** (`degraded_run` 2) — attempted, capture failed; *deny under autonomous drivers* |
  | present, signed | present, sig invalid / < min families | **FAIL** (`broken_run` 3) |
  | present, signed | present, ≥ min families, correlated + sig-valid | **PASS** (`valid_run` 0) |
  - Negative test: marker-present + invocation-aborted (no real multi-model call) MUST NOT reach a passing gate (it lands DEGRADED→deny, never PASS).
- **FR-B4** — Automated-driver counterpart: a proof-of-operation FAIL **or DEGRADED** under `/run`/`/simstim`/cron surfaces a **non-deadlocking handoff** to a **named** queue (`.run/compose/<run>/verify-fail.jsonl`, same shape as `.run/bridge-pending-bugs.jsonl`), never a blocking prompt and never a silent pass. **[H6]** The queue path, record schema, and handoff primitive are specified — no ad-hoc append.

---

## 5. Technical & Non-Functional

- **A reuses, doesn't build — CONDITIONAL on a verified premise [SB3]**: FR-A1 claims no emitter change because the emitter already validates `output_schema` + retries-on-miss (`segment-emitter.py:945`). But `bridge-findings` puts `required` *inside array items* (`findings[].required`, `claims_ledger[].required`), and a schema-lite validator may enforce only *top-level* `required`. **If the validator does not recurse into array-item `required`, VC-A1/VC-A2 are hollow** (a finding missing `anchor` passes silently) and "no emitter change" is FALSE. So sprint-1 opens with a **failing-first test proving the existing validator rejects an array item missing a nested required field**; if it doesn't, an emitter fix enters scope. `claims_ledger` is already produced by the echelon synthesizer; the markers are already parsed by `post-pr-triage.sh`.
- **B reuses, doesn't build**: MODELINV receipts already exist (`cheval-council.sh` → `.run/model-invoke.jsonl`, real `final_model_id`); the audit tooling already ships (`.loa/tools/modelinv-coverage-audit.py`). No new hash-chain primitive — the attestation (FR-B5) reuses provider-returned ids + the isolated MODELINV emitter + the existing legba custody chain, not a new primitive.
- **Forcing-function discipline (Flatline-qualified)**: the gate demands the *receipt*, it does not police the *dispatch* (which would be fragile). **[B5]** This holds ONLY when `final_model_id` is provider-attested by an isolated writer (FR-B5): two distinct provider *families* cannot be role-played, but a *self-written* log line can be. So the forcing function is "honest execution is the only path to a **correlated, attested** receipt" — not merely "the only path to a receipt."
- **[H7] Bounded retry-on-miss**: Epic A's emitter retry-on-miss must be bounded and **fail-closed** — on exhaustion the synthesis fails (or emits an explicitly `partial` result), never an ungrounded finding that silently satisfies the schema.
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
| A fail-closed gate blocks a *legitimate* run (flaky receipt capture) | B | **[B3]** DEGRADED vs FAIL is mechanically separated by the operation-attempted marker (FR-B3 table); FR-B4 non-deadlocking automated path; explicit deny reason. |
| **Receipt forgery (CRITICAL — the naive claim was wrong)** | B | **[B5]** `final_model_id` is self-reported in a log line; "two ids can't be role-played" is false if the stage can write the receipt. Mitigation is FR-B5: provider-attested ids + an isolated writer the verified stage cannot author. The trust-boundary separation, not custody, is the security property. |
| Same-family ids satisfy a 2-voice declaration | B | **[B6/B7]** Count distinct *families*, not ids; pinned `final_model_id → family` mapping; fixtures for aliases/gateways/renames. |
| Receipt not correlated to the stage it claims to prove | B | **[B4]** Require `compose_run_id`/`stage_index`/`stage_id`/`operation`/envelope-hash on every record; reject on correlation miss (defeats replay). |
| Anchor present but fabricated | A | **[B1]** Post-validation resolve step fails synthesis on a dangling `observed` anchor; presence ≠ truth. |
| Scope creep of "verifiable operation" | B | Ship the scaffold + `multimodal-review` as the one reference op; generalize later. |
| **Dependency**: B leans on `cheval-council.sh` MODELINV emission staying stable | B | Pin the normalized receipt contract (FR-B1) + the provider-returned id surface (FR-B5); coverage check via `modelinv-coverage-audit.py`. |
| **Dependency**: A's `$ref` resolution | A | V1 is inline-object-only; reference the schema inline per composition until a `$ref` resolver exists. |

---

## 8. Provenance & Ratification

- Epic A ratification path: the-weaver authors the `bridge-findings` schema + BEAUVOIR synthesis-stage wiring → register `rigorous-review.yaml` → no emitter change (inline-object `output_schema` already enforced) → operator ratifies.
- Epic B ratification path: declare the receipt contract in construct capabilities → confirm FAGAN emits it (already does) → add capture in `compose-dispatch.sh` → add the fail-closed check in `compose-verify-run.sh` → operator ratifies.
- Both briefs' "already shipped" claims were verified against HEAD during crystallization (2026-06-18). Source RFCs: 0xHoneyJar/loa-laplas#56, #57.

> **Next**: `/architect` (SDD) — recommend splitting into two design tracks (A: the-weaver; B: kranz/poteau) under this shared PRD, then `/sprint-plan` Epic A first.

---

## 9. Hardening Traceability (Flatline 2026-06-18)

Multi-model review (claude-headless + codex-headless live, gemini down → loa#1089; 90% agreement; full per-finding record at `grimoires/loa/a2a/flatline/prd-final_consensus.json`). 7 blockers + 7 high-consensus integrated; 1 disputed deferred.

| ID | Sev | Finding | Integrated into |
|----|-----|---------|-----------------|
| B5 | CRIT | `final_model_id` is self-reported; the gate is forgeable without a trust boundary | **FR-B5** (new), §5 forcing-function, §7 risk |
| B2 | CRIT | No integrity controls for receipt creation/storage/tamper | FR-B2 (tamper-evidence), FR-B5 |
| B3 | CRIT | DEGRADED-vs-FAIL named but never mechanically defined | FR-B3 (operation-attempted marker + verdict table) |
| B4 | HIGH | Global `model-invoke.jsonl` → per-stage receipt correlation undefined | FR-B2 (mandatory correlation fields + reject-on-miss) |
| B6 | HIGH | `min_model_families` vs distinct `final_model_id` contradict | FR-B1 (families, not ids) |
| B7 | HIGH | Receipt fields underspecified for family extraction | FR-B1 (normalized schema + pinned id→family map + fixtures) |
| B1 | HIGH | Epic A `anchor` required but never resolved (presence ≠ grounding) | FR-A1 (post-validation resolve step) |
| H1–H7 | — | family-vs-id semantics, receipt-replay tests, DEGRADED testability, non-empty grounding format, marker parse-back, named FR-B4 queue, bounded fail-closed retry | folded into the FRs above |
| IMP-011 | DISPUTED | sequencing-vs-dependency wording (low urgency) | deferred — §6 already states independence + A→B sequence |

### Round 2 (re-review of the hardened SDD + sprint, 2026-06-18)

SDD: 4 blockers (81% agreement) · sprint: 7 blockers (100% agreement). Convergence: round-1's 7 → the same security question pushed deeper, plus new attack surface.

| ID | Sev | Finding | Integrated into |
|----|-----|---------|-----------------|
| SDD B2/B3, SB1/SB4 | CRIT | "isolated writer" is not *verify-time checkable* — the verifier reads a file post-hoc | **Ed25519-signed receipt** (gatekeeper key, reuses legba) verified first in Check 6: PRD FR-B5, SDD §3.2/§3.3/§5 |
| SDD B1 | HIGH | DEGRADED verdict had no taxonomy slot | `degraded_run` @ exit 2 (retryable-deny): SDD §3.4/§8 |
| SDD B4 | HIGH | isolation under-specified | `0700` dirs, atomic writes, legba append-only: SDD §3.2/§5 |
| SB3 | CRIT | "no emitter change" hollow if validator ignores nested array-item `required` | sprint-1 **Task 0 failing-first pre-check**; PRD §5 conditional |
| SB5 | CRIT | the attempted-marker (written by the gated dispatcher) can downgrade FAIL→DEGRADED | marker must be **isolated + signed**; DEGRADED is **deny** under autonomous drivers: PRD FR-B3/B4, sprint-4 |
| SB6 | CRIT | pinned family map fails OPEN on unmapped ids | **fail-closed** unmapped id + loud audit + release-blocking map update: PRD FR-B1, sprint-4 |
| SB7 | HIGH | `envelope_hash` undefined | canonical hash input + joint correlation check: sprint-4 |
| SB2 | HIGH | Epic A sprint-1 over-claims grounding | narrowed to *structural* enforcement; grounding is sprint-2: sprint-1 |

**Net design change (round 2)**: Epic B's attestation is now a **verifier-checkable Ed25519 signature** (not just an isolated writer); DEGRADED can't be a bypass; the family map fails closed; Epic A's "no emitter change" is a *verified premise*, not an assumption. Two rounds in, the blockers are deepening into one coherent crypto-attestation design rather than multiplying — a natural point to either run a round 3 or proceed to implementation, where the failing-first tests prove the premises.

---

**Net design change (round 1)**: Epic B is no longer "demand a receipt"; it is "demand a *correlated, provider-attested* receipt written by an isolated party, proving distinct model *families*." Epic A gains a resolve step so its own anchors are grounded, not merely present.
