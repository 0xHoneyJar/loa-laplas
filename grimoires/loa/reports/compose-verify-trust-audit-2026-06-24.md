# compose-verify-run Trust-Root Audit — trust-lens panel (2026-06-24)

Third and apex of the trust-substrate sweep (poteau → settle → here). The panel audited
**compose-verify-run.sh** — the *top-level* proof-of-run gate whose `valid_run` verdict every
downstream consumer trusts. 15 agents (3 review + 12 cross-examine). The critical finding reproduced
by the panel and confirmed at the source by hand.

**Verdict: `broken`** (Ken Thompson). The most severe result of the sweep — but the cause is the
same one the gate-honesty *threat-model reckoning* already named: positional self-consistency by
default, cryptographic teeth opt-in and unprovisioned.

## The critical finding (reproduced) → bead `b0p`
The default verdict (no `--legba`/`--poteau`) is **self-consistency over agent-writable files** in
`.run/compose/<run_id>/` (the State zone). Ken Thompson hand-assembled a run dir — manifest, a junk
workflow file, a one-line orchestrator, one schema-clean envelope — and got `{"verdict":"valid_run"}`
exit 0 with **no key, no runtime**. Confirmed at the source:
- check 2 only tests file **existence** (`-f`, line 315-319) — workflow content is never parsed.
- check 4's `compute-id` re-hashes the agent's **own** bytes; it never compares to a declared id —
  it proves the file is hashable JSON, not authorship.
- `--poteau` (the real Ed25519 tooth) is nested inside the `run-state.json` existence guard (line
  517) — an agent that never **arms** skips it; unarmed → `valid_run` exit 0.
- `--legba`'s genuine root (legba's pinned maintainer-root trust-store, #59 — which the panel
  praised as sound) is **never a reachable green path** here: no trust-store is provisioned and the
  per-run `legba:compose:<runId>` key is minted fresh with no rooting path, so `--legba` can only
  return `broken_run`, never certify.

The script's header is **honest** that its threat is the *lazy* agent who role-plays inline and
leaves no trail — against that, self-consistency works. The gap is (a) it does not defend against a
*fabricating* adversary, and (b) the headline `valid_run`/exit-0 was identical whether crypto ran or
not, so a consumer keying on the exit code couldn't tell.

## Form A mint residue (confirmed) → bead `p3r`
**78** `legba_compose_*.priv` gatekeeper private keys sit `-rw-------` under the agent's own uid in
`~/.config/loa/audit-keys/`. `legba-core loadOrInitKeys` writes the per-run key to disk absent a
custody signer — the exact Form A the doctrine names. Strict rooting neutralizes the gate-path
impact today, but `compose-bridge` verifies the *build* with `strict:false` and trusts an agent-held
key; any non-strict consumer is exposed.

## What this PR ships (the one clean, safe correction)
A `proof_class` field on every verdict — `"self_consistency"` (default) vs `"cryptographic"`
(`--legba` rooted **or** an armed `--poteau` chain verified) — plus a loud stderr warning when a
`valid_run` rests only on self-consistency. The headline is now honest: a consumer that gates on
exit 0 can read `proof_class` to tell "not an inline fake" from "cryptographically authored." This
does **not** make the default cryptographic (that needs trust-store provisioning — `b0p`); it stops
the gate from *implying* it did.

## Disposition
`b0p` (P0) and `p3r` (P1) tracked. The real fixes — provision the rooted trust-store so `--legba`
can certify + make crypto the default, and make `loadOrInitKeys` fail closed toward custody — are
deliberate (legba key-lifecycle, sensitive) and governed by the threat-model reckoning. The sweep's
verdict across three gates: **poteau broken, settle weak, compose-verify broken** — and in every
case the real trust root either doesn't exist yet or isn't in the cutting position. legba's own
rooted verify (#59) is the one piece the panel repeatedly called sound; the consumers just don't
reach for it.
