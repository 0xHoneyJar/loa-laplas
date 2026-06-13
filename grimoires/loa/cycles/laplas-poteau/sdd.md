# Software Design Document — Laplas + Poteau Integration

> **Cycle**: laplas-poteau · **PRD**: `grimoires/loa/prd.md` (FLATLINE-REVIEWED, 12 blockers inline)
> **Status**: FLATLINE-REVIEWED (3-model: claude+codex+gemini headless · 62% agreement ·
> 8 HIGH integrated · 6 disputed accepted (gpt+gemini consensus, opus-uncovered) ·
> 11 blockers → 7 themes addressed inline, none overridden)
> **Flatline artifact**: `cycles/laplas-poteau/flatline-sdd-review.json`
> **Design inputs re-grounded**: reference impl read in full (hooks 136 lines, gatekeeper 108,
> gen 101, ready 100, manifest 35) · this repo's seams located line-anchored
> (`segment-emitter.py:1095` gate_head — #29's exact site · `compose-dispatch.sh` stage loop ·
> `.claude/settings.json` hook map) · demo behavior verified (20/21 macOS, R-5).

## 1 · Architecture overview

The sandwich, placed onto this repo:

```
┌─ ORCHESTRATOR ─ compose-dispatch.sh (compile) + CC main loop via /compose (execute)
│                 + compose-verify-run.sh (prove)         — custody, sequencing
│  ┌─ HOOK LATTICE (poteau, vendored) ─────────────────── per-move law, in-session
│  │   UserPromptSubmit → prompt-arm.sh    arm IF ready receipt exists; inject gradient
│  │   PreToolUse       → tool-gate.sh     P402 deny on constitutional paths
│  │   PostToolUse      → move-record.sh   involuntary move log (→ FR-F liveness)
│  │   Stop/SubagentStop→ exit-gate.sh     THE GATE: packet or no exit (G1–G5)
│  │   PreCompact       → compact-clew.sh  thread dropped before surgery
│  │  ┌─ PROMPTS / SKILLS ─ /compose skill, segment prompts (gradient, never guarantee)
└──┴──┴── LAPLAS READY CHECK ─ laplas-ready.mjs at dispatch gate 0: quest+party+dungeon
          agree (P601–P606) or the ceremony never starts; receipt binds all three hashes
```

Three planes the verify gate already owns stay owned: poteau ADDS the in-session law
layer between compile and prove. `compose-verify-run.sh` grows one check (§4.6): a
`valid_run` on an armed ceremony additionally requires an unbroken poteau receipt chain.

## 2 · Repository layout (post-integration)

```
loa-laplas/
├── poteau/                      # vendored reference impl = executable spec
│   ├── manifest/poteau.manifest.json   # the ONLY pen (projen discipline)
│   ├── hooks/{prompt-arm,tool-gate,move-record,exit-gate,compact-clew}.sh
│   ├── bin/{poteau-gen.mjs,poteau-gatekeeper.mjs}
│   ├── data/error-codes.json    # normative P-code source (PRD §9)
│   └── test/run-demo.sh         # CI gate (21/21; R-5 fix applied)
├── laplas/
│   ├── bin/laplas-ready.mjs     # the raid lobby (P601–P606)
│   ├── schemas/{quest,party,dungeon,module}.schema.json   # NEW — format law draft
│   └── test/fixtures/           # P601–P606 negative fixtures + worked example
├── modules/
│   └── code-implement-and-review/      # the worked example (FR-A decomposition)
│       ├── module.json · quest.json · party.json · dungeon.json
├── scripts/compose-dispatch.sh  # MOD: gate 0 ready check + per-stage run-state
├── scripts/lib/segment-emitter.py      # MOD: TASK/SCOPE into gate_head (#29)
├── scripts/poteau-smoke.sh      # NEW — FR-B0 hook-contract smoke test
├── scripts/council-run.sh       # NEW — FR-D council runner (§4.7)
├── scripts/poteau-stats.sh      # NEW — FR-G telemetry aggregator (§4.10, wave 3)
├── docs/poteau-runbook.md       # NEW — operator bootstrap runbook (§4.2, ships S1)
└── .claude/settings.poteau.json # @generated fragment (gen output, checksummed)
```

