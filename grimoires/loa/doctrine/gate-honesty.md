# Gate Honesty — the three axes of a trustworthy gate

> The synthesis above three fixes (poteau #67/#68 forgeable, #69 honest-exit, and the open 9x7).
> Each looked like its own bug. They are three faces of one property: **a gate is honest only if
> it tells the truth in every direction at once.** A gate that fails any one axis is not strict —
> it is broken in a way that *looks* like strictness. Composes with `the-forgeable-gate.md`.

A gate stands between an agent and a capability. It is **honest** when all three hold:

## 1. Unforgeable — the adversary cannot fake a pass *(input integrity)*
A bad agent must not be able to produce a passing verdict it did not earn. Authority must be
**cryptographic** (a signature over a key held off-agent), never **positional** (a value the
agent can reach or write). See `the-forgeable-gate.md`: the key off-agent, the signature
verified, the decision read only from evidence the agent could not forge. *(poteau #67/#68.)*

> **KNOWN GAP — axis 1 is NOT yet achieved in poteau (trust-lens audit, 2026-06-24).** A panel
> (Ken Thompson / Satoshi / Vitalik) + direct reproduction found the custody mint **does not run
> against the shipped legba daemon**: the gatekeeper sends `{sign-gate, token}` but the daemon's
> `sign-gate` ignores `token` and does independent run-dir replay (`buildGateToken(req.dir,…)`),
> so poteau's payload throws — `REQUIRE_CUSTODY=1` fails closed (deadlocks), and the only working
> mint is the legacy agent-readable key = **Form A**. The #67 "custody verified" test was a *mock*
> the builder wrote (Trusting-Trust). Also unbound: `receipt.run_id` to its run dir (cross-run
> replay) and the verify anchor is agent-substitutable (no pinned maintainer root, unlike
> `legba-core verifyRun`). Tracked: beads `kdm` (critical), `zeo`, `zss`. Until they land, treat
> poteau's axis-1 claim as **aspirational** — the scaffolding fails closed (safe), but it does not
> yet make a pass unforgeable on a single-user host. *Naming the gap is itself axis-1 honesty.*

## 2. Exitable — the honest agent always has a truthful door *(exit integrity)*
A good agent that is *not* completing — a recon pass, an abort, an honest no-op — must have a
*truthful* way out. A gate whose only exit is "assert you completed in scope" forces an honest
agent to either **lie** (fake `in_scope`) or **deadlock** (wait for break-glass). Strictness
without a truthful door is a deadlock, not a brake. The cure is a sanctioned non-completion
verdict (`aborted`) that clears the *completion* gates and is **recorded as what it is** — an
abort, not a pass; it grants nothing downstream. *(poteau #69.)*

## 3. Truthful-state — the gate never claims a state it isn't in *(state integrity)*
The gate must not assert that a session is *participating* when it never entered. poteau's
`prompt-arm` adopts the most-recently-armed run for *any* `/compose`-ish prompt — so a session
that only inspected gets linked to a run it never ran a segment for, and then the exit-gate
demands a packet for work it never did. The gate lied about who was in it. The cure is
**arm-on-entry, not arm-on-prompt**: the session→run link is written when the session actually
does gated work, not when it merely types a command near an armed run. *(poteau 9x7 — fixed:
`prompt-arm` no longer forges the link from a most-recent-run heuristic; the dispatcher's gate 0,
the sole holder of both the real session id and the run_id, is the only writer. The hook now only
READS a link the dispatcher wrote. A recon session that never dispatches is never armed, never
deadlocks.)*

## Why the triad is one thing

| Axis | Lie it prevents | Victim | Failure looks like |
|------|-----------------|--------|--------------------|
| Unforgeable | "I passed" (when I didn't) | the system | a leak |
| Exitable | (forced) "I completed" / silence | the honest agent | a deadlock |
| Truthful-state | "this session is in run X" | a bystander session | a deadlock for the uninvolved |

Forge and deadlock are the same disease seen from two sides — **a gap between what the gate
*says* and what is *true*.** A forgeable gate says "pass" louder than the truth; a deadlocking
gate says "not done" louder than the truth; a false-arming gate says "you're in this" louder
than the truth. Close all three gaps and the gate becomes what it claims to be: a place where
the substrate's word and the world's state are the same word.

That is the whole of the ACVP thesis, stated as a property of a single gate: *agents reason,
the substrate verifies, and the substrate never says anything it cannot prove* — about a pass,
about an exit, or about who is standing at the door.
