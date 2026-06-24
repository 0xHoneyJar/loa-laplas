# The Forgeable Gate — a vulnerability class in agent substrates, and its cure

> Distilled 2026-06-23 from three independent instances in the brakes layer (legba, poteau,
> settle). Not a bug report — a **name** for a class, so the next instance is recognized on
> sight instead of rediscovered by hand. Reflex: `scripts/brakes-forgeable-scan.mjs`.

## The one sentence

**A gate is forgeable when its authority is *positional* (something the agent can reach or
write) rather than *cryptographic* (a signature it cannot produce without a key it does not
hold).** A gate an agent can satisfy by *reasoning* — by emitting the right bytes — is not a
gate. The substrate must demand a key, not a shape.

This is the dark twin of the ecosystem's own thesis (ACVP: *agents reason · substrate verifies ·
hashes prove · tests bind*). Every forgeable gate is a place where the substrate stopped
verifying and started trusting.

## The three forms (each seen, each real)

### Form A — Mint residue (the signing key is agent-readable)
The gate signs its pass with a private key that lives where the work agent can read it — a
file under `.run/`, the working tree, a `0o600` file owned by the *same user the agent runs as*.
The agent reads the key and self-mints a valid pass.

- **poteau** (`poteau-gatekeeper.mjs`, pre-#67): signed the G5 receipt with `.run/poteau/gate.key`.
  The gatekeeper *enforced this very rule on council keys* ("if a deployment writes private keys
  into the agent-readable run dir, forgery returns") and broke it on its own.
- **legba**: the on-disk-key residual its signer daemon was built to close.
- **Cure:** custody separation — a signer daemon holds the key in-memory, off the agent's
  filesystem; the gate *requests* a signature it cannot compute itself. Fail closed when custody
  is required but absent (never fall back to an on-disk key).

### Form B — Structure-only verify (the signature is never checked)
The verifier checks *shape* — the chain links, the hash, the required fields — but never calls
`verify()` on the signature. A chain-valid artifact with **no valid signature at all** passes.
This is the more dangerous form: forging needs *no key* — just well-formed JSON.

- **poteau** (`compose-verify-run.sh --poteau`, pre-#67): verified `prev_receipt_hash` linkage,
  never the receipt's Ed25519 signature. The signature was decorative.
- **Cure:** verify every signature against a *trusted* public key (a custody daemon's, which the
  agent cannot substitute — not an agent-writable `.pub`). Linkage proves order; signatures prove
  authorship; you need both. (`poteau-verify-receipts.mjs`.)

### Form C — Positional pass (a pass hinges on a field the agent writes)
The decision turns on a value the agent itself emits — a verdict string, a `self_reported_tier`,
a council `reviewer_id` that is just text. Forging the string is trivial.

- **settle** encodes the cure as counter-examples: `verifyToEarnedTier` never reads
  `self_reported_verdict`; the council gate counts *distinct Ed25519 signatures from provisioned
  reviewer keys*, not fabricable reviewer strings; the capability is trapped in a closure (A-4).
- **Cure:** the decision must read only signed/independently-recomputed evidence — never a
  producer's self-report.

## The cure, in one shape

> **Hold the key off-agent. Verify the signature against a key the agent cannot substitute.
> Decide only on evidence the agent could not have forged.**

settle (composing legba), and poteau after #67, are the worked examples. This is also why the
Descent matters: a substrate that *composes* the kernel's one signer (legba) inherits unforgeable
custody for free, instead of re-implementing — and re-breaking — it.

## The reflex

`node scripts/brakes-forgeable-scan.mjs` sweeps the brakes layer (poteau, legba, settle,
compose-*) for Forms A and B — agent-readable signing keys, and verify contexts with no
signature check. It surfaces candidates for adversarial triage (it is a reflex, not a proof);
A-class findings exit non-zero. As of 2026-06-23, post-#67: **0 candidates** — the layer is clean.

The point of a name is that the *next* substrate to descend gets scanned before it ships, and the
next reviewer reads "Form B" instead of rediscovering, by hand, that a chain check is not a
signature check.