## 3 · The arming lifecycle (end to end)

```
operator: /compose run code-implement-and-review …
1. DISPATCH GATE 0 (compile time, fail closed):
   laplas-ready.mjs modules/<name>/module.json
   → refusals P601–P606 (exit 2, each names the fix) | ready receipt
     .run/poteau/<run_id>/ready.json {quest_hash, party_hash, dungeon_hash}
2. COMPILE (existing): validate → cut → emit segments + room packets + manifest
   + NEW: per-stage poteau seeds .run/poteau/<run_id>/stages/<k>.json
     {task, task_ref, mandated_reads[{path,h1}], review_routing}
3. ARM (session): prompt-arm.sh sees /compose → verifies ready receipt exists for
   the named run (NO receipt → arms NOTHING, warns: ceremony unprepared) → writes
   run-state.json {run_id, session_id, gate_index:0, stop_blocks:0} + active-run
   pointer → injects the governed-path one-liner (the gradient starts at the door)
4. WORK (per stage): move-record appends moves; tool-gate denies constitutional
   mutations; at stage end the agent emits its packet (construct-handoff vocabulary)
   to .run/poteau/<run_id>/packet.json
5. EXIT (Stop/SubagentStop): exit-gate → gatekeeper G1–G5 → pass mints chained
   receipt + advances gate_index | refusal teaches, {decision:block}
6. PROVE (existing + extension): compose-verify-run.sh <run_id> additionally walks
   .run/poteau/<run_id>/receipts.jsonl — chain unbroken, gate_index == seam count
```

## 4 · Component contracts

### 4.1 Ready check at dispatch gate 0 (FR-A)
`compose-dispatch.sh` gains, before schema validation: if the composition (or CLI
`--module <path>`) names a module, run `node laplas/bin/laplas-ready.mjs <module>`;
exit 2 → dispatch refuses with the P6xx text verbatim (refusals teach, pass-through —
no re-wording); exit 0 → receipt at `.run/poteau/<run_id>/ready.json`. Compositions
without a module: dispatch warns `unprepared ceremony (no module)` and proceeds —
adoption is incremental (#7's incentive logic: never make the governed path heavier
before the on-ramp exists), tracked to flip to refuse in wave 3.
**Receipt binding**: `prompt-arm` (4.3) arms ONLY when the ready receipt for the run
exists — preparation and enforcement are one chain, not parallel features.

### 4.2 Vendoring + gen + the settings merge (FR-B)
Vendor verbatim; repo-convention deltas applied as a SEPARATE commit on top of the
pristine import (diffable provenance — R-4). `poteau-gen` runs with paths adapted via
`POTEAU_ROOT`. **Settings merge — the clobber hazard (grounded)**: this repo's
`.claude/settings.json` is framework-COPIED (mode 600, refreshed by
`mount-submodule.sh --reconcile`/remount); naive in-place merge is silently undone at
next refresh. The runbook (IMP-008) therefore specifies the loa overrides pattern:
hooks fragment lives at `.claude/settings.poteau.json` (gen output) and the operator
merge step appends poteau's hook entries into `.claude/settings.local.json`
(operator-owned, survives remount) — with `poteau-gen --check` verifying post-merge
state by checksum and a one-command rollback (delete the merged block, re-verify).
**Runbook content (IMP-002 — actionable now, shipped as `docs/poteau-runbook.md`)**:
```bash
# 1. generate (refuses on drift/missing deps — P401/P302)
node poteau/bin/poteau-gen.mjs
# 2. merge (operator-owned; agent never runs this)
jq -s '.[0] * {hooks: (.[0].hooks // {} | . as $h | .[1].hooks | to_entries
  | reduce .[] as $e ($h; .[$e.key] = ((.[$e.key] // []) + $e.value)))}' \
  .claude/settings.local.json .claude/settings.poteau.json > .claude/settings.local.json.new
mv .claude/settings.local.json.new .claude/settings.local.json
# 3. verify (checksums + merged-state probe)
node poteau/bin/poteau-gen.mjs --check
# 4. rollback (one command)
jq 'del(.hooks[][] | select(.hooks[]?.command | strings | test("poteau/hooks/")))' \
  .claude/settings.local.json > .claude/settings.local.json.new && mv .claude/settings.local.json.new .claude/settings.local.json
```
**R-5 fix lands here**: `run-demo.sh` numeric compares go through `$((N))`;
fixture `pt-fixture-portable-compare`; CI matrix ubuntu + macos.

