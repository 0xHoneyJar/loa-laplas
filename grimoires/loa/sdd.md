# Software Design Document — Verifiable Compose

> **Cycle**: verifiable-compose · **Repo**: loa-laplas · **Date**: 2026-06-18
> **PRD**: `grimoires/loa/prd.md` · **Briefs**: `grimoires/loa/context/arch-brief-bridge-findings-contract.md` (#56), `arch-brief-proof-of-operation.md` (#57)
> **Design principle**: *a compose stage's claim must carry checkable evidence.* Two tracks under one principle — Epic A makes the **output** checkable (format forces content); Epic B makes the **operation** checkable (record-gate forces honesty). They share no code; they ship independently, A first.

---

## 1. Architecture Overview

The Form C compose runtime today has three relevant surfaces:

| Surface | File | Role |
|---------|------|------|
| Segment emitter | `scripts/lib/segment-emitter.py` | compiles a composition stage → an emitted `.workflow.js` agent prompt; already validates a stage's `output_schema` and retries-on-miss (`:945`, V1 INLINE-OBJECT-ONLY) |
| Dispatcher | `scripts/compose-dispatch.sh` | drives the run; writes the manifest, room packets, envelopes; folds per-stage state into `.run/compose/<run>/` |
| Verifier | `scripts/compose-verify-run.sh` | the "proof-of-run gate (FIRST tooth)" — Checks 1–5 (manifest/segments/orchestrator/envelopes/`--legba`), all custody integrity; verdicts `valid_run` (exit 0) / `compiled_run` (exit 2) / `broken_run` (exit 3) via `_verdict` |

**Epic A** adds an *output contract* on top of the emitter's existing schema enforcement — no emitter change. **Epic B** adds a *Check 6* to the verifier plus receipt capture in the dispatcher. Neither touches the other's surface.

```
Epic A (output-side)            Epic B (operation-side)
 bridge-findings schema          construct.yaml: verify:{op,receipt,min_model_families}
   │ (output_schema, reused)        │ declare
   ▼                                ▼
 BEAUVOIR synthesis stage        skill emits MODELINV receipt (cheval-council.sh, exists)
   │                                │ emit
   ▼                                ▼
 rigorous-review.yaml            compose-dispatch.sh → .run/compose/<run>/receipts/<stage>.json
   │ → thin renderer                │ capture (legba custody)
   ▼                                ▼
 BEAUVOIR markdown + markers     compose-verify-run.sh Check 6 (fail-closed)
 (post-pr-triage.sh parses)        no/under-min receipt → broken_run (exit 3)
```

---

## 2. Epic A — bridge-findings output contract (owner: the-weaver / BEAUVOIR)

### 2.1 The schema artifact
A reusable inline JSON-schema **object** (V1 requires `type: object` with named properties; `$ref` is not yet resolvable, so it is referenced inline per composition until a resolver exists).

```yaml
output_schema:
  type: object
  required: [summary, findings, claims_ledger]
  properties:
    summary: {type: string}
    findings:
      type: array
      items:
        type: object
        required: [dimension, severity, anchor, issue, recommendation]   # REQUIRED forces grounding
        properties:
          dimension:      {type: string}                                  # OPEN vocab (code dims OR correctness/completeness/risk/coherence)
          severity:       {type: string, enum: [critical, high, medium, low]}
          anchor:         {type: string}                                  # text anchor or file:line, never a bare line number
          issue:          {type: string}
          recommendation: {type: string}
          decision_trail:    {type: string}    # optional
          industry_parallel: {type: string}    # optional
          metaphor:          {type: string}    # optional
    positive_callouts: {type: array, items: {type: string}}
    claims_ledger:                              # anti-confabulation primitive
      type: array
      items:
        type: object
        required: [claim, grounding, tag]
        properties:
          claim:     {type: string}
          grounding: {type: string}
          tag:       {type: string, enum: [observed, claimed]}
```

The REQUIRED fields are the design: the emitter's existing `_validated_output_schema` + retry-on-miss (`segment-emitter.py:945`) makes them mechanically unskippable. `_assert_safe_schema_keys` (`:927`) already guards the keys.

### 2.2 BEAUVOIR synthesis stage
The final synthesis stage carries `persona: BEAUVOIR` (already shipped at `.loa/.claude/skills/bridgebuilder-review/resources/BEAUVOIR.md`) and the `output_schema` above, so the "generous and rigorous" dimensions are demanded *during* analysis, not at a final render.

### 2.3 `rigorous-review.yaml` composition
A sibling of `compositions/experimentation/tiered-code-review.yaml`, same shape (`schema_version`/`kind: workflow`/`name`/`intent`/`inputs[]`/`chain[]`):
```
chain:
  - N analysis lenses (configurable: gecko / gygax / kranz / fagan / domain constructs) → each writes Signal/Verdict
  - terminal synthesis stage: persona BEAUVOIR, output_schema: <bridge-findings>, writes a structured Artifact
```

### 2.4 The renderer
A thin, deterministic renderer projects the structured findings into the BEAUVOIR markdown house-style, wrapping the machine block in `<!-- bridge-findings-start -->` / `<!-- bridge-findings-end -->` (already parsed by `post-pr-triage.sh` — zero net-new consumer code).

### 2.5 No emitter change
Because the schema is an inline object, the emitter path (`_validated_output_schema`, validate-and-retry) handles it as-is. Epic A's net-new is exactly: the schema artifact, the registered composition, the renderer, and the anchor-resolution step (§2.6).

### 2.6 Anchor resolution — presence ≠ grounding (PRD FR-A1 / Flatline B1)
The `output_schema` proves a finding *has* an `anchor`; it cannot prove the anchor is *real* (`anchor: foo.ts:999` validates identically to a true reference). A post-validation step in the renderer/consumer path resolves every `observed`-tagged finding's `anchor` against the reviewed tree:
- `file:line` form → the path must exist and have that line; a text-anchor → the quoted text must be found in the cited file.
- A dangling `observed` anchor **fails the synthesis** (or downgrades the finding to `claimed` with a logged reason — composition-configurable, default fail).
- Non-file synthesis (strategy/research) tags findings `claimed`, which skip resolution — so the step never forces a code lens onto non-code work.
- **[Flatline H7]** The emitter's retry-on-miss is bounded; on exhaustion the synthesis fails or emits an explicitly `partial` result, never an ungrounded finding that satisfies the schema by accident.

---

## 3. Epic B — proof-of-operation gate (owner: kranz / poteau + protocol)

### 3.1 Receipt-contract declaration (PRD FR-B1)
A construct/stage declares its verifiable operation in `construct.yaml` capabilities (mirrored in `docs/runtime/construct-adapters.md`):
```yaml
capabilities:
  verify:
    operation: multimodal-review
    receipt: model-invoke.jsonl
    min_model_families: 2          # FAMILIES, not final_model_ids (Flatline B6)
```
**Normalized receipt schema (Flatline B7).** Each receipt record is `{provider, model_family, final_model_id, invocation_id, timestamp, compose_run_id, stage_index, stage_id, operation, envelope_hash}`. The `final_model_id → model_family` map is a **pinned table** (its source named in `docs/runtime/construct-adapters.md`, drift-guarded by a test) so `opus`+`sonnet` resolve to one family and a 2-family declaration cannot be satisfied by two same-family models. Fixtures cover aliases, provider gateways, repeated same-family models, and renamed models.

### 3.2 Receipt capture (dispatcher, PRD FR-B2 / FR-B5)
`compose-dispatch.sh` folds the receipt into the custody tree at `.run/compose/<run_id>/receipts/<stage_index>.json`. Four properties the original "copy-with-binding" glossed over:
- **Isolated writer (FR-B5).** The receipt is written by the **cheval / MODELINV emitter** — the same isolated process that issues the provider calls and reads back the provider-returned id — **not** by the stage prompt/agent under verification. `final_model_id` is the *provider-returned* id, not a string the stage chose.
- **Verifier-checkable attestation (SDD B2/B3 — the load-bearing addition).** Write-time isolation alone is *not verifiable post-hoc*: Check 6 reads a file, and the threat actor (a stage that can write the receipt path) can write a well-formed receipt too. So each record carries a **detached Ed25519 signature** (`receipt.sig`) produced by the isolated writer with the **gatekeeper key the stage cannot access** — the SAME key/infra legba already uses for the audit chain (`audit_emit_signed`; no new primitive). The signed payload binds `{provider, model_family, final_model_id, invocation_id, provider_response_hash, compose_run_id, stage_index, stage_id, operation, envelope_hash}`. Optionally (provider permitting) the record also carries the **provider-returned response-id + `provider_response_hash`** for an independent cross-check. The distinction that makes the gate real: a forged receipt can copy field *values* but cannot produce a signature that verifies under the gatekeeper public key.
- **Mandatory correlation (FR-B2 / B4).** The signed payload binds `compose_run_id` + `stage_index` + `stage_id` + `operation` + `envelope_hash`. A receipt that does not correlate exactly to the stage it claims to prove is rejected (defeats cross-stage / cross-run replay).
- **Isolation controls (SDD B4).** `.run/compose/<run>/receipts/` and `…/attempted/` are created `0700`, owned by the cheval process; writes are **atomic** (temp-file + `rename`); records are **append-only / hash-chained** under legba so a stage cannot rewrite a marker or receipt before verification. Check 6 treats a receipt whose ownership/mode is wrong, or whose signature/chain fails, as `broken_run` (not a pass).

### 3.3 Check 6 — proof-of-operation (verifier, fail-closed; PRD FR-B3)
A new check in `compose-verify-run.sh`, sibling to Checks 1–5, gated behind `--proof-of-operation` (default-off → default-on once stable, mirroring `--legba`). The **operation-attempted marker** (`.run/compose/<run>/attempted/<stage_index>` — written by the dispatcher *before* model invocation, independent of the receipt write) is what separates "infra flake" from "operation never ran":
```
for each stage S in the manifest that DECLARED verify.operation:
    marker  = .run/compose/<run>/attempted/<S.index>          # emitted pre-invocation
    receipt = .run/compose/<run>/receipts/<S.index>.json
    if marker absent  and receipt absent → _verdict broken_run 3   "stage S <op>: operation never ran"        # FAIL
    if marker present and receipt absent → _verdict degraded_run 2 "stage S <op>: attempted, capture failed"  # DEGRADED (retryable deny)
    # receipt present → validate it, IN THIS ORDER (cheapest-fail-first):
    if receipt.sig does NOT verify under the gatekeeper public key → broken_run 3 "receipt signature invalid"          # FR-B5 — THE check
    if receipt dir ownership/mode wrong OR legba chain broken      → broken_run 3 "receipt tamper / isolation breach"  # SDD B4
    if signed payload does NOT correlate (compose_run_id/stage_index/stage_id/envelope_hash) → broken_run 3 "correlation mismatch"  # FR-B2/B4
    if provider_response_hash present AND ≠ envelope's recorded hash → broken_run 3 "provider-response cross-check failed"
    families = distinct model_family over the receipt (pinned id→family map)            # FR-B1/B6/B7
    if families < S.min_model_families                           → broken_run 3 "<families> family/families < required <min>"
    if envelope.verdict ≠ receipt.verdict                       → broken_run 3 "verdict/receipt mismatch"
```
The signature check is the load-bearing one: it is what the verifier *can* check post-hoc (SDD B2/B3) — a hand-written receipt copies values but cannot forge a gatekeeper-key signature. Reuses `.loa/tools/modelinv-coverage-audit.py` for per-family extraction and the **existing legba Ed25519 infra** (`audit_emit_signed` / `legba verify`) for the signature — **no new hash-chain primitive**.

### 3.4 Verdict semantics (PRD FR-B3 table; DEGRADED taxonomy resolved — SDD B1)
The existing taxonomy is `valid_run`(0) / `compiled_run`(2) / `broken_run`(3). DEGRADED slots in as a **new verdict string `degraded_run` at exit 2** — the "not proven, *retryable*" deny class (sibling of `compiled_run`), distinct from `broken_run`(3) "integrity-broken / forged". Both are non-zero (never a pass). `_verdict` gains the `degraded_run` string + a `degraded: true` JSON flag so downstream automation branches deterministically; every consumer that switches on the verdict adds a `degraded_run` arm (treated as a retryable deny, not a hard stop).

| attempted-marker | receipt | verdict | exit |
|---|---|---|---|
| absent | absent | `broken_run` — operation never ran | 3 |
| present | absent / unreadable | **`degraded_run`** — attempted, capture failed (retryable; *not* a forged pass) | 2 |
| present | signature invalid / tampered / uncorrelated | `broken_run` — forged or replayed | 3 |
| present | valid sig, < min families | `broken_run` — under-family | 3 |
| present | valid sig, ≥ min families, correlated | `valid_run` | 0 |

A stage that declares **no** verifiable op is unaffected (Check 6 is a no-op) — fully back-compatible. `degraded_run` is never folded into `valid_run`, so a flaky capture neither silently blocks a legitimate run nor passes a missing operation.

### 3.5 Automated-driver non-deadlock path (carried from decompose-bridge)
Under `/run`, `/simstim`, or cron, a Check-6 FAIL surfaces a **non-deadlocking handoff** (queued to the run-mode failure channel / `.run/bridge-pending-bugs.jsonl`-style), never a blocking prompt. The gate denies the run; it does not hang the automated driver.

### 3.6 Forcing function (why record-gate, not dispatch-policing — Flatline-qualified)
Demanding the receipt (not policing the dispatch) is robust — but the forcing function only bites when the receipt is **provider-attested by an isolated writer** (§3.2 / FR-B5). A *self-written* log line with two invented `final_model_id` strings is trivially forgeable; two distinct provider *families*, captured from real provider responses by a writer the stage cannot author, are not. So the precise property is: "honest multi-family execution is the only path to a **correlated, attested** receipt." The verifier demands that evidence (robust); it never forces the dispatcher to shell a specific script (fragile).

---

## 4. Data Models

| Artifact | Shape | Lives at |
|----------|-------|----------|
| `bridge-findings` schema | inline JSON-schema object (§2.1) | `construct-compositions` shared schema, inlined per composition (V1) |
| receipt (normalized + signed) | `{provider, model_family, final_model_id, invocation_id, provider_response_hash, timestamp, compose_run_id, stage_index, stage_id, operation, envelope_hash, verdict}` + detached `sig` (Ed25519 over the payload) | `.run/compose/<run>/receipts/<stage>.json` (`0700` dir, atomic write, legba-chained) |
| gatekeeper signing key | Ed25519; the existing legba/audit-chain key, isolated from stage sandboxes | legba key store (reused; SDD §8 Q5 on rotation) |
| operation-attempted marker | empty/stamp file per stage, written pre-invocation by the isolated writer | `.run/compose/<run>/attempted/<stage_index>` |
| `final_model_id → model_family` map | pinned table, drift-guarded | `docs/runtime/construct-adapters.md` (source named) |
| verify declaration | `capabilities.verify:{operation, receipt, min_model_families}` | each construct's `construct.yaml` |

---

## 5. Security Architecture

- **Schema-key safety (A)**: `bridge-findings` keys pass `_assert_safe_schema_keys` (`segment-emitter.py:927`) — no unsafe interpolation into emitted JS.
- **Anchor grounding (A — Flatline B1)**: schema *presence* of `anchor` is not grounding. A post-validation resolve step (§2.6) fails the synthesis when an `observed`-tagged finding's `anchor` does not resolve to a real path/line, so the contract proves *truth*, not just non-emptiness.
- **Receipt trust boundary (B — Flatline B5 + SDD B2/B3, the load-bearing property)**: unforgeability is NOT "cost to forge two `final_model_id` strings" (those are self-reportable). It is **writer–subject separation made verify-time checkable**. Write-time isolation alone fails the threat model — the verifier reads a file post-hoc, and the threat actor (a stage that can write the receipt path) can write a well-formed receipt. The control is therefore a **detached Ed25519 signature** over the receipt by the isolated MODELINV writer, under the **gatekeeper key the stage cannot access** (the existing legba/audit-chain key — no new primitive); Check 6 verifies the signature first. A forged receipt copies field values but cannot produce a valid signature. Plus correlation binding (`compose_run_id`/`stage_index`/`envelope_hash`), `0700`-owned receipt dirs, atomic writes, and an append-only legba chain so markers/receipts cannot be rewritten pre-verification. Negative tests are first-class (unsigned/wrong-key, replayed, mismatched-run/stage, tampered, two-same-family).
- **Family counting (B — Flatline B6/B7)**: the gate counts distinct *families* via the pinned `final_model_id → model_family` map, never raw ids, so two same-family models cannot satisfy a 2-family declaration.
- **Fail-closed + DEGRADED (B — Flatline B3)**: absence of *both* marker and receipt = FAIL; marker-without-receipt = DEGRADED (distinct non-zero verdict, never folded into `valid_run`). The conservative-by-default discipline in `compose-verify-run.sh` (only exit 0 passes — `:406`) is preserved and extended.
- **Custody binding (B)**: receipts are bound to `compose_run_id`/`stage_index`/`stage_id`/`envelope_hash` and ride the legba chain, so a receipt cannot be replayed from another run/stage without breaking custody or failing the correlation check.

---

## 6. Testing Strategy

Mirror the existing hermetic bats harness (`tests/integration/form-c-dispatch.bats`, `compose-verify-run.bats`):

**Epic A** (`tests/integration/` new or extended):
- A composition with the `bridge-findings` schema: a synthesis output missing `anchor`/`severity`/`recommendation` → emitter retry-on-miss fires (validation rejects).
- A `claims_ledger` with a `tag: observed` claim and empty `grounding` → validation fails.
- `rigorous-review.yaml` emits → `workflow-syntax-check.js` green; renderer produces `bridge-findings` markers that `post-pr-triage.sh` parses.
- **[B1] Anchor resolution**: an `observed` finding with `anchor: foo.ts:999` (no such line) → synthesis fails (or downgrades to `claimed`); a real anchor passes; a `claimed` finding skips resolution.

**Epic B** (`tests/integration/compose-verify-run.bats` extended) — the four PRD metrics **plus the Flatline negative tests** (the security property is only as good as these):
- VC-B1: declared `multimodal-review`, no marker + no receipt → `broken_run` exit 3.
- VC-B2: receipt with two *same-family* ids (e.g. `opus`+`sonnet`), `min_model_families: 2` → exit 3 (**[B6]** family count, not id count).
- VC-B3: ≥2 distinct *families*, correlated + attested → `valid_run` exit 0; receipt in custody.
- VC-B4: a non-FAGAN construct declaring a receipt contract is gate-checked identically.
- **[B5] Forgery**: a receipt hand-written with two invented `final_model_id`s but no provider attestation → exit 3 ("not provider-attested").
- **[B4] Replay**: a valid receipt from another `run_id`/`stage_index` copied in → exit 3 ("correlation mismatch").
- **[B3] DEGRADED**: marker present, receipt absent/unreadable → distinct DEGRADED verdict (non-zero, not `valid_run`); marker absent + receipt absent → FAIL.
- Back-compat: a composition declaring no verify op → Check 6 no-op, verdict unchanged.

---

## 7. Sequencing & Delivery

- **Sprint plan splits by epic.** Epic A first (additive, opt-in, no run-blocking gate — lowest blast radius, fastest win, proves the "contract forces honesty" pattern). Epic B second (the fail-closed gate, on the pattern A established).
- **Independent merges**: A and B share no files; each is its own sprint(s) and can land separately.
- **Epic B rollout mirrors `--legba`**: ship Check 6 behind a flag, default-off, promote to default-on once stable across cycles (the verifier already demonstrates this opt-in→default pattern).

---

## 8. Open Design Questions

1. **A — schema home**: `construct-compositions` shared vs `construct-rooms-substrate` runtime schemas vs `loa-hounfour`. Leaning shared-in-`construct-compositions`, inlined until a `$ref` resolver exists.
2. **B — receipt contract generality**: the scaffold must accept receipt contracts beyond `multimodal-review` (VC-B4). Ship the generic `{operation, receipt, min_*}` shape with `multimodal-review` as the reference op; defer additional operation kinds.
3. ~~**B — DEGRADED taxonomy**~~ **RESOLVED (SDD B1)**: `degraded_run` verdict string at **exit 2** (retryable-deny class, sibling of `compiled_run`) + a `degraded: true` flag; never folded into `valid_run`. Exit semantics stay 0/2/3. See §3.4.
5. **B — attestation key management (new, from SDD B2/B3)**: the gatekeeper Ed25519 key the MODELINV writer signs with must be provisioned + isolated from stage sandboxes; reuse legba's existing key handling (`audit_emit_signed`). Open: per-run vs per-host key, and rotation.
4. **A/B convergence**: whether Epic A's `bridge-findings` and the Bridgebuilder TS app's findings schema should unify (out of scope this cycle; noted).

> **Next**: `/sprint-plan` — Epic A first.
