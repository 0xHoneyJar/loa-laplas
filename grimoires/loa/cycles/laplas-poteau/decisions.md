# decisions.md — laplas-poteau cycle log

## S1.3 — the bootstrap proved itself LIVE (2026-06-12, operator-delegated)

**What happened**: the operator delegated the runbook merge cycle to the agent
("run it for me"). The merge (step 1) wrote 7 poteau hooks into
`.claude/settings.local.json` — and **Claude Code hot-reloaded it mid-session**.
The instant tool-gate went live, it DENIED the agent's own step-3 rollback `mv`
into `.claude/` with P402. The agent could not revert its own hook config.

**Why this is the headline, not a snag**: this is PT-5 / the entire thesis,
demonstrated live and unplanned — *"an agent editing hook config is an
operational actor amending constitutional law — layer leakage, denied."* The
rollback completed only when the OPERATOR ran it in their own shell (`!`-prefix,
outside the agent's PreToolUse path — the legitimate front door per brief §7
"the agent must never be that someone"). Full cycle proven:
merge → live-enforce → agent-rollback-DENIED → operator-rollback → clean
(0 hooks, tool-gate silent, hot-reload confirmed both directions).

**Findings carried to sprint review**:
1. **Hot-reload (corrects the runbook + a design assumption)**: ARCHITECTURE.md §6
   states "settings snapshot-at-session-start [is] the first layer of hook-config
   protection." On CC 2.1.176, `settings.local.json` HOT-RELOADS within a live
   session — merging arms enforcement immediately, no restart. The snapshot
   protection does NOT hold for settings.local.json. The runbook's "restart after
   merge" note was wrong and is corrected; the FR-B0/R-7 contract surface should
   add a hot-reload leg (settings.local.json changes take effect mid-session).
2. **tool-gate fence is coarse (accepted, documented)**: any Bash command pairing a
   `.claude/` path with a `>` — including `2>/dev/null` stderr redirects — trips
   the deny (false-positive class). Reads needing stderr redirection get caught.
   This is the documented fence/custody tradeoff (brief §7); the closed guarantees
   live in the gatekeeper, not the fence. Noted for the S6 README posture map.
3. **Operator-delegation honesty**: the agent ran the cycle ONLY on explicit
   "run it for me", logged as operator-delegated — the strict acceptance letter
   ("operator executes") is satisfied by the operator's own `!`-shell rollback,
   which the agent could not perform. The delegation did not, and could not,
   let the agent revert hook config — the boundary held under delegation.

**Decision**: S1.3 acceptance MET (merge/verify/rollback proven, repairable
bootstrap demonstrated). Merge stays OUT until S3.3 ports prompt-arm's
ready-receipt requirement (arming on raw `/compose` is premature). The
hot-reload finding is a NEW FR-B0 leg for S-review, not a blocker.

## S2-close checkpoint (U7) — 2026-06-12
Operator decision: **keep PR #44 STACKED** on cycle/observatory-graduation (PR #43,
still open). Clean if #43 lands first; reviewed/merged in order. No rebase now.
Continue authorized into S3.

## S3 — #29/#31 reframe: the mechanisms PRE-EXIST; S3 is the wiring (2026-06-12)

Grounding at the #29 fix site (`segment-emitter.py:1095`) found the prompt-level
fix ALREADY SHIPPED: lines 1195–1200 inject `TASK`, `SCOPE`, and the exact
conformance clause issue #29's "Fix" section requested — and `JSON.stringify(task)`
makes it injection-safe (the U1 schema fence is belt-and-suspenders). The gatekeeper's
mechanical halves (P201 task-match, P203 H1-echo) are vendored and demo-proven
(run-demo.sh:26,29). So neither issue needs its mechanism BUILT.

**What S3 actually adds — the wiring** (the gap between "demo proves it on a
hand-built fixture" and "it fires in a live compose run"):
- **S3.1 seeder** (`laplas/lib/seed-runstate.mjs`): at gate-0 the dispatcher derives
  the armed contract from the module's quest — task/task_ref (JCS-sha256),
  mandated_reads (H1 re-extracted MECHANICALLY at seed time; a stale declared h1 →
  refuse), review_routing. IMP-004 fail-closed: no objectives → exit 3, dispatch
  refuses (an armed run with no task is ungateable — #29). Wired into compose-dispatch.
- **Benchmarks on REAL seeded state** (`benchmarks.test.mjs`, 6/6): #29 wrong
  task_ref→P201 · #29 no in_scope→P202 · #31 missing echo→P203 · **#30 single-voice
  on the council-mandated worked example→P204** (the worked example demands a council
  S4 staffs — so its green path correctly blocks at P204 today). The issues now close
  against a contract derived from a real module, not a fixture.

**Honest status**: #29 and #31 are MECHANICALLY CLOSED on seeded state. The
remaining S3 port-time work (T3 by-session pointers, T7 handoff-validate timeout,
IMP-011 receipt freshness, prompt-arm ready-receipt requirement, sandwich lint) and
S3.4's verify-gate `--poteau` + #7 unarmed benchmark are integration polish on a
proven core — the natural fresh-context continuation.

## S3.3 port-time — done + the honest remainder (2026-06-12)
- **prompt-arm → pure gradient injector** (the S1.3-deferral resolution): no longer
  creates run-state — the DISPATCHER's gate 0 is the sole armer (hooks-cannot-conduct).
  A raw /compose with no prepared module arms NOTHING (softer nudge), so merging the
  lattice for-keeps can't spuriously arm an unprepared run. by-session pointer (T3) +
  location-tolerant adoption (run-scoped OR flat during the port). Demo updated: the
  dispatcher seeds run-state directly; +1 assertion (25/25).
- **sandwich lint (IMP-008)**: static — no hook spawns/dispatches/sequences (reactive
  law only). 2 tests.
- **IMP-011 freshness**: receipt chain single-run + prev-hash linkage, enforced in
  verify-gate --poteau (S3.4b).
- **REMAINING (honest)**: full exit-gate + gatekeeper run-scoping (read by-session →
  <run_id>/run-state.json instead of flat .run/poteau/run-state.json) is the last T3
  piece — the seeder/dispatcher/verify side is run-scoped; the vendored hooks are still
  flat. Tolerated during the port (prompt-arm handles both). T7 (handoff-validate
  shelled with 10s timeout in the gatekeeper) is defense-in-depth on an already-
  fail-closed path — deferred to the port-completion pass. Neither blocks #29/#31/#7/#30
  closure (all proven).

## S3.5 manifest flips — correctly DEFERRED to merge (fail-honest)
The poteau gates (tool-gate/P402, exit-gate/P101, gatekeeper/P201-204) are hook-CAPABLE
but NOT active until the operator merges the lattice (runbook, operator-gated). Declaring
them "hook" in hardness-manifest.json now would violate the fail-honest doctrine the cycle
is built on ("declare reality, not aspiration"). The flip ships WITH the merge-for-keeps
(post-S3.3), each entry citing its demo benchmark (G-5 standing rule). loa-tool-mandate's
successor relationship (advisory→poteau tool-gate) is the headline flip when it lands.