### 4.3 FR-B0 — the contract smoke test (BLOCKER B1, runs FIRST)
`scripts/poteau-smoke.sh`: launches a disposable `claude -p` (headless) session with a
minimal hook config in an isolated project dir; proves four legs mechanically:
1. **Stop block**: a Stop hook emitting `{"decision":"block","reason":"SENTINEL-CONTINUE"}`
   → transcript shows continuation containing the sentinel.
2. **PreToolUse deny**: exit-2 hook with sentinel stderr → tool result carries it,
   mutation absent on disk.
3. **Loop guard**: `stop_hook_active` true on the second Stop of a chain.
4. **UserPromptSubmit injection**: stdout-on-exit-0 lands in context (sentinel echo).
5. **Combined state (T2/SKP-006)**: a PreToolUse denial fired DURING a stop-blocked
   continuation chain (`stop_hook_active=true`) with an active injection — the three
   mechanisms compose; legs proven independently can still interfere.
**Dual-mode pass criteria (IMP-015)**: all FIVE legs must pass in BOTH interactive and
`claude -p` headless modes; the receipt records per-mode verdicts. One mode failing =
exit 1 = HALT (R-7 is a freeze gate, enforced not advisory).
Output: `.run/poteau/contract-receipt.json` {cc_version, mode, five leg verdicts}. Any
leg false → exit 1, CYCLE HALTS (PRD FR-B0). CI re-runs on every PR touching `poteau/`
or the CC version pin; drift = build refusal.

### 4.4 Dispatcher → run-state (FR-C, the quest reaches the gate)
At cut time, per stage k the dispatcher derives from the composition (and module quest
when present): `task` = the stage's task literals — the SAME text the emitter bakes
into the work prompt (single source: the cut JSON, not a re-derivation); `task_ref` =
sha256(JCS(task)); `mandated_reads` = quest.mandated_reads ∪ stage-level reads, each
`{path, h1}` with h1 extracted MECHANICALLY — first `^# ` line AFTER skipping a YAML
frontmatter block if present (IMP-007: this repo's docs open with `---` frontmatter;
naive first-line extraction would mis-key every one); file missing or H1-less →
refusal at compile, not silence; `review_routing` from quest/composition
(`{council: bool, min_voices}`).
**Task literal bounds (T5/IMP-008 — the quest is data, not directives)**: task ≤4000
chars, control sequences stripped (C0/C1, ANSI), compile-time refusal P-code on
violation; the gate prompt wraps TASK in a fenced block so a malformed quest.json
cannot inject structural directives into the reviewer's context.
**Legacy defaults (IMP-004, fail-closed on the load-bearing field)**: no task literals →
refuse to arm; no review_routing → non-council, logged; no mandated_reads → empty,
logged. Stage transition (orchestrator-driven, segment boundary): the executor copies
`stages/<k>.json` over the active `task/mandated_reads/review_routing` keys in
run-state — hooks never sequence (the sandwich), the orchestrator conducts.

