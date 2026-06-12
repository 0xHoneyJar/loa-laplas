# PROMPT.md — paste into Claude Code at the root of the rooms substrate (graduating to loa-laplas)
# Mission: integrate laplas (ready check + tri-manifest module format) and poteau (the
# enforcement lattice) as first-class capabilities, closing #7, #29, #30, #31 with
# hook-enforced, demo-proven mechanisms — 21/21 in the shipped demo.

## ROLE

You are a principal engineer integrating **poteau** — deterministic enforcement via the
Claude Code hook lattice — into the rooms substrate. The reference implementation ships
beside this prompt (poteau/), demo-proven 17/17 (`POTEAU_SRC=$(pwd)/poteau bash
poteau/test/run-demo.sh`). Treat it as executable spec: extend it into the repo's
conventions; do not regress its invariants (PT-1..PT-9 in ARCHITECTURE.md).

## CONTEXT — read these first, in order

1. `ARCHITECTURE.md` (beside this file) — the sandwich, the gap→mechanism map, failure
   postures, honest limits.
2. This repo's own issues #7, #29, #30, #31 — each names the failure and sketches the
   fix poteau implements; cite issue numbers in commits that close them.
3. This repo's existing hooks (`hooks/subagent-start/loa-tool-mandate.sh`,
   `hooks/subagent-stop/loa-handoff-collect.sh`) — currently log-only; poteau is their
   blocking successor. Preserve their packet vocabulary and three-tier validation
   (`scripts/handoff-validate.sh`).
4. Loa house conventions (`.claude/loa/reference/hooks-reference.md` in 0xHoneyJar/loa):
   hooks live under `.claude/hooks/` equivalents, settings merged from a hooks fragment,
   fail-posture rationale documented IN the script header with provenance and REVIEW-BY
   dates, audit JSONL in `.run/`, error codes as code/name/what/fix tables.

## NON-NEGOTIABLE PRINCIPLES

- Enforcement lives outside the context window. Prompts are gradient; hooks are law;
  the orchestrator conducts. Never implement a guarantee as an instruction.
- Refusals teach: every deny names what failed, the exact fix, and the why, in one
  breath. stderr is the highest-leverage prose in the toolchain.
- Two failure postures, correctly placed: fences fail open (documented, loa pattern);
  custody fails closed (a gate bypassable by crash is not a gate). Compile-time closure
  checks (P302) convert runtime fail-open holes into build refusals.
- Claims are cheap, evidence promotes: gates check receipts and hashes, never
  transcript assertions. Work without receipts didn't happen.

## PHASES

0. **Ready check at the door.** Wire `laplas/bin/laplas-ready.mjs` into compose
   dispatch: no ceremony arms without a ready receipt (.run/poteau/ready.json) binding
   quest/party/dungeon hashes. Decompose one existing composition into the three
   manifests as the worked example; P601–P606 fixtures join the negative-fixture suite.
   Module format schemas open their hounfour migration PROPOSAL (the format is law;
   the kit targets it; the catalog conforms to it).

1. **Land and wire.** Vendor `poteau/` into the repo; run `node poteau/bin/poteau-gen.mjs`
   (expect P301 — see Phase 3); merge the generated hooks fragment into the project
   settings per loa's settings.hooks.json pattern. CI runs the demo; 17/17 is a gate.
2. **Dispatcher integration (closes #29, #31 end-to-end).** The compose dispatcher
   populates `.run/poteau/run-state.json` per stage: `task` (the same literals the work
   stage receives), `task_ref`, `mandated_reads` (path + literal H1, extracted
   mechanically from the docs), `review_routing` from the composition YAML. The
   segment-emitter includes TASK and SCOPE in every gate prompt (issue #29's own fix)
   so the model-side reviewer and the mechanical gatekeeper check the same contract.
3. **Council runner (closes #30).** Implement `gate.council.runner` (flatline-style
   multi-voice invocation, ≥2 distinct reviewer ids producing signed council receipts
   into the packet). Until it exists, P301 stands: compiling a mandated council surface
   to single-model REQUIRES the recorded `--allow-single-model` override. Fail-closed
   beats silent downgrade — that is the entire lesson of #30.
4. **Key ceremony + CAS.** Replace the demo's generate-on-first-use key with per-room
   provisioned keys (versioned, public keys published in the run manifest, 0600,
   operator-held). Wire move-record's input hashing to the real CAS so receipts become
   replay-challengeable (legba integration).
5. **Liveness watchdog (closes #40's class).** Feed `.run/poteau/moves.jsonl` to the
   asson liveness verdicts (stall/spin/budget); reap/compact actions route through the
   exit gate as checkpoint packets — forced arrival is judged, never dropped.
6. **Observability.** Gate-pass rate, refusal codes histogram, break-glass and
   max-blocks incidents per construct → gecko. A gate whose P-code rate climbs is a
   gate whose contract is failing; telemetry finds it before a 2am run does.

## ACCEPTANCE

- Demo 17/17 in CI, plus repo-level negative fixtures per invariant (PT-1..PT-9),
  each closing a named issue or finding (house fixture discipline).
- A deliberately wrong-repo run is refused at the first exit (P201) — the #29 benchmark.
- A composition mandating a council either runs ≥2 voices or fails compilation with
  P301 — never silently single-model (#30 benchmark).
- Mandated-read honor rate: 4/4 by mechanism, transcript-verified (#31 benchmark).
- README's "observability-primary / does not block" caveat is updated to describe the
  new posture honestly: which surfaces block, which log, and why.

## STYLE

Loa house voice: numbered testable invariants; in-file posture rationale with
provenance; error codes with fixes; refusal messages that teach. When unsure whether a
check is fence or custody, ask: "if this check crashed, would its silent absence be a
security hole or an inconvenience?" Hole → custody, fail closed, verify at compile.
Inconvenience → fence, fail open, log loudly.
