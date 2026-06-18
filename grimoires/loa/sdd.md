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
Because the schema is an inline object, the emitter path (`_validated_output_schema`, validate-and-retry) handles it as-is. Epic A's net-new is exactly: the schema artifact, the registered composition, and the renderer.

---

## 3. Epic B — proof-of-operation gate (owner: kranz / poteau + protocol)

### 3.1 Receipt-contract declaration
A construct/stage declares its verifiable operation in `construct.yaml` capabilities (and mirrored in `docs/runtime/construct-adapters.md`):
```yaml
capabilities:
  verify:
    operation: multimodal-review
    receipt: model-invoke.jsonl
    min_model_families: 2
```
This is the only authoring-time surface; everything downstream is mechanical.

### 3.2 Receipt capture (dispatcher)
`compose-dispatch.sh` folds the emitted receipt into the custody tree:
```
.run/compose/<run_id>/receipts/<stage_index>.json
```
bound to `stage_index` + `run_id` (the same binding the envelopes use). FAGAN already emits the source receipt to `.run/model-invoke.jsonl` via `cheval-council.sh` (per-voice MODELINV with real `final_model_id` + `panel:{voices,dropped[],models_ran[]}`). Capture = copy-with-binding, not generation.

### 3.3 Check 6 — proof-of-operation (verifier, fail-closed)
A new check in `compose-verify-run.sh`, sibling to Checks 1–5, gated behind a flag (e.g. `--proof-of-operation`, defaulting on once stable — mirrors how `--legba` was introduced as opt-in then promoted):
```
for each stage S in the manifest that DECLARED verify.operation:
    receipt = .run/compose/<run>/receipts/<S.index>.json
    if receipt absent            → _verdict broken_run 3 "stage S declared <op> but emitted no receipt"
    families = distinct final_model_id in receipt
    if families < S.min_model_families → _verdict broken_run 3 "stage S <op>: <families> model family/families < required <min>"
    if envelope.verdict ≠ receipt.verdict → _verdict broken_run 3 "stage S verdict/receipt mismatch"
```
Reuses `.loa/tools/modelinv-coverage-audit.py` for the family-count extraction. No new hash-chain primitive — receipts ride the existing legba custody (Check 5).

### 3.4 Verdict semantics
- **FAIL (`broken_run`, exit 3)**: a stage *declared* a verifiable op and the evidence is absent or under-min. Fail-closed: the absence of proof is a failure, not a pass.
- **DEGRADED vs FAIL distinction**: if the receipt file exists but is unreadable/corrupt (capture fault, not an operation fault), emit a distinct degraded note so a flaky capture is not misread as a forged operation. (A receipt that is *absent* is always FAIL — the whole point.)
- A stage that declares **no** verifiable op is unaffected (Check 6 is a no-op for it) — fully back-compatible with every existing composition.

### 3.5 Automated-driver non-deadlock path (carried from decompose-bridge)
Under `/run`, `/simstim`, or cron, a Check-6 FAIL surfaces a **non-deadlocking handoff** (queued to the run-mode failure channel / `.run/bridge-pending-bugs.jsonl`-style), never a blocking prompt. The gate denies the run; it does not hang the automated driver.

### 3.6 Forcing function (why record-gate, not dispatch-policing)
Two distinct provider `final_model_id`s cannot be produced by a single role-playing agent. Demanding the receipt makes honest multi-model execution the only path to a green gate. The verifier never tries to force the dispatcher to shell a specific script (fragile); it demands the evidence (robust).

---

## 4. Data Models

| Artifact | Shape | Lives at |
|----------|-------|----------|
| `bridge-findings` schema | inline JSON-schema object (§2.1) | `construct-compositions` shared schema, inlined per composition (V1) |
| receipt | `{stage_index, run_id, operation, final_model_id[], verdict, panel}` | `.run/compose/<run>/receipts/<stage>.json` |
| verify declaration | `capabilities.verify:{operation, receipt, min_model_families}` | each construct's `construct.yaml` |

---

## 5. Security Architecture

- **Schema-key safety (A)**: `bridge-findings` keys pass `_assert_safe_schema_keys` (`segment-emitter.py:927`) — no unsafe interpolation into emitted JS.
- **Receipt unforgeability (B)**: the security property is the *cost to forge* two distinct provider `final_model_id`s — there is none cheaper than actually running two model families. Self-report is never trusted; the gate verifies against the receipt.
- **Fail-closed (B)**: absence of proof = FAIL. The conservative-by-default discipline already in `compose-verify-run.sh` (only exit 0 passes; any other code is non-pass — `:406`) is preserved and extended.
- **Custody binding (B)**: receipts are bound to `stage_index`+`run_id` and ride the legba chain, so a receipt cannot be copied from another run without breaking custody.

---

## 6. Testing Strategy

Mirror the existing hermetic bats harness (`tests/integration/form-c-dispatch.bats`, `compose-verify-run.bats`):

**Epic A** (`tests/integration/` new or extended):
- A composition with the `bridge-findings` schema: a synthesis output missing `anchor`/`severity`/`recommendation` → emitter retry-on-miss fires (validation rejects).
- A `claims_ledger` with a `tag: observed` claim and empty `grounding` → validation fails.
- `rigorous-review.yaml` emits → `workflow-syntax-check.js` green; renderer produces `bridge-findings` markers that `post-pr-triage.sh` parses.

**Epic B** (`tests/integration/compose-verify-run.bats` extended) — the four PRD acceptance metrics:
- VC-B1: declared `multimodal-review`, no receipt → `broken_run` exit 3.
- VC-B2: single-model receipt, `min_model_families: 2` → exit 3.
- VC-B3: ≥2 distinct `final_model_id` → `valid_run` exit 0; receipt in custody.
- VC-B4: a non-FAGAN construct declaring a receipt contract is gate-checked identically.
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
3. **B — DEGRADED taxonomy**: exact verdict string for "receipt present but unreadable" vs reusing `broken_run` with a distinct message. Recommend a distinct note field, not a new exit code (keep exit semantics at 0/2/3).
4. **A/B convergence**: whether Epic A's `bridge-findings` and the Bridgebuilder TS app's findings schema should unify (out of scope this cycle; noted).

> **Next**: `/sprint-plan` — Epic A first.
