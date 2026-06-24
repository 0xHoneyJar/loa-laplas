# The Honesty of Gates

*A portable framework for trustworthy gates in agent substrates, and the method that found it.
Extracted from a single session's work on the Loa brakes layer (2026-06-24), written to stand on
its own — no knowledge of that codebase assumed.*

---

## The problem

An autonomous agent does work and then claims it: "I passed the check," "I'm done," "this is
verified." Between the agent and the capability it wants sits a **gate** — a check that is supposed
to let the truth through and stop the rest. The whole promise of an agent substrate rests on those
gates meaning what they say.

The usual way to think about gate security is *can the adversary get through?* That question is
real, but it is one question. A gate can be perfectly impassable to an adversary and still **lie** —
in directions the "keep the bad guy out" frame never looks. The honesty of a gate is larger than its
strength.

Here is the larger frame, in one sentence: **a gate is honest exactly when what it says and what is
true are the same word.** Every way a gate can be untrustworthy is a *gap* between those two — and
the gaps come in distinct shapes, each with a different liar, a different victim, and a different
symptom. We found five.

## The five axes

**1. Unforgeable** — *the adversary cannot fake a pass.* Authority must be **cryptographic** (a
signature over a key the agent cannot reach), never **positional** (a value the agent can write).
The lie it prevents: *"I passed"* when it didn't. Victim: the system. Symptom: a leak. — The
classic axis, and the only one most security models name.

**2. Exitable** — *the honest agent always has a truthful door.* A gate whose only exit is "assert
you completed" forces an honest agent that *isn't* completing (a recon pass, an abort, a no-op) to
either lie or deadlock. Strictness without a truthful door is not strictness — it is a trap. The
lie it prevents: a *coerced* "I completed." Victim: the honest agent. Symptom: a deadlock. The cure
is a sanctioned non-completion verdict that grants nothing but lets honest work stop cleanly.

**3. Truthful-state** — *the gate never claims a state it isn't in.* It must not assert that a
session is *participating* in a run it never entered, or armed when it isn't. The lie it prevents:
*"you're in this"* (to someone who isn't). Victim: a bystander. Symptom: a deadlock for the
uninvolved. The cure is to bind state to *entry*, not to proximity — the link is written when the
work actually happens, never when something merely looks like it might.

**4. Grounded** — *the gate's own checks are reproduced, not vouched.* The first three axes all
silently assume the gate's *machinery* is sound — that its verifier verifies, its canonicalizer
canonicalizes, its trust-root is pinned, the test attesting "this is wired correctly" is *true*.
That assumption is Ken Thompson's compiler. A gate can pass axes 1–3 perfectly and still lie,
because its verdict is honest *relative to a check that was asserted by its builder, not
reproduced.* This holds the agent **innocent** and asks whether the **check** is what it claims.
Different liar (the builder, a dependency, the compiler), different victim (the auditor who reads
the green, and everyone who *composes* this gate and inherits its compromise for free), different
symptom: a **silent false-green** — the most dangerous mode, because source-reading the gate, the
test, and the chain all look correct. Caught only by re-executing the check from independently-built
tooling. The cure: make the gate carry, in its verdict, whether its own machinery was *reproduced* —
and never let a builder-written mock stand in for re-execution against the real thing.

**5. Faithful** — *what the gate measures is the good it guards.* A gate can be unforgeable,
exitable, truthful-state, and grounded — and still lie, because the thing it honestly checks is a
**proxy** for the thing its pass *implies*. It tells the truth about its measure; the lie is in the
gap between the measure and the meaning. (Goodhart's law: when a measure becomes a gate, it stops
being a good measure.) A gate that demands you *quote* a document's first line to prove you *read*
it is honest about the quote and silent about the reading. The lie it prevents: *"I verified the
good"* when it verified a proxy. Victim: whoever relies on the gate's *purpose*. Symptom: a
Goodharted pass — true measure, wrong meaning. The cure is to re-establish the good directly rather
than accept a fabricable stand-in for it.

| Axis | The lie | Victim | Symptom |
|---|---|---|---|
| Unforgeable | "I passed" | the system | a leak |
| Exitable | (coerced) "I completed" | the honest agent | a deadlock |
| Truthful-state | "you're in this" | a bystander | a deadlock for the uninvolved |
| Grounded | "the check I ran is the check I claim" | the auditor / composer | a silent false-green |
| Faithful | "what I measured is the good I guard" | whoever trusts the gate's purpose | a Goodharted pass |

Forge, deadlock, false-green, Goodhart — the same disease from different sides. Close every gap and
the gate becomes what it claims to be.

## The method (the part that matters more than the list)

The five axes are not the contribution. **Any list of axes is a claim, and a framework that asserts
its own completeness is committing axis 4's sin against itself.** The contribution is the *method*
by which the list earned the right to exist — and the rule that governs whether it may grow.

It went like this. The framework began as three axes, derived from fixing three bugs. To test
whether three was *enough*, we did not introspect — we **convened a panel to refute it.** Four
independent critical lenses (three cryptographers and, deliberately, one mechanism-design theorist
so it wasn't an echo chamber) were each charged: *find a way a gate can lie that these three axes do
not name, or prove them exhaustive.* Each proposed axis was then cross-examined by the others, the
bar being that a gate must be able to *fail it while passing all the rest.*

They found the fourth axis — **and it was the author's own central mistake.** Earlier that same
session, a test had certified a custody mechanism "verified"; the test was a mock the author wrote,
signing a contract the real system rejects. The green attested a path that did not exist. The
original doctrine had even *named* this failure in passing — "(Trusting-Trust)" — and then given it
no axis. The jury found the hole in the framework by pointing at the framework-builder's own wound.

So the governing rule wrote itself: **the framework grows only by reproduced evidence. A candidate
axis graduates from "named" to "canonical" the moment a *real* gate is caught failing it while
passing all the others — never a moment sooner.** The fifth axis (Faithful) graduated exactly that
way, days later, when a real grounding-check was caught measuring a proxy, with the gate's own code
comment as the confession. Two further candidates (a verdict must be cheaply re-checkable by a third
party; a verdict honest now must not become a lie after revocation or expiry) remain **named but not
canonical** — no reproduced instance yet. They wait. Naming them is recognition; canonizing them
without evidence would be the very over-claim axis 4 forbids.

## Why this is the strongest thing the framework can say about itself

A framework that grows by argument can rationalize anything. A framework that grows only when a real
artifact is *caught* failing a candidate axis cannot inflate, because the world has to cooperate.
Its discipline is external. The most trustworthy property of this account of gate honesty is not any
single axis — it is that **the account is held to its own standard.** While writing the fifth axis,
the author referenced a tracking item that did not exist; that is a *grounded* failure, in the
document that defines *grounded*; it was caught and corrected, with a note that "the discipline
doesn't get to be ironic." The doctrine is not something written *about* the gates. It is something
the gates, and the writing about the gates, keep having to *pass*.

That is the whole of it, stated as a property of a single gate: **agents reason; the substrate
verifies; and the substrate never says anything it cannot prove** — about a pass, an exit, who is at
the door, its own machinery, or the meaning of what it measured. A gate that holds all five is not
merely strong. It is honest. And a framework that found them by hiring its own critics, and grows
only when caught, is the closest a builder can come to honesty about *the gates themselves.*