### 4.5 Emitter — the gate sees the task (#29, line-anchored)
`segment-emitter.py:1095` gate_head gains, immediately after the role sentence:
```
TASK (verbatim, judge work AGAINST THIS): <task literals>
SCOPE: verdict is CHANGES_REQUIRED if the diff does not implement THE TASK within
scope, regardless of internal quality. Assert conformance.in_scope explicitly.
```
Same source as run-state's `task` (4.4) — the model-side reviewer and the mechanical
gatekeeper check the SAME contract; neither is derived from the other's paraphrase.
The emitter also stops ignoring `review_routing` (#30's compile half): a council
mandate on a stage whose party cannot staff ≥min_voices is P301 at EMIT time unless
`--allow-single-model` (recorded per IMP-002).

### 4.6 Gatekeeper (port + two changes)
G1–G5 port unchanged (executable spec). Two port-time changes, both PRD blockers:
**(B8+T3) run-scoped state, session-keyed pointer** — pointers live at
`.run/poteau/by-session/<session_id>` → `{run_id, armed_at}` (hooks read their OWN
session's pointer from hook-input session_id — parallel sessions cannot clobber each
other, no lock needed; IMP-013's race test ships in the suite). A second `/compose`
in an already-armed session REFUSES to re-arm with a teaching message (one ceremony
per session); a stale pointer (run dir absent) → hooks no-op + warn loudly. All run
paths derive from the pointer: `…/<run_id>/{run-state,packet,ready}.json`,
`moves/incidents/receipts .jsonl`. Parallel ceremonies never share state.
**(T1) the packet mailbox carve-out** — tool-gate denies `.run/poteau/**` mutations
(constitutional: run-state, moves, receipts, seeds, pointers) EXCEPT exactly one slot:
`.run/poteau/<run_id>/packet.json` — the agent MUST be able to emit its packet (the
reference's wholesale deny would deadlock its own exit), and an agent-authored packet
is harmless by construction: it is JUDGED by G1–G5, and receipts are minted only by
the gatekeeper. The carve-out is data, the judgment is law.
**(G1 extends, vocabulary preserved)** — before field checks, the gatekeeper shells
`scripts/handoff-validate.sh` on the packet under a 10s timeout (T7: a hanging
validator must never stall the Stop hook — timeout → P500 fail-closed refusal that
NAMES the hang); tier-1 required = fail closed, tier-2 warn: poteau's packet IS the
construct-handoff packet; the three-tier discipline is one validator, not two dialects.
**(IMP-011) receipt freshness** — each receipt additionally binds `run_id` and is
refused if its `ts` predates the run's `armed_at` (no cross-run replay; chain order +
prev-hash already prevent intra-run splicing).
**Verify-gate extension, adoption-aligned (T4)**: `compose-verify-run.sh` gains
`--poteau`. For runs that ARMED (ready receipt + run dir exist): receipt chain
hash-walks clean, `gate_index` ≥ seam count, ready hashes match the module — else
`broken_run`. For runs that never armed (waves 1–2 legality): legacy verification
applies unchanged and the verdict stamps `governance: unarmed` — visible, never a
late surprise failure (the trap SKP-002 named: full execution then predictable
verify-fail is WORSE than honest legacy verification). Wave 3 flips DISPATCH to
refuse unprepared ceremonies, at which point unarmed runs cannot exist — enforcement
tightens at the door, never retroactively at the exit.

### 4.7 Council runner (FR-D)
`gate.council.runner = "scripts/council-run.sh"` — flatline-orchestrator's headless
trio pattern reused at gate scale: N≥2 distinct provider CLIs (claude/codex/gemini
headless), each receiving the SAME gate prompt (incl. TASK/SCOPE), each returning a
verdict JSON; receipts `{reviewer_id: provider+model+nonce, verdict, task_ref,
packet_hash, ts}` appended to the packet (B6: id binds provider+model+nonce;
anti-replay via task_ref+packet_hash binding; independence = distinct provider
processes). **Resilience (T6/IMP-003/IMP-005)**: 300s timeout per provider call (CI
safety), no silent retry; if available voices < min_voices the gate stage HARD-FAILS
with a refusal naming the dead provider and the staffing fix — degradation happens
ONLY via the recorded `--allow-single-model` override, never as a runtime fallback. The runner is invoked by the EXECUTOR at gate stages (workflow segment),
never by hooks (hooks cannot conduct). Gatekeeper G4 then verifies ≥min_voices
distinct reviewer_ids — runtime half of the two-sided #30 fix.

### 4.8 Key ceremony + CAS (FR-E, wave 2)
Replace generate-on-first-use: `poteau-gen --provision-keys <run_id>` mints per-run
ed25519 keys under `~/.loa-laplas/keys/<run_id>/` (outside the workspace), publishes
pubkeys into the run manifest. **Fence-grade honesty stands (B5)**: same-OS-user; the
SDD claims detection (chain verify catches forged receipts whose key isn't in the
manifest) not prevention. move-record input hashes upgrade from base64-prefix to
sha256 over CAS-stored content (`scripts/legba/` integration), making receipts
replay-challengeable (`legba challenge` shape).

### 4.9 Liveness watchdog (FR-F, wave 2)
`moves.jsonl` is already the heartbeat. A poll (orchestrator-side, NOT a hook —
hooks are reactive) evaluates asson `livenessVerdict` (stall/spin) + budget
per the §3.3-amendment taxonomy (`liveness | budget`), with concrete defaults FROM
the manifest's existing `rooms.default.liveness` block (IMP-012): `tool_calls: 50`
(budget), `wall_s: 600` (budget), `stall_s: 120` (liveness) — operator-tunable per
room, never invented at runtime. Verdict → exit-gate-routed checkpoint
packet (forced arrival is judged, never dropped — PT-8). On landing, hardness-manifest
`compose-calls-ceiling` flips prose→hook WITH its benchmark (G-5 discipline).

### 4.10 Observability (FR-G, wave 3)
`poteau-stats.sh` aggregates per run: gate passes, refusal P-code histogram,
break-glass count, max-blocks incidents → JSONL consumed by GECKO sensing; the
Observatory's fold (`trace-gen`) reads the same dir to render armed runs.

## 5 · Module format (laplas proper)

Schemas drafted at `laplas/schemas/*.schema.json` from the fixture shapes (quest:
name/version/rel/requires/review_routing/gates/mandated_reads · party:
name/members[role,tier,seat]/hitl · dungeon: name/rooms/tools/rel/budgets), JSON
Schema draft-07, versioned `module/1`. **Worked example**: decompose
`compositions/code-implement-and-review.yaml` → quest (implement+review objectives,
craft-gate contract, mandated reads), party (primary implementer seat + FAGAN council
seat + operator HITL slot), dungeon (two-room graph, provisioned tools, budgets).
The composition file remains the execution format; the module is the PREPARATION
format referencing it — no breaking change to existing compositions (adoption per
4.1). Hounfour migration PROPOSAL opens with the schemas attached (P3 persona;
ratification explicitly out of cycle scope).

## 6 · Data layout (run-scoped, B8)

`incidents.jsonl` schema (IMP-014): `{ts, run_id, event: break_glass|max_blocks_checkpoint|
council_waived|stale_pointer, reason, actor: operator|watchdog|system}` — one shape,
aggregatable by FR-G. Per-run private keys are DELETED at run close (IMP-016); pubkeys
persist in the run manifest so receipts stay verifiable after key destruction.

```
.run/poteau/
├── by-session/<session_id>          # pointer: {run_id, armed_at} (T3 — no clobber)
├── contract-receipt.json            # FR-B0 smoke result (per CC version × mode)
└── <run_id>/
    ├── ready.json                   # laplas receipt (3 manifest hashes)
    ├── run-state.json               # armed state: task/task_ref/reads/routing/gate_index
    ├── stages/<k>.json              # per-stage seeds (dispatcher-written)
    ├── packet.json                  # transient: consumed by each gate pass
    ├── moves.jsonl                  # involuntary log (FR-F heartbeat)
    ├── receipts.jsonl               # signed, chained gate receipts
    └── incidents.jsonl              # break-glass · max-blocks · overrides
```

## 7 · Security (PRD §5/§7 carried into design)

Postures per manifest `failure_posture` (fences open, custody closed); break-glass
launch-env-only/single-shot/sensed (B3); P500 refuses with fix text, never hangs (B4);
unarmed sessions can't mint `valid_run` — verify-gate extension 4.6 makes that
mechanical (B2); tool-gate fence classes documented verbatim from brief §7; key
custody fence-grade until 4.8 (B5); the agent never merges its own hook config —
runbook is operator-owned (IMP-008); P-code normative source vendors with FR-B (B7).

## 8 · Testing & verification

| Surface | Test |
|---|---|
| Hook contract (FR-B0) | `poteau-smoke.sh` 4 legs, receipt archived; CI re-runs; drift = refusal |
| Reference invariants | demo in CI (ubuntu+macos), 21/21 post-R-5-fix; PT-1..9 assertions named |
| Ready check | P601–P606 negative fixtures + module-good pass + receipt-hash binding |
| #29 benchmark | wrong-repo fixture run → first exit refuses P201 (G-1) |
| #30 benchmark | council-mandated module: emit w/o runner → P301; single-voice packet → P204; recorded override → council_waived in receipt |
| #31 benchmark | 4 mandated reads, rationale missing one H1 → P203 names the path; 4/4 echoes pass |
| #7 benchmark | unarmed session emits no receipts → `compose-verify-run --poteau` = broken_run |
| Settings merge | runbook verify step: `poteau-gen --check` green post-merge, post-remount |
| Packet vocabulary | gatekeeper G1 shells handoff-validate.sh: existing 3-tier fixtures pass unchanged |
| Pointer race (T3/IMP-013) | two concurrent sessions arm distinct runs → distinct pointers, no clobber; stale-pointer no-op test |
| Task injection (T5) | quest.json with ANSI/structural directives → compile refusal; 4001-char task → refusal |
| Mailbox carve-out (T1) | agent Write to packet.json ALLOWED; Write to run-state.json/receipts.jsonl DENIED (P402) |
| Wave-2 acceptance (IMP-009) | keys deleted at close + pubkeys verify receipts (S5); watchdog fires at manifest thresholds in a fixture run (S5); README posture map lists every surface with its hardness entry (S6) |

## 9 · Sprint shape (input to Phase 5)

S1 **Contract + landing**: FR-B0 smoke (HALT gate) → vendor + R-5 fix + gen + runbook
+ CI demo. S2 **The door**: schemas + worked-example decomposition + ready-check at
dispatch gate 0 + P6xx fixtures + hounfour proposal. S3 **The quest reaches the gate**:
dispatcher run-state + emitter TASK/SCOPE + gatekeeper port (B8 + handoff-validate) +
verify-gate `--poteau` + #29/#31 benchmarks. S4 **The council**: council-run.sh +
emit-time P301 + receipts + #30 benchmark + #7 benchmark. S5 (wave 2) **Custody +
liveness**: keys/CAS + watchdog + ceiling flip. S6 (wave 3) **Telemetry + README
posture map** (G-5 close).

## 10 · Risks carried into design

R-1 cutover: gatekeeper REUSES handoff-validate (4.6) so old/new speak one packet
dialect; log-only pair retires only after S3 benchmarks green. R-2 deadlock: B4 NFR +
break-glass + checkpoint-and-release all designed in. R-3 friction: 4.1 keeps
unprepared ceremonies legal (warn) until wave 3; FR-G watches refusal rates. R-6
settings clobber: grounded as REAL (framework-copied settings.json) — runbook routes
through settings.local.json. NEW R-7: `claude -p` headless hook semantics may differ
from interactive — FR-B0 smoke runs BOTH modes before FR-B design freezes.
