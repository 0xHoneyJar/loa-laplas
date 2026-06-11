# Legba — the runnable operator substrate

Cryptographic validation of agentic state transitions, file-backed and runnable
today. Spans propose, gates validate, ed25519 tokens carry custody, the run
compiles to one verifiable receipt hash. Zero dependencies (`node:crypto` +
`node:fs`).

> **Status: PROVISIONAL.** Schema shapes (SpanMove / GateToken / RunReceipt)
> track [loa-hounfour#118](https://github.com/0xHoneyJar/loa-hounfour/pull/118);
> `contract_version` and field names follow that proposal until it merges. This
> is the rungs-2–5 vertical slice (recorder · gatekeeper · turnstile ·
> verify/challenge) collapsed into a usable CLI so the operator can rely on it
> before each rung ships its own governed cycle.

## What you can do right now

```sh
node scripts/legba/legba.mjs demo          # full lifecycle + 3 attacks, on real files
```

That prints: a run recorded → gated → verified, then three attacks each caught —
**tamper** (chain break), **forged token** (signature invalid), **confabulated
output** (fraud proven by re-execution) — and the honest boundary (an attestable
emission cannot be replayed). Every one of those is an assertion in
`legba.test.mjs` (`node --test scripts/legba/legba.test.mjs`, 8/8).

## The two verbs you rely on

```sh
# verify any run dir — third party, public key only. exit 0 = ok, 1 = failed.
node scripts/legba/legba.mjs verify <run-dir>

# fraud-proof a single re_executable move by re-execution. exit 0 = honest, 1 = fraud/refused.
node scripts/legba/legba.mjs challenge <run-dir> --span N --seq K
```

`verify` walks the token custody chain (signature → custody → span-head replay →
artifacts present → verdict), replays every span's hash chain, and recomputes the
run receipt hash. A third party needs only the run directory and the gatekeeper's
public key (published in the run's `manifest.json`).

## Building a run by hand

```sh
node scripts/legba/legba.mjs provision my-run --run-dir /tmp/my-run --gatekeeper legba:me
node scripts/legba/legba.mjs record /tmp/my-run --span 0 --tool arith \
  --input '{"expr":"(10 + 5) * 2"}' --output '{"result":30}'
node scripts/legba/legba.mjs record /tmp/my-run --span 0 --emit reasoning \
  --content '{"note":"computed the total"}'
node scripts/legba/legba.mjs gate /tmp/my-run --gate 0 --artifact '{"answer":30}'
node scripts/legba/legba.mjs verify /tmp/my-run
```

## Run-dir layout (LG-10: one canonical, root-independent address)

```
<run-dir>/                  default ~/.loa/runs/<run_id>/
  manifest.json             run_id, gatekeeper pubkey + key_id, contract_version
  cas/<sha256>.json         content-addressed input/output/emission bodies
  spans/span-N.log.jsonl    the hash-chained move log per span
  tokens/token-N.json       sealed gate tokens (the custody chain)
```

Keys live in `~/.config/loa/audit-keys/<gatekeeper>.{priv,pub}` (mode 0600); the
public key is copied into the run manifest so the run dir verifies on its own.

## Re-executable tools (the replay registry)

`tools.mjs` holds the first re_executable tools: a restricted arithmetic
evaluator (eval-free, recursive-descent) and a parametric damage formula —
pure, deterministic, no clock/network/randomness, the same posture as gygax's
augury family. To register a real tool: add `name → pure fn(input)→output`. A
tool with nondeterministic inputs MUST be recorded `attestable`, never here
(LG-5) — misclassification is the substrate's one integrity lie.

## What's still wiring (honest)

- **Involuntary capture**: `legba-record-hook.mjs` is the PostToolUse hook shape
  (LG-1: recording must be hook-enforced, not voluntary). Wiring it into the
  compose-dispatch executor sequence — so every Form C segment records + gates +
  turnstiles automatically — is the integration step that makes the gradient
  flip (the governed path becomes the cheapest path). Today the CLI is driven
  explicitly; the hook makes it structural.
- **compose-verify-run chain extension**: `compose-verify-run.sh:41-49` reserves
  the inter-envelope hash chain; pointing it at `legba verify` is the final seam.
- **Full RFC-8785 JCS**: the canonicalizer here is the documented subset (flat
  shapes only) — swap before cross-runtime producers appear.
- **Cross-field validators in hounfour**: the constraint files + cross-field
  vector corpus are in PR #118; the validator implementations land post-merge.

## Provenance

Adapted from the operator-supplied reference (`legba-substrate/src/legba.mjs`).
Design: `loa-freeside` `grimoires/loa/{prd,sdd,sprint}.md` (Flatline-reviewed).
Motivating evidence: the `playtest-the-territory` run that measured the gap this
substrate fills (`grimoires/loa/context/2026-06-11-playtest-the-territory.md`).
