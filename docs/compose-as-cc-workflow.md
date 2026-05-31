# Compose-as-CC-Workflow — Form C runtime + seam protocol (cycle-053)

> **Status:** built · 2026-05-31 · supersedes Form A/B dispatch (compose-dispatch.sh)
> **Grounding:** `docs/cycles/cycle-053-compose-as-cc-workflow.md` (build-spec) ·
> design package `loa-constructs:feat/compose-as-workflow:grimoires/loa/context/compose-as-workflow/`

A composition is **not one workflow** — it is a **chain of workflow-segments cut at
gate seams**. Form C replaces the Form A (operator @-mention paste) and Form B
(`claude -p` stub) dispatch hacks with the primitive they were faking: programmatic
subagent spawn via the Claude Code **Workflow tool**, with `/workflows` visibility.

## Division of labor

| Role | Who | What |
|---|---|---|
| **Compiler** | `compose-dispatch.sh --form-c` (bash) | validate (offline-robust, **before spend**) → cut at seams → emit one `.workflow.js` per autonomous segment + per-stage room packets + a run manifest. Cannot run agents (it is bash); the emitted JS cannot touch the filesystem (Workflow runtime). |
| **Executor** | the Claude Code **main loop** (you) | run each segment via `Workflow({scriptPath, args})`; wrap+validate its handoffs; at each seam run the **seam protocol** (`AskUserQuestion` + clew capture); fire the next segment with an explicit JSON handoff. |

The seam protocol **cannot** live inside a workflow: a CC workflow run cannot take
mid-run human input. Every human decision point is therefore a **workflow boundary**,
run by the main loop between segments. N seams → up to N+1 segments.

## The cut algorithm (`scripts/lib/compose-cut.py`)

```
is_seam(stage) := stage.mode == "blocking"
              OR  stage.role in {hard-stop, craft-gate, gate}     # --seam-roles
              OR  stage.hitl_by_nature == true                    # v1.3, third class
```

Walk the chain (value-sorted; half-stages allowed), accumulating maximal gate-free
spans. **Co-location rule:** a craft-gate/gate that is the upper bound `b` of an
*autonomous* iterate pair `[a,b]` (not `blocking`, not `hitl_by_nature`) folds its
autonomous test into the preceding segment as the loop's terminal step; only its
**human verdict** becomes a (terminal) seam. So:

- pilot `code-implement-and-review` (`iterate:[[1,2]]`, stage-2 craft-gate) → **1 iterating segment + 1 terminal seam**.
- `feel-image` shape (`iterate:[[2,3]]`, stage-3 craft-gate, stage-4 after) → **2 segments + 1 seam**.
- seamless (all `primary`) → **1 segment, 0 seams** (zero clew surface, by construction).
- `hitl_by_nature` / `hard-stop` → **standalone pure-pause seams** (never automated).

## What the compiler emits (`.run/compose/<run_id>/`)

- `workflows/<comp>.segment-K.workflow.js` — runnable Form C segments (see below).
- `<room_id>.json` in `.run/rooms/` — one room-activation packet per stage,
  `mode:"room"`, `invocation_path:"agent_call"` (→ **room authority**, not studio).
- `form-c-manifest.json` — the contract this doc's protocol consumes:
  `{segments[], seams[], room_packets, clew_capture}`.
- `composition.json`, `orchestrator.jsonl` (compat trajectory for the-loom ribbon).

### Emitted segment shape (runtime-accurate)

```js
export const meta = { name, description, phases, metadata };   // pure literal
const WORK_SCHEMA = {...}; const GATE_SCHEMA = {...};          // StructuredOutput
const ROOM_PACKET_S1 = {...};                                  // baked → room authority
const safe = async (s, fn) => { try { return await fn(); } catch (e) { log(...); return {__stage_failed:true,...}; } };
// ...top-level async body, reads the `args` global, ends with `return {outcome,...,seam}`
```

Hardening baked into every emit (flatline mandates):
- **Injection:** every composition value enters source only as `json.dumps` (ASCII-escaped); runtime values reach prompts only via `JSON.stringify`. No bare interpolation.
- **Failure ≠ empty:** a thrown stage → typed sentinel `{__stage_failed:true,...}`; `agent()→null` (operator-skip) is distinct.
- **Sync-throw safety:** every stage body is `() => safe(() => agent(...))` (a sync throw in a `parallel()` thunk otherwise crashes the whole run).
- **StructuredOutput not 100%:** `withRetry` tries → retries once → surfaces a **degraded** verdict; never fabricates.
- **Rate limits (~11):** `boundedParallel` chunks fan-out; the iterating loop is sequential by construction (does not rely on the unproven `pipeline()` no-barrier).
- **Determinism:** never emits `Date` / `Math.random` (the runtime greps source and aborts); timestamps/run-ids are baked literals.

## The seam protocol (main loop)

