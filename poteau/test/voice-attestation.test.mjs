/**
 * voice-attestation.test.mjs — the proof-of-call invariants as executable
 * assertions. Zero-dep: node:test + node:assert. Run:
 *   node --test poteau/test/voice-attestation.test.mjs
 *
 * The instrument (poteau G4.5) answers the question G4 cannot: G4 proves a
 * reviewer KEY signed; this proves the claimed MODEL-VOICE was actually
 * DISPATCHED to a real provider — cross-checked against the MODELINV audit
 * chain (.run/model-invoke.jsonl). A review that CLAIMS a cross-model council
 * but single-voiced one model is the failure mode this catches, fail-closed.
 *
 * Bipartite framing: claimed voices (left) → MODELINV dispatch events (right);
 * an edge exists when an event's models_succeeded covers the claimed voice
 * (and transport=cli when --require-cli). ATTESTED iff every left node is
 * covered (full left-coverage). A missing left node is an unproven claim — a
 * lie the verdict must not carry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attestVoices, familyOf, scopeEntries } from '../bin/voice-attestation.mjs';

// A MODELINV-shaped dispatch event (the fields the instrument reads).
function entry({ succeeded = [], failed = [], transport = 'cli',
                primitive = 'reviewing-diffs', final = null }) {
  return {
    payload: {
      models_succeeded: succeeded,
      models_failed: failed.map((m) => ({ model: m })),
      transport,
      calling_primitive: primitive,
      final_model_id: final || succeeded[0] || null,
    },
  };
}

test('THE LIE: claims a 3-voice council, MODELINV proves only claude → UNATTESTED', () => {
  const r = attestVoices({
    claimed: ['anthropic:claude-headless', 'openai:codex-headless', 'cursor:cursor-headless'],
    entries: [entry({ succeeded: ['anthropic:claude-headless'] })],
  });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.deepEqual(r.missing.sort(), ['cursor:cursor-headless', 'openai:codex-headless']);
  assert.deepEqual(r.proven, ['anthropic:claude-headless']);
});

test('HONEST COUNCIL: all 3 claimed voices proven via cli → ATTESTED', () => {
  const r = attestVoices({
    claimed: ['anthropic:claude-headless', 'openai:codex-headless', 'cursor:cursor-headless'],
    entries: [
      entry({ succeeded: ['anthropic:claude-headless'] }),
      entry({ succeeded: ['openai:codex-headless'] }),
      entry({ succeeded: ['cursor:cursor-headless'] }),
    ],
  });
  assert.equal(r.verdict, 'ATTESTED');
  assert.equal(r.missing.length, 0);
});

test('requireCli: a voice that succeeded over HTTP does not prove the CLI was called', () => {
  const claimed = ['openai:codex-headless'];
  const entries = [entry({ succeeded: ['openai:codex-headless'], transport: 'http' })];
  assert.equal(attestVoices({ claimed, entries }).verdict, 'ATTESTED'); // dispatch happened
  assert.equal(attestVoices({ claimed, entries, requireCli: true }).verdict, 'UNATTESTED'); // not via CLI
});

test('a FAILED dispatch is not proof (models_failed, not succeeded)', () => {
  const r = attestVoices({
    claimed: ['openai:codex-headless'],
    entries: [entry({ succeeded: [], failed: ['openai:codex-headless'] })],
  });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.deepEqual(r.missing, ['openai:codex-headless']);
});

test('normalized match: claim "codex-headless" matches succeeded "openai:codex-headless"', () => {
  const r = attestVoices({
    claimed: ['codex-headless'],
    entries: [entry({ succeeded: ['openai:codex-headless'] })],
  });
  assert.equal(r.verdict, 'ATTESTED');
});

test('requireFamilies: a council whose proven voices are all one family is single-family masquerade', () => {
  const claimed = ['anthropic:claude-headless', 'anthropic:claude-opus-4-8'];
  const entries = [
    entry({ succeeded: ['anthropic:claude-headless'] }),
    entry({ succeeded: ['anthropic:claude-opus-4-8'] }),
  ];
  // Both claimed voices ARE proven, so plain attestation passes...
  assert.equal(attestVoices({ claimed, entries }).verdict, 'ATTESTED');
  // ...but a genuine cross-model council needs >=2 distinct provider families.
  const r = attestVoices({ claimed, entries, requireFamilies: 2 });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.equal(r.familiesProven.length, 1);
});

test('requireFamilies passes when proven voices span families', () => {
  const r = attestVoices({
    claimed: ['anthropic:claude-headless', 'openai:codex-headless'],
    entries: [
      entry({ succeeded: ['anthropic:claude-headless'] }),
      entry({ succeeded: ['openai:codex-headless'] }),
    ],
    requireFamilies: 2,
  });
  assert.equal(r.verdict, 'ATTESTED');
  assert.deepEqual(r.familiesProven.sort(), ['anthropic', 'openai']);
});

test('callingPrimitive filter: dispatches from a different primitive do not count as proof', () => {
  const r = attestVoices({
    claimed: ['openai:codex-headless'],
    entries: [entry({ succeeded: ['openai:codex-headless'], primitive: 'something-else' })],
    callingPrimitive: 'reviewing-diffs',
  });
  assert.equal(r.verdict, 'UNATTESTED');
});

test('empty claim is UNATTESTED — a review that claims no voices is not a council', () => {
  // Hardened after the codex+cursor review: empty roster must NOT vacuously pass.
  const r = attestVoices({ claimed: [], entries: [] });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.match(r.reasons.join(' '), /no voices claimed/);
});

test('provider-qualified claim is NOT proven by a different provider with the same slug', () => {
  // openai:codex-headless must not be proven by fake:codex-headless (cross-model
  // review converged HIGH: provider-blind slug match is unsound).
  const r = attestVoices({
    claimed: ['openai:codex-headless'],
    entries: [entry({ succeeded: ['fake:codex-headless'] })],
  });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.deepEqual(r.missing, ['openai:codex-headless']);
});

test('one dispatch cannot prove two claimed voices (1:1 matching)', () => {
  // Two claims for the same model, but only ONE dispatch — the second is missing.
  const r = attestVoices({
    claimed: ['anthropic:claude-headless', 'anthropic:claude-headless'],
    entries: [entry({ succeeded: ['anthropic:claude-headless'] })],
  });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.equal(r.proven.length, 1);
  assert.equal(r.missing.length, 1);
});

test('scopeEntries keeps corrupt (null) lines positionally inside the --last window', () => {
  // So a tampered current line cannot be silently dropped, letting an older
  // valid line slip into the window (codex review finding).
  const chain = [{ ts_utc: 'a', payload: {} }, null, { ts_utc: 'b', payload: {} }];
  const scoped = scopeEntries(chain, { last: 2 });
  assert.equal(scoped.length, 2);
  assert.ok(scoped.includes(null));
});

test('SCOPING is load-bearing: an unrelated past council does not prove the current review', () => {
  // The whole-chain attestation is trivially satisfied by stale history. Scope
  // to the review's own window (--last) and the lie reappears.
  const ts = (s) => ({ ts_utc: s });
  const wholeChain = [
    // old, unrelated: a real 3-family council ran days ago
    { ...ts('2026-06-20T10:00:00Z'), payload: { models_succeeded: ['anthropic:claude-headless'], transport: 'cli', calling_primitive: 'reviewing-diffs' } },
    { ...ts('2026-06-20T10:00:01Z'), payload: { models_succeeded: ['openai:codex-headless'], transport: 'cli', calling_primitive: 'reviewing-diffs' } },
    { ...ts('2026-06-20T10:00:02Z'), payload: { models_succeeded: ['cursor:cursor-headless'], transport: 'cli', calling_primitive: 'reviewing-diffs' } },
    // THIS review, just now: single-voiced the claude it claimed, nothing else
    { ...ts('2026-06-24T21:00:00Z'), payload: { models_succeeded: ['anthropic:claude-headless'], transport: 'cli', calling_primitive: 'reviewing-diffs' } },
  ];
  const claim = ['anthropic:claude-headless', 'openai:codex-headless', 'cursor:cursor-headless'];

  // Unscoped: the stale council masks the single-voice present → false ATTESTED.
  assert.equal(attestVoices({ claimed: claim, entries: wholeChain }).verdict, 'ATTESTED');

  // Scoped to the review's own tail → the lie is caught.
  const scoped = scopeEntries(wholeChain, { last: 1 });
  const r = attestVoices({ claimed: claim, entries: scoped });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.deepEqual(r.missing.sort(), ['cursor:cursor-headless', 'openai:codex-headless']);
});

test('scopeEntries --since keeps only entries at/after the boundary', () => {
  const e = (t) => ({ ts_utc: t, payload: {} });
  const chain = [e('2026-06-20T00:00:00Z'), e('2026-06-24T12:00:00Z'), e('2026-06-24T21:00:00Z')];
  assert.equal(scopeEntries(chain, { since: '2026-06-24T00:00:00Z' }).length, 2);
  assert.equal(scopeEntries(chain, { since: '2026-06-25T00:00:00Z' }).length, 0);
  assert.equal(scopeEntries(chain, { last: 2 }).length, 2);
});

test('familyOf normalizes provider prefixes and bare model slugs', () => {
  assert.equal(familyOf('anthropic:claude-headless'), 'anthropic');
  assert.equal(familyOf('openai:codex-headless'), 'openai');
  assert.equal(familyOf('google:gemini-2.5-pro'), 'google');
  assert.equal(familyOf('cursor:cursor-headless'), 'cursor');
  assert.equal(familyOf('claude-opus-4-8'), 'anthropic'); // bare slug inferred
  assert.equal(familyOf('gpt-5.2'), 'openai');
});

// ---------------------------------------------------------------------------
// Cross-model review (#82) — hardening found by the governed council on this PR
// ---------------------------------------------------------------------------

test('1:1 ENTRY-LEVEL: one dispatch listing two models attests AT MOST one voice', () => {
  // A single MODELINV entry must not prove two distinct claimed voices — one
  // dispatch is one consumable proof (codex L144 + cursor L140 CONVERGED). The
  // old per-model push let an ensemble/chain-walk entry attest several voices.
  const r = attestVoices({
    claimed: ['openai:codex-headless', 'anthropic:claude-headless'],
    entries: [entry({ succeeded: ['openai:codex-headless', 'anthropic:claude-headless'] })],
  });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.equal(r.proven.length, 1);   // exactly one voice consumed the single entry
  assert.equal(r.missing.length, 1);
});

test('1:1 ENTRY-LEVEL: two SEPARATE dispatches prove two voices → ATTESTED', () => {
  const r = attestVoices({
    claimed: ['openai:codex-headless', 'anthropic:claude-headless'],
    entries: [
      entry({ succeeded: ['openai:codex-headless'] }),
      entry({ succeeded: ['anthropic:claude-headless'] }),
    ],
  });
  assert.equal(r.verdict, 'ATTESTED');
});

test('PROVIDER-SPOOF: a fake provider prefix does NOT prove a provider-qualified claim', () => {
  // claim openai:codex-headless; MODELINV shows fake:codex-headless ran — same
  // slug + same INFERRED family, but a different provider. familyOf would have
  // matched it; provider-exact must not.
  const r = attestVoices({
    claimed: ['openai:codex-headless'],
    entries: [entry({ succeeded: ['fake:codex-headless'] })],
  });
  assert.equal(r.verdict, 'UNATTESTED');
  assert.deepEqual(r.proven, []);
});

test('PROVIDER-SPOOF: bedrock:claude does NOT prove an anthropic:claude claim', () => {
  const r = attestVoices({
    claimed: ['anthropic:claude-opus'],
    entries: [entry({ succeeded: ['bedrock:claude-opus'] })],
  });
  assert.equal(r.verdict, 'UNATTESTED');
});

test('PROVIDER-EXACT: a provider-qualified claim IS proven by the same provider', () => {
  const r = attestVoices({
    claimed: ['openai:codex-headless'],
    entries: [entry({ succeeded: ['openai:codex-headless'] })],
  });
  assert.equal(r.verdict, 'ATTESTED');
});

test('BARE CLAIM: a bare slug claim is still proven across providers by model name', () => {
  const r = attestVoices({
    claimed: ['codex-headless'],
    entries: [entry({ succeeded: ['openai:codex-headless'] })],
  });
  assert.equal(r.verdict, 'ATTESTED');
});

test('BIPARTITE: augmenting paths find a matching that greedy first-fit would miss', () => {
  // claimed [bare gpt-4, openai:gpt-4]; proofs [openai:gpt-4, anthropic:gpt-4].
  // Greedy: the bare claim eats openai:gpt-4 first → the qualified claim is left
  // with anthropic:gpt-4 (wrong provider) → false UNATTESTED. Kuhn's re-routes
  // the bare claim to anthropic:gpt-4 (slug match) and proves BOTH.
  const r = attestVoices({
    claimed: ['gpt-4', 'openai:gpt-4'],
    entries: [
      entry({ succeeded: ['openai:gpt-4'] }),
      entry({ succeeded: ['anthropic:gpt-4'] }),
    ],
  });
  assert.equal(r.verdict, 'ATTESTED');
  assert.equal(r.missing.length, 0);
});

test('SCOPE: an unparseable --since fails closed (throws), never a silent empty window', () => {
  assert.throws(
    () => scopeEntries([{ ts_utc: '2026-06-24T00:00:00Z' }], { since: 'not-a-date' }),
    /invalid --since/,
  );
});

test('SCOPE: a valid --since keeps only entries at/after the floor', () => {
  const out = scopeEntries(
    [{ ts_utc: '2026-06-23T00:00:00Z' }, { ts_utc: '2026-06-24T12:00:00Z' }],
    { since: '2026-06-24T00:00:00Z' },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].ts_utc, '2026-06-24T12:00:00Z');
});
