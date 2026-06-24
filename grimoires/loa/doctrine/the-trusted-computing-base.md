# The Trusted Computing Base — where "verify the verifiers" stops

> The terminal companion to `gate-honesty.md`. The session's deepest move was to stop verifying the
> *work* and start verifying the *verifiers* (axis 4, GROUNDED). But that recursion cannot go forever:
> you verify the verifier; then who verifies *that*? It has to bottom out at a floor you **trust
> without checking, because checking it would require trusting something else.** That floor is the
> Trusted Computing Base. A layer is only as honest as its TCB is *minimal* and *reproduced* — and you
> cannot reason about either until you have **named** it. This is the brakes layer's, grounded in code.

## The principle

GROUNDED (the gate's checks are reproduced, not vouched) is **recursive**: a verifier is only sound
if its own verifier is reproduced, and so on down. The recursion is not a regress to despair — it
**terminates**, at the smallest set of things you accept on faith. Thompson's lesson: the danger is
not that a TCB exists (one always does) — it is an **un-named** TCB, because then you trust things you
never decided to trust. So: name the floor. Then make it as small and as reproduced as it can be.

## The floor of the brakes layer (poteau · legba · settle), grounded

| Floor | What it is | Reproduced or vouched? | Verdict |
|---|---|---|---|
| **`node:crypto`** | every signature, hash, keypair (`sign`/`verify`/`createHash`/`generateKeyPairSync`) | **vouched** — the Node binary + OpenSSL + the OS | **Bedrock. Correct place to stop.** You cannot reproduce crypto without a trusted compiler and OS — that is Thompson's *actual* point, and the brakes layer rests on a standard, widely-audited primitive. Accept it; just *name* it. |
| **the canonicalizer (`jcs`)** | the bytes every signature is computed over | **reproduced** — inline, in-tree, re-derivable by hand (3 production copies: legba's exported one + two poteau inline; **0** npm `canonicalize` deps) | **Soft → HARDENED.** It is an explicit **RFC-8785 *subset*** (`legba-core.mjs:39` says so), copied across the layer, so it could silently disagree across runtimes or drift between copies — and a silent change breaks every signature. Now guarded: `scripts/legba/jcs-boundary.test.mjs` **freezes** legba's output (a signature-invalidating change fails) and **drift-guards the real production copies — loaded from their source files — against it** (BB #77 caught an earlier version checking a fresh in-test copy, which proved nothing), and makes the **subset boundary explicit** (reproduced in a test, not vouched in a comment). The silent-drift risk on the production copies is closed; the cosmetic cure (one shared module) remains. |
| **the trust anchor (maintainer root)** | the key the rooted trust-store is verified against | **vouched + absent** — the path `defaultPinnedRootPath()` constructs under `operatorRootDir()` (`legba-core.mjs:179-181`), a same-uid file that, as of 2026-06-24, **does not exist** | **Softest.** The rooted-verify floor is a file the agent owns *and* that is unprovisioned. Until a real out-of-band root is provisioned, strict verify fails closed (safe) but never certifies. This is where "verify the verifiers" finds sand. *(Beads `zss`/`fgl`; the worked cure is `scripts/trust-root-proof.mjs`, which shows the floor IS solid once the root is real.)* |
| **the signer daemon (custody mode)** | the process that holds the gatekeeper key off-disk | **vouched** — a spawned same-uid process (`legba-signer-daemon.mjs`) | **Soft by deployment.** On a single-user box the daemon shares the agent's uid, so custody moves the key off the *filesystem* but not out of *reach* (the threat-model reckoning). Solid only across a uid/machine boundary. |

> **A note this document could not have scripted.** On save, the repo's own `ground-check` hook
> flagged the anchor path above as *not resolving* — because the file does not exist. The tool whose
> one job is to verify references **independently confirmed this doc's central claim** (the trust
> floor is absent) by refusing to find it. A verifier verified the verify-the-verifiers doc, in the
> act of writing it. That is the whole framework — recursion, reproduction, and being caught — in one
> accidental loop; left here on purpose. *(And then BB caught the drift-test checking a fresh copy
> instead of the real ones — the same lesson, one layer out, fixed in the same PR. It does not stop.)*

## The honest finding

The recursion does **not** bottom out in sand all the way down. **`node:crypto` is bedrock** — the
right, standard place for the floor to be. But between the gates and that bedrock sit two soft layers:
a canonicalizer that is *reproduced but non-conformant and copied*, and a trust anchor that is
*vouched and absent*. The brakes layer's honesty is therefore capped not by its gates (which this
session hardened across five axes) but by **the last few feet above bedrock** — exactly the part no
gate looks at, because every gate assumes it.

That is the whole of the session, stated one final way. We verified the work, then verified the
verifiers, and the verifiers led down to a floor. The floor is mostly stone. The two soft spots are
named now — `jcs` conformance + the provisioned root — and a named soft spot is a fixable one. *An
un-named floor is the only kind you can't stand on.*
