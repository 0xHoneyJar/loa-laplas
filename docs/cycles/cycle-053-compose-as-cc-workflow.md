# cycle-053 — Compose-Dispatch → Claude Code Dynamic-Workflow Dispatch

> **Status:** seeded (framework build-spec) · 2026-05-31
> **Repo:** construct-rooms-substrate (the composition-runtime home)
> **Full design package** (flatline-hardened, probe-grounded): `loa-constructs` branch `feat/compose-as-workflow`, dir `grimoires/loa/context/compose-as-workflow/` — `BRIEF.md` + `ADDENDUM-01-pilot-swap.md` + 5 drafts + `probes/FINDINGS.md` + `probes/ART.md`. PRD/SDD/sprint: `loa-constructs:grimoires/loa/{prd,sdd,sprint}.md` (gitignored local-only).

## Why this lives here (not in /implement)

The composition **runner** (`scripts/compose-dispatch.sh`) and the construct→agent **adapters** (`scripts/construct-adapter-gen.sh`, `scripts/lib/adapter-generator.py`) are this repo's own source. The loa-constructs `/implement` pipeline is walled off from `.claude/` (System Zone), so framework runtime work cannot go through it. It belongs here, in the framework repo, where these are normal source edits.

## The thesis (operator-confirmed)

Claude Code IS the runtime. A composition is **not one workflow** — it's a **chain of workflow-segments cut at gate seams**. `compose-dispatch.sh` already pursued this (native-subagent dispatch) but **before CC had dynamic workflows**, so its dispatch is a hack:

- **Form A** (`compose-dispatch.sh:329-333`): `echo "@agent-construct-<slug> please run a room invocation per this packet"` — the operator **pastes + @-mentions** by hand to spawn a visible agent.
- **Form B** (`:369-372`): `claude -p` per stage — subagents **invisible** in the main UI ("Sprint 4 completes this path; Sprint 2 stub").

**CC dynamic workflows (`agent()`) are the primitive Form A/B were faking** — programmatic subagent spawn *with* `/workflows` visibility. cycle-053 replaces Form A/B with a **Form C: CC `agent()` workflow dispatch**.

## The build (grounded in the actual runner)

### 1. Form C — CC `agent()` dispatch (the core)
Add a workflow-dispatch path alongside Form A/B. Per autonomous segment, emit/run a CC workflow whose stages are `agent(prompt, {agentType: 'construct-<slug>', schema})`:
- **agentType resolution is VALIDATED** (probe `FINDINGS.md` #2): `construct-the-mint` resolves, embodies CELLINI, refuses out-of-domain. Adapters already in `~/.claude/agents/construct-*.md` via `construct-adapter-gen.sh`.
- **Pass the room packet** (`FINDINGS.md` #2b, Q-E): without it the agent self-labels `studio_synthesis`. Reuse this repo's `room-packet-validate.sh` + the `.run/rooms/<room_id>.json` packet that `compose-dispatch.sh` already writes (`:23`) so the construct runs in **room authority**, not studio mode.
- **Typed handoff:** reuse `handoff-validate.sh` + the construct-handoff schema (`:351`) for the inter-segment JSON handoff.

### 2. The cut algorithm (segment the chain at seams)
`is_seam(stage) := mode=="blocking" OR role∈{hard-stop,craft-gate,gate} OR stage.hitl_by_nature`. Cut before each seam; each maximal gate-free span = one CC workflow. The seam is where the main loop surfaces a Verdict via `AskUserQuestion`, captures any `>>clew`, and fires the next segment. (Draft C `gate-seam-clew-mechanics.md`.)

### 3. The `hitl_by_nature` schema field — HOST-side edit (separate, authorized)
The schema is the **bridge** and stays in the host: `loa-constructs/.claude/schemas/runtime/composition.schema.json` (read by `compose-dispatch.sh:59`). Add `hitl_by_nature` optional boolean to `$defs.Stage.properties`, bump `schema_version` v1.2→v1.3 (additive). **Authorized `C053.OP-S1`** (`loa-constructs:grimoires/loa/runbooks/cycle-053-system-zone-authorization.md`). This is a direct authorized host edit — not via `/implement`.

## Flatline-hardening (carry verbatim — `loa-constructs:grimoires/loa/a2a/flatline/sprint-review.json`)
- **Injection (CRITICAL ×2):** composition values → `JSON.stringify`/escape before they enter emitted workflow code or prompts; clew/steer text passed to `loa-clew-capture.sh` via argv/stdin, **never** shell-interpolated. (`compose-dispatch.sh` already learned this — BB review F001, `:198` "pass JSON + schema-path via argv to avoid Python-heredoc injection".)
- **Failure ≠ empty:** a failed stage → typed sentinel `{__stage_failed,…}`, never bare `null`.
- **Rate limits** are the real fan-out ceiling (`FINDINGS.md` #4, measured ~11 concurrent); bound + retry, don't lose agents.
- **StructuredOutput not 100%** (`FINDINGS.md` #5): validate+retry the handoff schema; degraded Verdict, never fabricate.
- **`pipeline()` no-barrier UNPROVEN** (`FINDINGS.md` #6) — settle with a variable-duration probe before any iterate-loop relies on it.

## Increment order (focused build session)
1. Host-side: `hitl_by_nature` field on the bridge schema (authorized) + schema tests.
2. Form C `agent()` dispatch for ONE autonomous segment (reuse adapters + room packet + handoff validators).
3. Cut algorithm (`is_seam`) + segment-runner/seam protocol (`AskUserQuestion` + clew-at-seam).
4. Pilot: `code-implement-and-review` end-to-end (note: pilot deps `reviewing-diffs`/`fagan` are operator WIP on `loa-constructs:feat/construct-clew` — vendor or land them first).
5. Form A/B retirement gated on the loom ribbon re-point (compat stream first).

## Contrast cases (do NOT auto-migrate)
`feel-image` (HITL-by-nature image gen — operator hands prompt to the web) and `game-feel-loop` (kaironic — a *construct* case, not a workflow). They prove the construct-vs-workflow boundary; they stay HITL.
