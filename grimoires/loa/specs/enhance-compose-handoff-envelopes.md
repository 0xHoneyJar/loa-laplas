# Session — Compose Form C handoff envelopes (closing the deployment-seam chapter)

> The composition-runtime IS the operator's executable runtime. This is the last
> piece that makes it honor its own declared contracts — then the loop self-sustains.

## Context

This closes a months-long friction chapter. The recurring pain (manifest-numbness,
scattered symlinks, ghost constructs, source↔installed lag) was diagnosed by a
proof-of-run Opus audit (`audit-ecosystem-coherence`) as **one class**: a consumer
expecting an artifact at a root the producer placed elsewhere, silently, until
dispatch breaks. It's now a **system** — a single SoT (`~/.loa/deployment.yaml`) +
GECKO's 4th eye (`sensing-deployment-seam`) that catches the class forever.

**One design-heavy blocker remains** — and it's the operator's own catch. The Form C
emitter **declares a typed-handoff contract it does not honor**: a composition stage
declares `writes: [Artifact|Verdict|Signal]`, but `segment-emitter.py` binds **every**
work stage to one hardcoded `WORK_SCHEMA = {output, rationale}` and defaults `model:
sonnet`. So the declared typed streams are **never generated** — `/compose`'s structured
output can't obey its own handoff envelopes.

**The fix already has a proof-of-concept.** A raw Workflow run this session
(run `wf_f3c8d13b-fc6`; script `~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/a78080de-8228-4022-b1a7-4b74cb79326c/workflows/scripts/seam-coherence-opus-wf_f3c8d13b-fc6.js`)
with **explicit per-stage schemas** (`SEAM_MAP`→`VERDICT`→`PATH`) + `model: opus`
produced **perfectly-typed handoffs** that passed forward intact. That is the target
shape — just moved into the governed emitter so `/compose` (not a raw Workflow) produces it.

## Run via — `code-implement-and-review` (REQUIRED)

`@~/.loa/constructs/substrates/construct-compositions/compositions/delivery/code-implement-and-review.yaml`
→ implement the emitter+schema change (stage 1, general-purpose) ↔ FAGAN adversarially
reviews the diff (stage 2, cheval council), loop to convergence. The operator directs at
the review seam. **This composition now runs** (the bd-ii1m heal this chapter landed it);
dogfood the very belt this work hardens.

## Load order

1. `@~/.loa/constructs/substrates/construct-compositions/compositions/delivery/code-implement-and-review.yaml` — the driving loop
2. `@scripts/lib/segment-emitter.py` — the emitter (the WORK_SCHEMA sites: ~90, 669, 673, 787, 928; `_resolve_model` ~243, `TIER_MODEL` ~148)
3. `@~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/a78080de-8228-4022-b1a7-4b74cb79326c/workflows/scripts/seam-coherence-opus-wf_f3c8d13b-fc6.js` — the PoC: the exact target shape (per-stage schemas + opus + typed handoffs)
4. `@~/Documents/GitHub/loa-constructs/.claude/schemas/runtime/composition.schema.json` — the canonical v1.4 schema (add the new stage fields here)
5. `@tests/integration/form-c-dispatch.bats` — the emitter test suite (49 tests; add per-stage-schema coverage)
6. memory: `project_compose-belt-heal-and-manifest-numbness` (the full chapter diagnosis)

## Persona

ARCH (OSTROM, `the-arcade`) + **the-weaver** lens (composition / agent-pathing — the
construct that owns "how does this compose, and does the handoff carry its declared type").

## Invariants (must not change)

- **Backwards-compat**: a stage with no `output_schema` → falls back to `WORK_SCHEMA` exactly as today. The 5 existing compositions + the 49 bats tests must stay green.
- **Proof-of-run is the gate**: a run only counts with a `compose-verify-run … valid_run`.
- **The emitter cannot generically schema an abstract stream** — that's WHY it flattened. The schema is **DECLARED per-stage by the composition**, not inferred from `Artifact`/`Verdict`.

