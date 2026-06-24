# Settle Trust-Root Audit — trust-lens construct panel (2026-06-24)

Second in the trust-substrate sweep (after poteau). The panel (Ken Thompson · Satoshi · Vitalik)
audited **settle** — the Descent's verify-then-proceed tier gate — hunting the classes poteau just
failed. Each sharp finding cross-examined by a second lens; the actionable one reproduced by hand.

**Verdict: `weak`, NOT broken** — and that distinction is the result. Settle is a sound primitives
library where poteau was a forged claim; its *gaps* are at the trust root and the embedder seam,
not in the crypto.

## What settle gets right (reproduced PRAISE — keep)
- **Real legba composition, not a mock.** Every import (`jcs/sha256/hashObj/sign/verify`) genuinely
  exists in `legba-core` with matching signatures; the sign→verify roundtrip works; 40/40 tests
  green. This is exactly where poteau failed (a mock signing a daemon contract that didn't exist).
- **The determinism-map pin (SKP-003) is reproducible + load-bearing** — recomputes byte-for-byte
  to the pinned sha; a tampered map throws. Trust-by-reproduction done right.
- **`verify()` independently re-derives the tier and ignores `self_reported_*`**; `checkSync`'s
  signature check is unconditional and fail-closed, with a negative-control test proving it
  load-bearing. No Form-B structure-only-verify hole.

## Findings
- **Tier over-claim (HIGH, reproduced) — FIXED this PR.** `checkSync` read `earned_tier` straight
  off the signed snapshot and decided on it, never re-deriving from the verdict. A signed
  `{verdict:'PENDING', earned_tier:'settled'}` *proceeded* in a must-settle (`money/**`) domain.
  The binding lived only in `verify()`, not at the gate. Fix: the gate now re-derives
  `verdictToEarnedTier(snap.verdict)`, denies an over-claim, and fails closed on a verdict-less
  snapshot. 3 tests; 40 existing still green. *verify-then-proceed means the gate re-derives.*
- **Trust root unfilled (HIGH) — bead `fgl`, tracked.** `config.trustedVerifierPublicKey` is a
  bare caller parameter with no resolver; settle composes legba's crypto but never its pinned
  maintainer-root trust-store (`resolveGatekeeperPubkey`, #59). The doctrine's "composes legba →
  inherits unforgeable custody for free" is asserted, not reproduced — settle inherits the math,
  not the anchor. Not agent-reachable today only because there is *no* path. (Same shape as poteau
  `zss` — provisioning-dependent.)
- **Key custody not composed (MEDIUM) — bead `udd`.** `signSnapshot` signs with a raw in-process
  privKey; the signer-daemon custody path is never on settle's route. "Custody lives in legba" is
  aspirational; the docstring admits it's the embedder's job. An embedder that loads the key into
  the agent process reintroduces Form A.

## Disposition
The tier-binding fix ships here (the one finding cleanly fixable without provisioning). `fgl`/`udd`
tracked — they need the rooted trust-store + an embedder, same deliberate territory as poteau's
`kdm`/`zss`, and the gate-honesty threat-model reckoning governs them. Settle earned its `weak`,
not a `broken`: the difference between a library whose crypto is real-but-unanchored and a gate
whose custody was a mock.
