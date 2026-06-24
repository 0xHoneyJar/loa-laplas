# Gate Honesty — the axes of a trustworthy gate

> The synthesis above three fixes (poteau #67/#68 forgeable, #69 honest-exit, and 9x7). Each looked
> like its own bug. They are faces of one property: **a gate is honest only if it tells the truth in
> every direction at once.** A gate that fails any one axis is not strict — it is broken in a way
> that *looks* like strictness. Composes with `the-forgeable-gate.md`. *(Began as a triad; a
> completeness audit — 2026-06-24 — added a fourth, GROUNDED, the Trusting-Trust axis the original
> doctrine named but never axiomatized. The honest framework grows when refuted.)*

A gate stands between an agent and a capability. It is **honest** when all of these hold:

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
> the builder wrote (Trusting-Trust). Also: the verify anchor is agent-substitutable (no pinned
> maintainer root, unlike `legba-core verifyRun`). (`receipt.run_id` was likewise unbound to its run
> dir — cross-run replay — but that is **FIXED** here, PR #71, bead `zeo` closed.) Tracked: beads
> `kdm` (critical), `zss`. Until they land, treat
> poteau's axis-1 claim as **aspirational** — the scaffolding fails closed (safe), but it does not
> yet make a pass unforgeable on a single-user host. *Naming the gap is itself axis-1 honesty.*

### The threat-model reckoning — what "unforgeable" actually means here *(added after the trust-lens audit)*

The audit forced the question axis 1 never stated: **unforgeable against whom?** Grounding the
answer in poteau's code, its trust is *layered*, and only one layer is cryptographic:

- **The gate's INPUTS** (`run_state.task`, `mandated_reads`, reviewer **public** keys) live in the
  agent-writable `.run/poteau/<run>/` and are defended by the **tool-gate hook** (P402) — a
  *positional* defense. loa's own docs call hooks "a fence against routine mistakes, NOT a
  hardened security boundary," and the gatekeeper's own comment admits it "cannot distinguish the
  executor from a run-participant subagent (same user, same tree) — FORM, not substance." So
  **G2 (task) and G3 (grounding) are satisfiable by a same-uid agent that writes the right
  `run_state`** — they trust agent-assembled state, not independently re-established fact.
- **The gatekeeper's own G5 signing key** (custody, `kdm`): currently non-functional, and even
  working, custody of the *key* is not custody of the *decision* — the agent makes the *legitimate*
  gatekeeper sign a forged-but-self-consistent packet. Key custody is necessary, never sufficient.
- **The one cryptographic anchor is G4 council**: a PASS on a council surface requires Ed25519
  signatures from reviewer **private** keys the agent cannot reach. This is sound **iff those
  private keys are genuinely out-of-band** (a different uid / machine / the council runner) — not
  merely hook-protected on the same box.

**The honest claim, then:** poteau is unforgeable against an **external** adversary (other users,
remote callers, accidental key leakage) across the board; against a **same-uid agent** (the agent
*is* the user on a dev box) it is unforgeable **only on the G4-council surface, and only with
out-of-band reviewer keys** — everything else is a positional fence. The whole `the-forgeable-gate`
slogan ("a gate an agent can satisfy by emitting the right bytes is not a gate") indicts poteau's
*own* G2/G3 under the same-uid model. The real cure is not more key custody — it is **independent
verification** (the substrate re-establishes the fact itself: legba's `sign-gate` replays the run;
settle re-derives the tier; the gatekeeper would have to read the actual files, not the echoed H1).
That is the ACVP thesis poteau half-implements. Naming which deployment poteau is for — and that
G2/G3 are positional under same-uid — is itself the axis-1 honesty the doctrine owed.

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

## 4. Grounded — the gate's own checks are *reproduced, not vouched* *(check-provenance integrity)* — added after a *completeness* audit

The triad reckons with *who can forge a pass* (unforgeable), *who gets deadlocked* (exitable), and
*who gets falsely armed* (truthful-state). A completeness audit (a four-lens panel — Ken Thompson,
Satoshi, Vitalik, Euler — convened to *refute* the triad, 2026-06-24) found the gap all three share:
**none of them reckons with *what the gate trusts to decide*.** Every one assumes the gate's own
machinery is sound — that `verify()` verifies, that the bytes it signs are the bytes it means, that
the pinned root is pinned, that the test attesting "the gate is wired right" is *true*. That
assumption is exactly Thompson's compiler.

A gate can pass axes 1–3 perfectly and still lie, because its verdict is honest *relative to a check
that was vouched, not reproduced.* This holds the **agent innocent** and asks whether the **check** is
what it claims. Different liar (the builder / a dependency / the compiler — not the gated agent),
different victim (the auditor and every substrate that *composes* this gate — the Descent's "inherit
custody for free" is also "inherit any TCB compromise for free"), different symptom: a **silent
false-green**, not a leak or a deadlock. The most dangerous mode, because source-reading the gate, the
test, and the chain all look correct — it is caught **only by re-executing the check from
independently-built tooling.**

Grounded in this repo (verified, not asserted):
- **The mock (the purest instance).** The #67 "custody verified" test was a builder-written mock; the
  real shipped daemon ignores `req.token` and replays the run dir, so it *rejects* poteau's payload.
  The green test certified a custody path that does not exist — `kdm`, reproduced. **The doctrine
  itself labeled this "(Trusting-Trust)" and then gave it no axis.** This is that axis.
- **The floor is a file.** legba's praised "pinned maintainer root" resolves by default (via
  `operatorRootDir()`, `legba-core.mjs:179-181`) to a path *under the agent's own `~/.config/loa/`* —
  a *same-uid-writable* location, not a compiled-in constant; `isInsideRepo` forbids only the repo
  tree. The regress bottoms out at a file the agent owns, never at a reproduced root. (As of writing
  the file does not even exist — the rooted verify is *unprovisioned*, the audits' other finding — so
  the floor is not just agent-writable, it is *absent*: strict verify fails closed, never certifies.)
- *(One panel sub-claim corrected on verification — applying this very axis to the audit: legba's
  canonicalizer is an **inline RFC-8785 SUBSET**, not the npm `canonicalize` dependency the lens
  claimed. Reproduced, yes — but a non-conformant subset that drifts silently across runtimes. A
  GROUNDED concern of a different flavor, not the one asserted.)*

**The cure** is `proof_class` pushed one level down: make the gate carry, in its verdict, whether its
*own* verifier / canonicalizer / trust-root / attesting-test were **reproduced** (compiled-in or
content-addressed, re-derivable by hand), not vouched — and never let a builder-supplied mock stand
in for re-execution against the real thing. *(This whole session is the worked example: the gate I
built lied to me through a mock, and only re-running against the real daemon caught it.)*

> **Frontier (candidate axes the same panel raised, not yet canonized — pending grounding):**
> **Faithful** (Goodhart — the gate's *measure* tracks the good it guards; poteau's G3 honestly
> reports "H1 echoed," which is not "grounded"); **Auditable** (a true verdict must be cheaply,
> portably re-checkable by a third party); **Fresh-and-Bound** (honest at decision time, a lie after
> revocation / expiry / replay). Each got majority cross-lens support; none is yet reproduced in a
> repo gate the way GROUNDED is. Named here so the next instance is recognized, not canonized so the
> doctrine over-claims its own completeness — which would itself be a GROUNDED failure.

## Why the axes are one thing

| Axis | Lie it prevents | Victim | Failure looks like |
|------|-----------------|--------|--------------------|
| Unforgeable | "I passed" (when I didn't) | the system | a leak |
| Exitable | (forced) "I completed" / silence | the honest agent | a deadlock |
| Truthful-state | "this session is in run X" | a bystander session | a deadlock for the uninvolved |
| **Grounded** | "the check I ran is the check I claim to run" | the auditor / the composer | **a silent false-green** |

Forge, deadlock, and false-green are the same disease seen from different sides — **a gap between
what the gate *says* and what is *true*.** A forgeable gate says "pass" louder than the truth; a
deadlocking gate says "not done" louder than the truth; a false-arming gate says "you're in this"
louder than the truth; an **ungrounded** gate says "verified" louder than its own machinery can
prove. Close all the gaps and the gate becomes what it claims to be: a place where the substrate's
word and the world's state are the same word.

That is the whole of the ACVP thesis, stated as a property of a single gate: *agents reason,
the substrate verifies, and the substrate never says anything it cannot prove* — about a pass,
about an exit, or about who is standing at the door.