## What to build (in order)

### 1. composition.schema.json — declare the new optional stage fields
In `loa-constructs/.claude/schemas/runtime/composition.schema.json` (canonical v1.4), add to the Stage shape:
- `output_schema` — an inline JSON-schema object (the typed handoff envelope this stage emits), OR a `$ref` string to a schema file. Optional.
- confirm `intelligence_tier` is already a valid Stage field (it is — used by `_resolve_model`).
Bump schema_version note. **Then sync the installed copy** `~/.claude/schemas/runtime/composition.schema.json` (currently v1.3 — the schema-copy-drift SMELL the sensor flags).

### 2. segment-emitter.py — read the declared schema + tier
- Where the emitter currently emits `schema: WORK_SCHEMA` (sites ~669/673/787/928), emit the stage's `output_schema` when present (json-escaped, determinism-clean like the rest), else `WORK_SCHEMA`. Keep the constant for the fallback.
- Confirm `_resolve_model` already routes `intelligence_tier: deep → opus`; the PoC needed opus, so make sure a high-stakes stage can declare it (it can — `audit-ecosystem-coherence` just needs `intelligence_tier: deep` on its 3 stages).

### 3. Conform the two audit compositions to declare schemas
`audit-ecosystem-coherence.yaml` + `audit-setup-coherence.yaml`: add a per-stage `output_schema` (lift the `SEAM_MAP`/`VERDICT`/`PATH` shapes straight from the PoC script) + `intelligence_tier: deep`. (audit-setup-coherence ALSO still has the schema-invalidity from this chapter — fix its stage-level `routing`/`surface_class` per the bd-ii1m-sibling notes.)

### 4. Re-run via /compose — prove it
`compose-dispatch.sh audit-ecosystem-coherence --form-c` → run the segment via Workflow → the emitted agent() calls now carry the declared schemas → `compose-verify-run … --require-executed`. The structured output must match the typed streams (the PoC shape), produced by the **governed** runtime this time.

### 5. Tests
`form-c-dispatch.bats`: add a test that a stage with `output_schema` emits THAT schema (not WORK_SCHEMA), and a stage without it still emits WORK_SCHEMA. 49 → 50+, all green.

## Quality rules (the-weaver lens)

- The emitted `agent({schema})` MUST equal the stage's declared `output_schema` byte-for-byte (the handoff envelope IS the contract — a manifest that says one thing and emits another is the exact lie this chapter killed).
- Backwards-compat is non-negotiable: no `output_schema` → identical behavior to today.
- Determinism guard holds (no `Date`/`Math.random` in emitted source — the bats determinism test must stay green).

## What NOT to build

- Do NOT try to auto-derive a schema from the abstract stream type (`Artifact`/`Verdict`). That genericity is impossible and is why it flattened. The composition DECLARES the schema.
- Do NOT rewrite the seam/cut algorithm. This is purely: emit the declared schema instead of the constant.

## Verify

- `bats tests/integration/form-c-dispatch.bats` → all green (49 + new).
- `compose-dispatch.sh audit-ecosystem-coherence --form-c --json` → exit 3, manifest lists the declared per-stage schemas.
- Run the segment → `compose-verify-run <id> --require-executed --json` → `valid_run`; structured output is typed (matches PoC `wf_f3c8d13b-fc6`).

## SECONDARY (the chapter's tail — do after the blocker, or in parallel tracks)

