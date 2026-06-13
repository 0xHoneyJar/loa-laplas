# Loa-Laplas — Master of Ceremonies for the Loa Engine
### Architectural Overview · v0.2.0 · (poteau is the enforcement subsystem within)

> Repo description: *Master of ceremonies for the Loa engine — prepares the quest, the
> party, and the dungeon, then refuses the ceremony until all three agree. Compiles
> compositions into runnable, gated agentic workflows.*

> In the hounfour, the poteau-mitan is the center post: the conduit through which
> every loa descends. Nothing enters the ceremony except through the post.
> Poteau is that post for the rooms substrate: the hook lattice through which every
> prompt, tool call, and turn-exit passes — deterministically, outside the context window.

## 1 · The problem, stated from evidence

The comparative study of loa vs construct-rooms-substrate localized the reliability gap
to one design choice: rooms-substrate's enforcement is **advisory** (its own README:
the SubagentStart hook "logs violations, it does not block spawn"), and its issues are
the catalogue of what advisory enforcement produces — agents bypassing the governed
path (#7), a gate approving wrong-repo work because the task never reached the reviewer
(#29), a mandated 3-voice council silently compiled to a single model (#30), and
mandated grounding reads ignored 4/4 (#31). Loa's consistency comes from the opposite
posture, named verbatim in its spiral-harness proposal: gates run where "the LLM cannot
skip [them] because it is not the LLM's decision."

Poteau ports that posture into the rooms substrate as a first-class capability, using
Claude Code's native hook lattice as the in-session substrate.

## 2 · The sandwich (placement doctrine)

```
┌─ ORCHESTRATOR (bash harness / human-in-the-loop) ── custody, sequencing,
│                                                     fresh-session independence
│  ┌─ HOOK LATTICE (poteau) ─────────────── per-move law, recording, exit gates
│  │   UserPromptSubmit → prompt-arm.sh     arm run state, inject the gradient
│  │   PreToolUse       → tool-gate.sh      law protecting the law (P402)
│  │   PostToolUse      → move-record.sh    involuntary recorder (legba-shaped)
│  │   Stop/SubagentStop→ exit-gate.sh      THE GATE: no packet, no exit
│  │   PreCompact       → compact-clew.sh   drop the thread before surgery
│  │  ┌─ PROMPTS / SKILLS / COMMANDS ────── ergonomics, the consumption gradient
│  │  │   (advice — load-bearing for behavior, never for guarantees)
```

Hooks are **reactive law**: they can deny, record, inject, and refuse-to-stop; they
cannot initiate or sequence. The orchestrator (loa's spiral-harness pattern, or the
human in /simstim) remains the conductor. Poteau is the substrate *within* a session;
it does not replace the substrate *between* sessions.

## 3 · Gap → mechanism map (each mechanism demo-proven, 17/17)

| Gap (issue) | Mechanism | Code | Where |
|---|---|---|---|
| Gate proves coherence, not conformance (#29) | task_ref hash-match + explicit in_scope assertion; gate judges work AGAINST THE TASK | P201/P202 | gatekeeper G2 |
| Mandated reads ignored 0/4 (#31) | proof-of-grounding: rationale must echo the literal H1 of each mandated read — "a read that left no echo is presumed unread" | P203 | gatekeeper G3 |
| Council silently downgraded (#30) | **two-sided fail-closed**: gen refuses to COMPILE an unhonorable mandate (build time); gatekeeper refuses single-voice packets on council surfaces (run time) | P301/P204 | gen + gatekeeper G4 |
| Governed path bypassed (#7) | the exit IS the gate: Stop blocks until a valid packet exists; refusals teach the exact fix; prompt-arm injects the governed-path one-liner at the door | P101/P102 | exit-gate |
| Advisory hooks (README) | PreToolUse denies (exit 2) mutations to constitutional paths; PostToolUse records involuntarily | P402 | tool-gate, move-record |
| Loitering (#40, partial) | per-continuation-chain block ceiling with **checkpoint-and-release** + incident (liveness > imprisonment); full watchdog wiring is Phase 5 | — | exit-gate loop guard |

## 4 · Failure postures (the load-bearing nuance)

Loa's house safety hooks fail **open**, with documented rationale ("a grep or jq failure
must result in exit 0… fail-closed would make jq bugs into denial-of-service attacks").
Poteau keeps that posture for its fences (prompt-arm, move-record, compact-clew) and
**inverts it for custody**: a gate bypassable by inducing a crash is not a gate, so the
gatekeeper fails closed (P500), and tool-gate fails closed on its narrow protected-path
surface while staying wide-open by default.

Two consequences, both handled:
- **The availability dependency is verified at compile time, not prayed for at runtime**
  (P302): during this package's own demo, a missing `jq` silently disarmed tool-gate —
  fail-open became fail-absent. The fix is projen-grade: `poteau-gen` refuses to emit an
  armed config for a host that cannot honor it.
- **Break-glass exists and is the loudest signal**: `POTEAU_BREAK_GLASS=<reason>`
  releases the exit gate and writes an incident record. Ostrom's rule — a sensed
  override closes the loop honestly; an unsensable one guarantees the loop gets cut.

## 5 · Generated-config discipline (projen alignment)

`poteau/manifest/poteau.manifest.json` is the **only hand-edited artifact**. `poteau-gen`
emits `.claude/settings.poteau.json` with `@generated` markers and checksums every
generated file AND every hook script into `.run/poteau/checksums.json`. Re-running gen
over a hand-edited output **refuses** (P401) — drift is layer leakage, an operational
hand on a collective-choice artifact. This is AWS Projen's contract (config-as-code,
generated files are read-only) applied to enforcement config, where it matters most.

## 6 · Standards alignment

- **AWS Projen**: typed manifest → generated, checksummed, drift-refusing config (§5).
- **Google ADK**: the hook lattice is ADK's callback architecture (before/after model,
  before/after tool) realized in Claude Code primitives; tool-gate ≈ before_tool_callback
  returning a blocking decision; guardrails declared in config, enforced in the runtime.
- **Anthropic Agent SDK / Claude Code**: native hook events only — UserPromptSubmit,
  PreToolUse (exit 2 deny, stderr fed to the model), PostToolUse, Stop/SubagentStop
  (`{"decision":"block","reason"}` forces continuation with the reason in context),
  PreCompact; `stop_hook_active` loop-guard honored; settings snapshot-at-session-start
  relied on as the first layer of hook-config protection, tool-gate as the second.
- **Loa house conventions**: error-code table (P-codes mirror E-codes: code/name/what/fix),
  fail-posture rationale documented in-file with REVIEW-BY-style provenance, audit JSONL
  in `.run/`, three-tier packet validation preserved from rooms-substrate.

## 7 · Threat model and honest limits

**Held**: an agent in an armed run cannot end a turn without a packet that names the
task, proves its reads, and honors its council; cannot mutate hook config, gate state,
or the manifest from inside a run; cannot avoid the move log; cannot mint receipts
(ed25519 key is file-permissioned 0600, held by the harness).

**Not held, by design or by honesty**: (a) the bootstrap — someone must merge
settings.poteau.json and launch the session; the agent must never be that someone
(orchestrator/CI owns the front door). (b) Hooks cannot conduct — phase sequencing
remains the orchestrator's job. (c) tool-gate is a fence against routine bypass, not a
hardened boundary (same accepted-bypass classes loa documents for its safety hooks:
subshells, encodings); the *closed* guarantees live in the gatekeeper and the checksum
ledger, which detect what the fence misses. (d) Receipts prove process compliance, not
semantic quality — that remains the council's and the operator's judgment, by doctrine.

## 8 · Invariants (each has a named demo assertion)

PT-1 No exit from an armed run without a gatekeeper-passed packet (P101/P102).
PT-2 The gate sees the task: task_ref hash-match + in_scope assertion (P201/P202 · #29).
PT-3 Reads leave echoes: H1-echo proof-of-grounding (P203 · #31).
PT-4 Council mandates fail closed at compile AND run time (P301/P204 · #30).
PT-5 Constitutional paths are write-denied at run time (P402) and checksum-audited.
PT-6 Generated files refuse drift (P401); the manifest is the only pen.
PT-7 The runtime closure is verified at compile time (P302).
PT-8 Block ceilings checkpoint-and-release with an incident — never imprison, never
     silently release (liveness and auditability together).
PT-9 Break-glass is sensed: every override lands in incidents.jsonl.


## 9 · The three preparations (laplas proper, v0.2.0)

A module is three preparations, authored separately, validated together — the split
every studio staffs as separate disciplines (quest design, encounter design, level design):

| preparation | the | contents | catalog artifact |
|---|---|---|---|
| **QUEST** | what | objectives, task literals, mandated reads (path + H1), gate contracts, REL, requirements (the cover rule: "an adventure for 4–6 characters of levels 5–7") | `quests/<name>@semver` |
| **PARTY** | who | roles, seats (work/council), model tiers, HITL slots (the operator is a party slot, not ambient magic), bind setups | `parties/<template>@semver` |
| **DUNGEON** | where | rooms graph, provisioned tools (the veve'd allowlist — Daemonheim rule), REL posture, budgets/enrage timers | `dungeons/<config>@semver` |

The taxonomy is load-bearing, not decorative — it retro-classifies the entire issue
history without remainder: #29/#31 were quest-prep failures (task/reads not keyed into
rooms), #30/#40 were party-prep failures (council under-recruited, wrong tier in the
seat), #7 was dungeon-prep (the governed corridor wasn't the cheapest corridor).

**The ready check** (`laplas/bin/laplas-ready.mjs`) is the raid lobby: before any
ceremony, six cross-validations (P601 roles ⊆ party · P602 tools ⊆ dungeon · P603
council staffable · P604 gates reachable · P605 REL compatible · P606 HITL seated).
Refusals teach; a pass mints a ready receipt binding the hashes of all three manifests,
which arming can require at gate 0. Half of historical failures were ceremonies that
should never have started; this is where they die now — at the door, cheaply, named.

**The trinity (engine/kit/content):** the module FORMAT ascends to loa-hounfour as
versioned schema law; laplas is the kit (cooker + ready check + poteau lattice) that
targets it; construct-compositions remains the sovereign content catalog that conforms
to it. Spec, kit, content — three repos, three change speeds, Ostrom's three layers
wearing a game studio's org chart. Reuse compounds along three independent axes: the
same quest with a cheap drafting party Tuesday and a full council Friday; the same
hardened dungeon hosting many quests; party templates with names, vectors, reputations.
