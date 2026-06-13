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