1. **Land the cutover UPSTREAM so it survives.** The fix lives in local `~/.claude` edits (`adapter-generator.py::_deployment_roots`, `construct-ensure.sh` SoT-forcing, the `~/.loa/deployment.yaml` concept), all only `.bak-deployseam` backed up — a framework update overwrites them. DIG: find the Loa framework SOURCE that installs `~/.claude/scripts/*` (where do these get synced from?), and land the SoT-manifest pattern + the `parents[3]`-removal there. **This is the "experiment graduates into a system that survives" step.**
2. **Wire `sensing-deployment-seam` into gecko/patrol** (the efferent loop) so the class is swept periodically, not re-discovered. `sense.py --json` → the wall.
3. **Cleanup SMELLs the sensor surfaces**: code-implement-and-review doc-metadata still naming dead codex (cosmetic; the dispatch is fixed); `.frozen.bak` junk in `~/.loa/constructs/packs`.
4. **Delicate**: `git -C construct-rooms-substrate cherry-pick 003d3fc` onto `main` (main lacks the bd-ii1m fix — `checkout main` re-arms the ghost dispatch; the runtime is currently parked on `impl/genome-hash-chain` which has it).

## Review provenance + open operator decisions (HARDEN)

**Grounded this chapter** (not a sketch): the emitter sites, the schema, the consumers were all read file:line; the PoC was actually run (`wf_f3c8d13b-fc6`, 3 agents, typed handoffs verified); the cutover is sensor-verified (`0 CONFLICT`). The remaining blocker's shape is proven by the PoC.

**Open forks (operator/builder decides — do NOT silently resolve):**
- **Inline schema vs `$ref`** in the composition YAML: inline is self-contained but verbose (the PoC schemas are ~40 lines each); `$ref` to a `schemas/` file is cleaner but adds resolution + another deployment-seam to govern. Recommendation: support BOTH (inline object OR `$ref` string), start inline.
- **Where upstream lives**: SECONDARY-1 needs a DIG — the framework source that installs `~/.claude` isn't located yet.
- **Beads**: crs has no `.beads` store — create one for this work, or track in loa-constructs' store (where bd-ii1m/bd-y099/bd-yz0k live). Recommend loa-constructs (keeps the chapter's beads together).

## Flatline hardening (2026-06-08 — single-voice review integrated)

A flatline review ran on this spec. **The cheval consensus DEGRADED to 1/3 voices** (a `mktemp: File exists` tmp-collision bug skipped verdict-quality aggregation) — so "0% agreement" is an ARTIFACT, not real disagreement, and these are ONE skeptic's findings, not a 3-model consensus. But they're sharp and several are load-bearing. Resolutions folded in:

- **PoC ≠ governed emitter — the load-bearing one.** The PoC was a raw Workflow with hardcoded schemas + opus; the emitter passes every value through PyYAML→dict→json + the determinism-escape + the injection-guard. The declared `output_schema` MUST survive that path byte-intact. VERIFY: capture the governed emitter's emitted `schema:` literal and byte-diff it against the PoC schema; add a bats fixture asserting the exact emitted schema for a known `output_schema` (and that WORK_SCHEMA still emits when absent). [blocker 5 / IMP-002, IMP-006]
- **$ref is DEFERRED to V2 — V1 is inline-only.** Review flagged `$ref` resolution as completely undefined (root? path-traversal? missing-file?). V1: stage `output_schema` is an INLINE object only. V2, if added: resolve relative to the COMPOSITION FILE's dir, validate-at-load, sandbox the path (no traversal), fail-loud on unreadable. [blockers 1, 4]
- **Atomic rollout (spans crs + loa-constructs + ~/.claude).** Order: (1) canonical schema (loa-constructs) → (2) sync installed copy → (3) emitter (crs) → (4) compositions. Preflight asserts all 4 cohere before running; each step reverts independently (git per repo; .bak for ~/.claude); the verifier asserts canonical-schema == installed-schema == emitter-expectation == composition-uses. [blocker 6]
- **Cherry-pick 003d3fc safely (SECONDARY-4).** Do NOT `checkout main` on the live runtime dir. Use `git worktree add ../crs-main main && (cd ../crs-main && git cherry-pick 003d3fc)` (isolated; runtime stays on impl/genome-hash-chain). First confirm self-contained: `git diff main..003d3fc --stat` (the 4 belt-heal files, no genome overlap). [blockers 2, 3]
- **Schema-sync re-drifts — it IS the deployment-seam class.** SECONDARY-1's "sync the installed schema copy once" will re-drift on the next framework update. BLOCK the durable emitter merge on the DIG that locates the framework SOURCE (so the schema has ONE home, not a synced copy). Interim: `sensing-deployment-seam` already flags v1.3≠v1.4 — wire it into patrol so the drift is caught, not silent. [blocker 7]

