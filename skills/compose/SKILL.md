---
name: compose
description: >
  THE composition surface for Loa — browse, inspect, and run compositions via the
  construct-rooms-substrate Form C runtime (cycle-053). A composition is a chain of
  construct invocations cut into workflow-segments at gate seams. Reach for this
  automatically — no manual ceremony — whenever the operator: runs / fires / dogfoods
  a composition, names one (audit-feel, code-implement-and-review, feel-iterate,
  pair-relay, ground-and-craft, …), asks "what compositions exist", or says "use
  construct X then Y with a gate". Browses the registry, compiles to per-segment
  agent() workflows, runs them via the Workflow tool, and drives the human seam
  protocol (AskUserQuestion + >>clew capture) between segments. The run is PROVEN by
  the runtime's proof-of-run gate (compose-verify-run), not asserted — a result
  without a valid_run verdict is role-play, not a run. This is the ONLY composition
  runner — it superseded the legacy loom CLI + compose-run.sh (tmux) + compose.js.
---

# /compose — browse + run Loa compositions (Form C runtime)

**The model (cycle-053):** Claude Code IS the runtime. A composition is a **chain of
workflow-segments cut at gate seams**. `construct-rooms-substrate` is the composition
**runtime construct**; you (main-loop Claude) are its **executor**. Reach for this
whenever composition work appears — never hand-roll a bespoke workflow.

## You are the EXECUTOR, not the composer (read this first)

Running a composition is a **pipeline, not a prompt.** Every step in *Run* below is a
**script you invoke** or a **tool you call** — there is nothing to approximate, narrate,
or role-play inline. Do **not** simulate the stages in the main loop; do **not** write
composition-looking prose in place of dispatching the runtime. If a step is enumerable
(and they all are, except the human seam), it is a mechanical invocation — your job is
to *execute* it, not to *compose* it.

> **A composition is run by the runtime — `compose-dispatch` → Workflow segments →
> `handoff-validate` → seam → `compose-verify-run` — or it did not happen.**

The proof is the **artifact trail**, not your word. The terminal gate
(`compose-verify-run.sh <run_id>`) reads the run dir and returns `valid_run` only when
a real manifest + emitted segment(s) + orchestrator trail (+ any executed envelopes)
exist and are self-consistent. **Inline role-play mints none of these → it verifies as
`not_a_run` → it is worthless.** A result without a `valid_run` verdict for its
`run_id` is **role-play, not a run**: report it loudly and label it as such.

```
composition.yaml
   │  compose-dispatch.sh --form-c   (validate-before-spend → cut at seams → emit)
   ▼
[ segment-1.workflow.js ]  ╳ seam ╳  [ segment-2.workflow.js ]  ╳ seam ╳  ...
   │  Workflow({scriptPath})            │  AskUserQuestion + >>clew              │
   ▼  (agent() per stage,               ▼  (operator steer)                     ▼
       room authority)                      fire next segment
                                                                    ▼
                                         compose-verify-run  →  valid_run  (TERMINAL GATE)
```

Stable runtime: **`~/.loa/constructs/substrates/construct-rooms-substrate`** (`RT` below). Authority for
the seam protocol + terminal gate: `$RT/docs/compose-as-cc-workflow.md`. Readiness check:
`$RT/scripts/compose-doctor.sh`.

## Registry (the deck)

Canonical registry: **`~/.loa/constructs/substrates/construct-compositions/compositions/**/<name>.yaml`** (23
compositions across `delivery/ discovery/ experimentation/ persona/ sorry-for-ur-loss/`).
Also check the current repo's `compositions/` for local overrides.

- **Browse / "what compositions exist":** `ls ~/.loa/constructs/substrates/construct-compositions/compositions/**/*.yaml` — list by folder; surface name + the composition's `intent`/`description`.
- **Inspect a recipe:** read the YAML; summarize the chain (stages, roles, gates, `iterate`).
- If the operator names a chain inline, author a minimal YAML (kind: workflow; chain[] of `{stage, construct, skill, persona, mode, role}`; add `iterate` + `max_iterations` + `terminate_when` if it loops).