```
manifest := read .run/compose/<run_id>/form-c-manifest.json
carry    := args from the operator (e.g. { task, scope })
for segment in manifest.segments (in order):
    result := Workflow({ scriptPath: segment.workflow_file, args: carry })
    for seed in result.handoff_seeds:                       # typed handoff
        scripts/compose-handoff-wrap.sh --seed <seed> --cycle-id <c> --run-id <r>   # validate → envelope
    if segment.ends_at_seam:                                # run the SEAM
        surface(result.seam)  via AskUserQuestion           # see below
        steer := operator choice/correction                 # the only human input
        if steer contains '>>clew@...':
            printf '%s' "$steer" | scripts/compose-seam-clew.sh --stdin   # capture (stdin, never interpolated)
        carry := explicit JSON handoff built from result.context_carry + steer
surface(final result)
```

### Surfacing a seam (`AskUserQuestion`, smol-comms / pair-point register)

State-viz first (phase glyph), ≤6 lines prose, emoji-led options, ≤12-char headers, ≤4 choices.

| `result.outcome` | `seam.kind` | Surface |
|---|---|---|
| `converged` | `confirm` | ✅ clean approval at iter N — light confirm ("ship it" / "tweak"). Clew-capable but usually nothing to correct. |
| `cap_reached` | `operator_gate` | 🟡 **NOT converged** — `auto_approved_at_cap:true`. Surface the non-convergence; options `accept-as-is / one-more-iteration / hand-back`. The most clew-worthy seam. |
| `degraded` | `operator_gate` | ⏳ handoff could not be trusted (StructuredOutput miss / skip / stage failure) — `retry-segment / accept-partial / abort`. **Never** read as converged. |

**`cap_reached` is never folded into `converged`** — they are distinct outcomes
end-to-end (FR-6 Risk #2).

### Clew at the seam (and ONLY at the seam)

The operator's correction at a seam is the only place clew can fire (no human is
present mid-run). One `>>clew@<construct>/<skill>: <why>` gesture does two things:
(1) steers the next segment invocation (as a correction arg), and (2) deposits a
durable construct learning via `scripts/clew/loa-clew-capture.sh` (capture only —
distill→ratify→PR stays cold-path, human-gated). `manifest.seams[].clew_targets`
pre-fills the candidate `@construct/skill`; the operator may retarget.

**Invariant:** there is **no clew hook inside an autonomous workflow body**. A
seamless composition gathers zero learnings, by construction. Gate = guidance + clew;
no gate = no clew.

## Hardening & verification (cycle-053 adversarial review)

- **Injection:** every composition value reaches emitted JS only through `js()`
  (`json.dumps` + determinism-escape) — including the leading doc-comment (now
  static; provenance lives in the `js()`-escaped `meta`), `max_iterations`
  (int-coerced then `js()`'d), and the `clew_example` marker (assembled in Python,
  then `js()`'d). No bare composition value is f-string-interpolated into source.
- **Determinism:** `js()` `\uXXXX`-escapes the leading byte of any `Date` /
  `Math.random` token, so a composition that merely *mentions* those words in prose
  compiles cleanly (the runtime greps source text) while the runtime string value is
  unchanged. (Earlier this fail-closed-rejected benign compositions.)
- **StructuredOutput miss:** a returned-but-schema-incomplete payload (e.g. `{}`) is
  checked against the stage's required keys, retried once, then **degraded** — it can
  never surface as `converged`. A clean operator-skip (`agent()→null`) stays distinct
  from a stage failure (typed sentinel).
- **Iterate bounds:** stages before the iterate lower bound `a` are a once-only
  **preamble** emitted before the loop; only `[a,b]` iterate. (Previously a preamble
  stage re-ran every pass.)
- **Rate limits:** met **by construction** for the current emit kinds — the iterating
  loop is sequential and sequential segments don't fan out, so no composition relies on
  the unproven `pipeline()` no-barrier. `boundedParallel` (each thunk `safe()`-wrapped)
  is retained for a future fan-out segment kind; until one exists it is unused.
- **terminate_when:** Form C reduces the composition's `terminate_when` predicate to the
  machine-checkable "gate verdict === APPROVED"; the original prose is preserved in
  `meta.metadata.terminate_when` for operator legibility.
- **Dry-run harness:** `scripts/lib/run-emitted-segment.js <emitted.js> '<responsesByAgentType>' ['<args>']`
  drives an emitted segment with scripted agent responses (no token spend) and prints the
  return — used by the bats runtime tests (converged / cap_reached / degraded / skip / throw)
  and handy for local verification.

## Contrast cases — do NOT auto-migrate

- `feel-image` — image generation is **HITL-by-nature** (the operator hands the
  prompt to a web tool by hand). Mark such stages `hitl_by_nature: true`; they stay
  seams, never automated into an autonomous span.
- `game-feel-loop` — **kaironic**: needs continuous human steering, not steering at
  discrete seams. It is a *construct* case, not a workflow. Keep it HITL.

These prove the construct-vs-workflow boundary.

## Retirement (Phase 3, out of this build)

Form A/B retire only AFTER the loom ribbon is re-pointed at the `/workflows` surface
(the compat `orchestrator.jsonl` stream keeps it working until then). Order:
keep schema bridge → add Form C (done, coexists) → pilot → compat stream → re-point
loom → retire `compose-run.sh` + `stage-executor-tmux.sh`.
