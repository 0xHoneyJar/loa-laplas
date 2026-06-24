# Gate-Honesty Completeness Audit — is the triad exhaustive? (2026-06-24)

Not a code audit — a **framework** audit. A four-lens panel (Ken Thompson, Satoshi, Vitalik, and
Euler — a non-security mechanism-design lens, added so it wasn't an echo chamber of cryptographers)
was convened with one charge: **refute the gate-honesty triad.** Find a way a gate's word and the
world's state can diverge that *none* of unforgeable / exitable / truthful-state names — or prove
the triad exhaustive. Each proposed axis was then cross-checked by the other three (the bar: a gate
must be able to *fail it while passing all three*).

**Result: all four lenses agree the triad is NOT complete.** Four candidate axes surfaced. With
discipline (canonizing all four would be axis-inflation — the over-claiming the doctrine warns
against), exactly one was promoted; the rest are recorded as a named frontier.

## Canonized — the fourth axis: GROUNDED
*The gate's own checks are reproduced, not vouched (check-provenance / TCB integrity).* 3/3 peers
confirmed it irreducible. It holds the **agent innocent** and asks whether the **check** is what it
claims — was its verifier / canonicalizer / trust-root / attesting-test reproduced, or asserted by
its builder? Different liar (builder / dependency / compiler), different victim (the auditor and
every composer who inherits the green), different symptom (a **silent false-green**, not a leak or a
deadlock).

Why it earned canonization over the other three: it is **reproduced in this repo, and it is the
session's own central wound.** The `#67` "custody verified" test was a builder-written mock; the real
daemon rejects poteau's payload, so the green certified a path that does not exist (`kdm`). *The
doctrine itself labeled this "(Trusting-Trust)" and then gave it no axis.* The audit closed that hole
in my own framework. (Second confirmed instance: legba's "pinned root" floor resolves to a
same-uid-writable `~/.config/loa/` path, not a compiled-in constant — and is currently absent.)

**One panel sub-claim was corrected on verification** — applying GROUNDED to the audit itself: Ken
Thompson claimed the canonicalizer is the npm `canonicalize` dependency; it is in fact an *inline
RFC-8785 subset* (`legba-core.mjs:40`). Reproduced, but non-conformant — a GROUNDED concern of a
different flavor than asserted. Propagating the unverified claim would have been a GROUNDED failure.

## Frontier — candidate axes, named not canonized (pending repo grounding)
- **Faithful** (Euler — Goodhart/proxy integrity): the gate's *measure* must track the good it
  guards. poteau's G3 honestly reports "H1 echoed," which is not "grounded." (3/3 cross-support.)
  *→ Subsequently **GRADUATED** to a canonical 5th axis — see the Update below. Listed here as the
  panel's original disposition; no longer frontier.*
- **Auditable** (Vitalik): a true verdict must be cheaply, portably, independently re-checkable by a
  third party. (3/3.)
- **Fresh-and-Bound** (Satoshi — temporal): honest at decision time, a lie after revocation / expiry
  / replay; a verdict must bind its own validity window. (2/3 — weakest; may refine unforgeable.)

Auditable and Fresh-and-Bound are real candidates but not yet reproduced in a repo gate the way
GROUNDED is. Named so the next instance is recognized; *not* canonized, so the doctrine does not
over-claim its own completeness — which would itself be a GROUNDED failure. (Faithful was here too,
until G3 reproduced it — see the Update.)

## Update — Faithful graduated (the frontier process worked)
Shortly after, **Faithful** was promoted from the frontier to a canonical 5th axis — *by evidence*,
not assertion. poteau's own **G3 grounding check** is the reproduced instance, with the gate's own
confession in-code: it refuses unless the rationale *echoes* the mandated read's H1, while its
comment admits "this checks the H1 string was REPRODUCED, not that the document was read … a present
echo is necessary but not sufficient." The pass implies *grounded*; the gate verifies *echoed* —
Goodhart, admitted. That is the **same bar** that canonized GROUNDED, so the frontier rule fired
exactly as written: *a candidate graduates when a real gate is caught failing it while passing all
the others.* Cure tracked: bead `jr6`.

## Disposition
`grimoires/loa/doctrine/gate-honesty.md`: triad → tetrad → **pentad** (unforgeable, exitable,
truthful-state, **grounded**, **faithful**) — each axis earned by a reproduced in-repo instance, none
asserted. **Auditable** and **Fresh-and-Bound** remain frontier (no reproduced instance yet). The
framework grew because it was refuted — by a jury it summoned, on the evidence of its author's own
mistakes — and it grows *only* that way, which is the strongest thing it can say about itself.