## Run (Form C) — the mechanical sequence

Do these **in order**. Each numbered step is a literal invocation — execute it, do not
narrate it. Skipping `compose-dispatch` (step 1) and approximating the stages inline is
the one defection this surface forbids: it produces no `run_id`, so the terminal gate
(step 6) labels the result `not_a_run`.

```sh
RT="$HOME/.loa/constructs/substrates/construct-rooms-substrate"
```

1. **COMPILE** (`compose-dispatch.sh --form-c`). Validates BEFORE spending tokens, cuts
   at seams, writes room packets (room authority, not studio), emits one `.workflow.js`
   per autonomous segment + a manifest. **Exit 3** = "compiled, awaiting you to run the
   segments". The JSON output's `terminal_gate.cmd` is the **exact gate command for
   step 6**, with the `run_id` already baked — copy it.
   ```sh
   LOA_COMPOSE_SCHEMA="$HOME/Documents/GitHub/loa-constructs/.claude/schemas/runtime/composition.schema.json" \
     "$RT/scripts/compose-dispatch.sh" <composition.yaml> --form-c --run-id <id> --json
   ```

2. **READ THE MANIFEST** — `.run/compose/<id>/form-c-manifest.json` → `segments[]`
   (`workflow_file`, `agent_types`, `kind`, `iterate`, `ends_at_seam`) + `seams[]`
   (`kind`, `after_segment`, `clew_targets`).