> **Flatline substrate finding — CONFIRMED REPRODUCIBLE, exact line (file upstream via `/feedback`).** `flatline-orchestrator.sh:605` runs `mktemp "${TEMP_DIR:-/tmp}/vq-input.XXXXXX.json"` — the `XXXXXX` is **not trailing** (`.json` follows it). macOS/BSD `mktemp` only randomizes trailing X's, so it tries a fixed-ish name and **collides ("File exists") on the 2nd model**, fails the verdict-quality step, and cascades to `:282` "JSON normalization failed → using default" — **blanking the Opus voice**. Net: every 3-model flatline silently degrades to 1 voice on macOS. FIX: trailing X's — `tmp=$(mktemp "${TEMP_DIR:-/tmp}/vq-input.XXXXXX") && mv "$tmp" "$tmp.json"`, or `mktemp -t vq-input`. This IS the declared-vs-actual gap this chapter is about — at the review layer.

## Round 2 re-review (2026-06-08 — also 1/3 voices, same line-605 bug; gemini tertiary skeptic)

Re-ran `/flatline-review` on the path-corrected spec. **Degraded again to 1/3** (the bug above), so single-voice (gemini), not consensus — but it surfaced sharper points round 1 missed:

- **`$ref` self-contradiction (reconcile).** The open-forks "support BOTH inline OR `$ref`, start inline" CONTRADICTS the hardening "V1 inline-only." RESOLUTION: V1 is **inline-object-ONLY**, full stop — strike "support both" from the open-forks; `$ref` is V2-only.
- **`$ref`-string type-guard (loud).** A `$ref` path is valid YAML (`output_schema: "./x.json"` parses as a string), so the emitter MUST type-check `output_schema` is an OBJECT and **fail-loud on a string** in V1 — never coerce/stringify (every silent-wrong outcome).
- **Serialization is pinned (resolves "byte-for-byte").** Emit via `json.dumps(obj, sort_keys=True, ensure_ascii=True, separators=(",", ":"))`. `sort_keys` closes cross-Python key-ordering non-determinism (the bats determinism test passes locally yet the deployed emitter diverges); `ensure_ascii`+`separators`+the existing escape close object-value injection (a `default`/`description` with quotes/newlines). This IS the concrete definition of the byte-for-byte invariant.
- **Atomic-rollout mid-window (sharper).** Between step-2 (schema synced) and step-3 (emitter upgraded) is a live window where `output_schema` is declared-valid but the emitter ignores it → silent WORK_SCHEMA, no error. RESOLUTION: land steps 1-3 as ONE atomic unit, OR gate step-4 (compositions declaring `output_schema`) behind a preflight asserting the installed emitter already reads the installed schema version.
- **Preflight needs a command + fail-closed contract.** "Asserts all 4 cohere" must be an actual command run BEFORE dispatch that exits non-zero when canonical-schema ≠ installed-schema ≠ emitter-expectation ≠ composition-uses — not prose.
- **Bootstrapping risk (accepted).** `code-implement-and-review` heals the very runtime path it runs on; fine now (belt proven healthy, 0-CONFLICT/READY), but if the belt is ever suspect, bootstrap the emitter change via a raw Workflow, not the belt.
- DISCARDED: one "read-only environment, can't build this session" CRITICAL — an artifact of the skeptic misreading the handoff as a this-session task.
