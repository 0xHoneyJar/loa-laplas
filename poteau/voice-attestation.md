# poteau G4.5 — voice attestation (proof-of-call)

> G4 proves a reviewer **key signed**. G4.5 proves the claimed **model-voice was
> actually dispatched to a real provider** — by cross-checking the MODELINV audit
> chain. It is the deterministic answer to *"did the agent actually call what it
> says it called?"*

## The gap it closes

A review can **claim** a cross-model council (claude + codex + cursor) and then
single-voice one model. G4's Ed25519 council-honor check proves a *provisioned
reviewer key* signed each receipt — but a key signing is not a model being run.
The thing that records a model actually reaching a provider CLI is the cheval
**MODELINV** audit chain (`.run/model-invoke.jsonl`): every invocation writes
`models_succeeded`, `transport` (`cli` | `http`), and `calling_primitive`,
hash-chained. `voice-attestation` reads that chain and refuses, fail-closed, a
claim it cannot prove.

## The check (bipartite, honeycomb / EULER framing)

Claimed voices are **left** nodes; MODELINV dispatch events are **right** nodes.
An edge exists when an event's `models_succeeded` covers the claimed voice (and
`transport=cli` under `--require-cli`). The verdict is **ATTESTED** iff every
left node is covered — a full left-coverage / left-perfect matching. A missing
left node is an unproven claim: a lie the verdict must not carry.

```
claimed              MODELINV (scoped to this review)
  claude  ───────────►  anthropic:claude-headless   ✓ proven
  codex   ──── ✗ ────►  (no dispatch)                 ← UNATTESTED
  cursor  ──── ✗ ────►  (no dispatch)
```

## Usage

```bash
# Scope to THIS review's window (--last N or --since <ts>) — attesting against
# the whole historical chain is meaningless: a stale codex call would mask a
# single-voice present.
node poteau/bin/voice-attestation.mjs \
  --invoke .run/model-invoke.jsonl \
  --last 5 \
  --claim "anthropic:claude-headless,openai:codex-headless,cursor:cursor-headless" \
  --require-cli \
  --require-families 2
# exit 0 ATTESTED · 2 UNATTESTED (refusal teaches via .reasons) · 5 fail-closed

# Or attest a verdict_quality envelope's declared roster:
node poteau/bin/voice-attestation.mjs --envelope final_consensus.json --last 8
```

| Flag | Effect |
|------|--------|
| `--claim a,b,c` | the voices the review claims it consulted |
| `--envelope <f>` | take the claim from a verdict_quality envelope's `voices_succeeded_ids` |
| `--invoke <f>` | MODELINV chain (default `.run/model-invoke.jsonl`) |
| `--last N` / `--since <ts>` | **scope** to the review's window (load-bearing) |
| `--require-cli` | only `transport=cli` dispatches prove a call (catches an http masquerade) |
| `--require-families N` | proven voices must span ≥ N provider families (catches single-family-masquerading-as-council) |
| `--primitive <name>` | only count dispatches from this `calling_primitive` |

## Wiring point

This is a standalone, fail-closed gate today. The intended home is **next to G4**
in `poteau-gatekeeper.mjs`: when `run_state.review_routing` declares a model-voice
roster (not just reviewer keys), the gatekeeper runs voice-attestation against the
MODELINV chain scoped to the run, and refuses (exit 2) on UNATTESTED — so the
council-honor check covers *both* "a key signed" (G4) and "the model ran" (G4.5).

Verify: `node --test poteau/test/voice-attestation.test.mjs` (12/12).
