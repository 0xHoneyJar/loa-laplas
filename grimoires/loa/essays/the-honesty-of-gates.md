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

Here is the larger frame: **a gate is honest when its verdict and the truth do not diverge.** Most
divergences are the gate *asserting* something false — but not all: one of the five (Exitable) is
the gate asserting nothing false and instead *withholding the truthful verdict the agent needs*,
forcing the lie onto the agent. So the frame is not perfectly uniform — a critic was right to catch
that the slogan "what it *says* vs what is true" fits four of the five and strains on the second (see
the receipt at the end). Read it as the *spine*, not a theorem: each axis is a distinct way verdict
and truth come apart, each with a different liar, victim, and symptom. We found five — three peers
and, the critic insisted and I agree, two that are better understood as *operators on the other
three* than as coordinates beside them.

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
independent critical lenses — three steeped in cryptographic and trusted-systems rigor (compiler-
trust, consensus, verification economics), and, deliberately, a mechanism-design theorist so it
wasn't an echo chamber — were each charged: *find a way a gate can lie that these three axes do
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

## What the framework can — and cannot — say about itself

A framework that grows by argument can rationalize anything. This one's axis *count* cannot inflate:
a candidate becomes canonical only when a real artifact is *caught* failing it while passing the
rest, so the world has to cooperate. That discipline is external — but it gates **only the count.**
Everything else here — the unifying frame, the cures, the victim/symptom table, the word "axes," and
every superlative — grew by argument, carries no reproduced receipt, and should be priced
accordingly. An earlier draft draped the count's credibility over that ungated prose; that was *this
document* committing axis 5's sin — a true measure (a disciplined axis count) standing in for a
larger meaning (a disciplined account) it had not earned. This sentence is the correction.

The one reflexive self-catch the work actually *reproduced* is narrow and real: while writing the
fifth axis, I referenced a tracking item that did not exist — a *grounded* failure, in the document
that defines grounded — and corrected it, noting that the discipline doesn't get to be ironic. That
is one axis caught once, not the whole account vindicated.

So the honest claim is small: **agents reason; the substrate verifies; and the substrate should say
only what it can prove** — about a pass, an exit, who is at the door, its own machinery, or the
meaning of what it measured. A gate that holds all five is not finished — two candidate axes remain
named-without-evidence, and a gate could close five and still lie by expiry. It is only *more honest
than a gate that holds one.* And a framework that found its axes by hiring critics, and revises when
caught, is not the truest possible account of gate honesty — it is one that has, so far, changed
every time it was refuted. Including this essay.

---

## Receipt: this essay was refuted (axis 4, applied to itself)

The essay argues you should hire critics to refute your own framework, so it was put to its own
method — a summoned adversarial critic reviewed it against its own axes 4 (Grounded) and 5
(Faithful). It found, correctly:
- **The framing wears the axis-list's credibility.** "Cannot inflate" was true of the axis *count* and
  false of the prose; the draft then inflated with superlatives. *(Scoped, above.)*
- **The unifying frame strains on Exitable** — whose lie is coerced onto the agent, not asserted by
  the gate; the "(coerced)" parenthetical was the seam. *(The frame is now the spine, not a theorem.)*
- **Grounded and Faithful are not peers of the first three** — they are *operators* that apply to all
  the others and to each other (an Unforgeable check is worthless if un-Grounded; a reproduction run
  can itself be Goodharted). The table flattened a meta-axis into a coordinate. *(Read 1–3 as
  first-order, 4–5 as operators on them.)*
- **The jury and the independence test are vouched, not reproduced** — the essay asserts the panel
  cross-examined each axis "while passing all the rest," but never *shows* the pairwise-independence
  construction. By axis 4's own rule, take that on the builder's word, discounted accordingly.

What it praised — the named-vs-canonical promotion discipline, reproduced for axes 4 and 5, with the
two further candidates correctly held uncanonized — is the real contribution, and it passes its own
standard.

You are reading the second draft. The first failed its own test. That failure-and-revision is the
only endorsement this method can honestly offer — and the only one consistent with what it claims.
