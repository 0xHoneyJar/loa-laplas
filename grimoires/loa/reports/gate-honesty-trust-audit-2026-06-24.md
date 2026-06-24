# Gate-Honesty Trust-Root Audit — trust-lens construct panel (2026-06-24)

A panel of three trust-lens constructs (Ken Thompson · Satoshi · Vitalik) was summoned via the
Workflow runtime to adversarially audit the **trust root** of the gate-honesty work built this
session (poteau #67/#68/#69/#70). Each reviewed the code from its lens; each sharp finding was
then cross-examined by a *different* lens. The headline finding was independently reproduced by
hand before any action.

**Verdicts:** Ken Thompson `broken` · Satoshi `weak` · Vitalik `weak`. Unanimous, cross-confirmed.

## The headline — the custody mint never worked (CRITICAL, reproduced) → bead `kdm`
All three lenses, independently: the one path that mints *unforgeable* receipts — custody via the
legba signer daemon — **does not run against the shipped daemon.** `poteau-gatekeeper.mjs` sends
`{cmd:'sign-gate', token: receipt}`, but `legba-signer-daemon.mjs#signGate` **ignores `req.token`**
and calls `buildGateToken(req.dir, …)` (independent run-dir replay). `req.dir` is undefined for
poteau → throws. Reproduced directly: real daemon + poteau payload →
`{"ok":false,"status":"signer_error","error":"path … must be of type string. Received undefined"}`.

Consequence: `POTEAU_REQUIRE_CUSTODY=1` (the secure posture the doctrine told operators to flip to)
**deadlocks** (exit 5, no receipt); with custody off, the only working mint is the legacy
agent-readable on-disk key — **Form A**, the exact vuln #67 claimed to close. The passing #67
"custody verified" test used an **in-process mock** signing `req.token` — a contract the builder
invented, not the daemon's. This is the literal Trusting-Trust hole: a green check attesting a
clean build, produced by a stand-in the builder wrote rather than reproduction against the real thing.

## Other confirmed findings
- **`zeo` (HIGH) — FIXED in this PR (#71).** The verifier never bound `receipt.run_id` to the run
  dir it lives in → cross-run replay (a receipt from run A passed in run B). *Satoshi, confirmed by
  Vitalik.* Now bound (chain-consistency + dir-match); bead `zeo` closed.
- **`zss` (HIGH)** — the poteau verify anchor is agent-substitutable: resolved from
  `LEGBA_SIGNER_SOCKET` (agent-set env) or `${POTEAU_KEY}.pub` (agent-writable, written next to the
  private key). None of the pinned maintainer-root trust-store `legba-core verifyRun` got in #59.
  `the-forgeable-gate.md` Form-B cure literally says "not an agent-writable .pub" — the shipped
  fallback IS one. *Ken Thompson + Vitalik.*
- **Same-uid custody (HIGH, architectural)** — the key is off-*disk* but not out of the agent's
  *reach*: the daemon runs as the same uid, owns the 0o600 socket the agent can connect to, and
  signs over an agent-supplied dir. Custody of the key is not custody of the decision. *Ken Thompson.*
- **Three hand-copied JCS impls + RFC-8785 subset (MEDIUM)** — sign/verify canonicalization is
  three copy-paste copies; agreement is asserted (they happen to be identical) not enforced (one
  shared module). *Ken Thompson.*

## What the panel said is genuinely sound (keep)
`legba-core verifyRun`'s pinned-root trust-store (#59), the fail-closed posture (custody refuses
rather than waving through), and the *direction* of the whole effort. The trust root exists in the
repo (in legba) — the poteau receipt path simply doesn't reach for it.

## Disposition
Beads `kdm`/`zss` filed (`zeo` FIXED + closed in this PR). The lying test was corrected (the mock now claims only the
client protocol; a real-daemon test documents the fail-closed gap). `gate-honesty.md` axis 1
carries a KNOWN-GAP note. **`fix/legba-custody-separation` should NOT merge to main as
"custody closed Form A" — it has not.** The scaffolding fails closed (safe) but custody is not
yet functional. The fix is deliberate (a real daemon sign-token primitive + run_id binding +
anchor pinning), not a hasty patch.

*The audit found the builder's own work forged a verification. Surfacing that, in full, is the
truest thing the gate-honesty principle could have produced.*