2.5. **RESOLVE ITEMS — bare goal → DAG fan-out (RFC #35 / decompose-bridge S3.3).** If the
   operator gave a **bare goal** (no `items[]` already in the carry), resolve the fan-out
   BEFORE running:
   ```sh
   node "$RT/laplas/bin/compose-resolve.mjs" --goal "<goal>" [--module <module.json>]
   ```
   Branch on the JSON `mode`: `fanout` → set `args.items = <items>` **and**
   `args.gate_batch_max = <gate_batch_max>` (the emitter waves them, batched by the cap);
   `single` → run with **no** `items` (one context); `refuse` → **surface the refusal and do
   NOT run** (the CLI exits ≠ 0). **A pre-supplied `items[]` skips this step entirely** (D10 —
   the existing RFC #35 path is unchanged).

3. **RUN EACH SEGMENT IN ORDER** via the **Workflow tool**:
   `Workflow({ scriptPath: <segment.workflow_file>, args: <carry> })`. Returns
   `{ outcome, converged, handoff_seeds, context_carry, seam }`. agentTypes resolve to the
   global `~/.claude/agents/construct-<slug>.md` adapters (room authority via the baked packet).

4. **WRAP + VALIDATE THE TYPED HANDOFF** for each `handoff_seeds[]` (writes the envelope
   the terminal gate later verifies):
   ```sh
   printf '%s' '<seed-json>' | "$RT/scripts/compose-handoff-wrap.sh" --seed - --cycle-id <c> --run-id <id> --json
   ```
   **This step ALSO arms the poteau exit-gate** when the run was dispatched `--module`
   (gate-0 seeded `.run/poteau/<id>/run-state.json`): the wrap translates the handoff
   into the poteau mailbox packet at `.run/poteau/<id>/packet.json` (verdict + rationale
   + `task_ref` copied from the armed run-state + `conformance`). So when a construct
   agent's `SubagentStop` fires the exit-gate, it FINDS the packet and mints a chained
   receipt instead of blocking on P101. The `--json` output's `poteau_packet` field
   confirms it was emitted (`null` = unarmed run, nothing to gate). **Do not hand-write
   the packet** — the wrap is the only place it is minted, so `task_ref` cannot drift
   (P201 holds by construction).

5. **AT EACH SEAM** (`segment.ends_at_seam`) — the only human-in-the-loop step. Surface
   `seam.surface` via **AskUserQuestion** (state-viz first, ≤6 lines, emoji-led ≤4 options).
   Map outcomes honestly: `converged` → light confirm; `cap_reached` → real operator gate
   (`auto_approved_at_cap`, NEVER read as clean); `degraded` → handoff untrusted, operator
   decides. If the steer contains `>>clew@<construct>/<skill>: <why>`, capture it (capture
   only, no apply):
   ```sh
   printf '%s' "$operator_steer" | "$RT/scripts/compose-seam-clew.sh" --stdin
   ```
   Then fire the next segment with an explicit JSON handoff from `context_carry` + the steer.

6. **TERMINAL GATE — prove the run (non-optional).** After the last segment, run the
   proof-of-run gate in TERMINAL mode (`--require-executed`). This is the step that makes
   both inline role-play AND "dispatched the compile but never ran the segments"
   worthless. **Use the exact command dispatch handed you in step 1**
   (`terminal_gate.cmd` / `terminal_gate.argv`, run_id already baked) — do NOT
   reconstruct it by hand. When node + the Legba bridge are present, dispatch bakes
   `--legba` into that command (the gradient flip): the gate then also verifies the
   **Legba custody chain** over the run's envelopes — a signed, anchored,
   tamper-evident chain derived automatically from the handoffs. `valid_run` then
   means the chain verified too (`checks.legba_chain == true`,
   `legba_receipt_hash` present); a tampered or rebuilt-over-tamper run reads
   `broken_run`. Shape (the handed cmd carries `--legba` where available):
   ```sh
   "$RT/scripts/compose-verify-run.sh" <id> --require-executed --legba --json
   ```
   - `valid_run` (exit 0) → segments executed + handoffs verified → present the result as
     a **completed composition**; cite the `run_id` + `envelope_digest` as the proof.
   - `compiled_run` (exit 4) → the compile is real but **no segments executed** — the work
     was skipped. NOT a completed composition; go run the segments (step 3), then re-gate.
   - `not_a_run` (exit 2) / `broken_run` (exit 3) → no / forged provenance → **do NOT
     present as completed.** Labelled **role-play, not a run**.
   *(Gate strength is warn-first: surface any non-`valid_run` verdict loudly and let the
   operator decide; the policy flips to fail-block — hard refusal — once the gate has
   earned trust on real runs. The exit code is the lever either way.)*

**Dry-run / debug** a segment without spending tokens:
`node "$RT/scripts/lib/run-emitted-segment.js" <segment.js> '<responsesByAgentType>' ['<args>']`.

## Boundaries

- **NEVER inline-approximate a composition.** The runtime is the only path that produces
  a result that counts; the terminal gate's `valid_run` verdict is the artifact the
  operator, the clew loop, and any downstream consumer require — not your assertion.
- **HITL-by-nature stays HITL.** A stage marked `hitl_by_nature: true` (image-gen handed to the
  web, eyeballing a deploy, signing a tx) is a pure-pause seam — NEVER automate it. A kaironic,
  continuously-steered task (`game-feel-loop`) is a *construct* case, not a workflow — don't compile it.
- **No clew inside a segment body** — clew fires only at a seam. A gate-free composition gathers
  zero learnings, by construction.
- **Validate before spend** — never run a segment for a composition that failed the cut.

## Lineage (retired — do not resurrect)

This skill is the single composition surface. It superseded, and these are now deleted:
the **loom** CLI/skill (browse/fire deck — its registry pointer had gone phantom), **compose-run.sh**
(cycle-006 tmux runner), and the monolithic **compose.js / compose-walk.js** (2026-05-29). Form C —
cut at seams, emit per-segment agent() workflows, run the seam protocol in the main loop, prove the
run with the terminal gate — is the matured form of all three.
