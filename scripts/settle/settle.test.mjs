// settle.test.mjs — the consolidated teeth, ported from
// the application-layer settle draft (vitest) to loa-laplas node:test.
//
// One place that pins every guarantee the substrate exists to keep. If a future
// change weakens the gate (e.g. proceed-on-claimed), `node --test` goes non-zero
// here. The final block (g) is the NEGATIVE CONTROL: a deliberately-broken gate
// proceeds-on-claimed while the real gate fails closed — proving the gate's
// check is load-bearing.
//
// Run: node --test scripts/settle/settle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { generateVerifierKeypair } from '../legba/legba-core.mjs';
import {
  tierRank,
  tierGte,
  isTerminal,
  makeTetlockForecast,
  verdictToEarnedTier,
  classify,
  signSnapshot,
  checkSync,
  verify,
  makeTrailWriter,
  makeGatedFacade,
} from './settle.mjs';

// ── HARNESS ───────────────────────────────────────────────────────────────────
// A keypair is the trusted verifier. signedSnap() mints a signed snapshot;
// realCheck() runs the genuine gate against it at a fixed clock.
function harness() {
  const { privateKey, publicKeyBase64 } = generateVerifierKeypair();
  const now = 1500;
  function signedSnap(o) {
    const snapshot = {
      schema: 'settle.snapshot.v1',
      claim_id: o.claim_id ?? 'c1',
      domain: o.domain ?? 'money/transfer',
      bar_sha: o.bar_sha,
      earned_tier: o.earned_tier ?? 'claimed',
      chain_health: o.chain_health ?? 'ok',
      verdict: o.verdict,
      prepared_at: o.prepared_at ?? 1000,
      ttl: o.ttl ?? 86400,
    };
    return signSnapshot(snapshot, privateKey);
  }
  function realCheck(signed, extra = {}) {
    return checkSync(signed, {
      trustedVerifierPublicKey: publicKeyBase64,
      now,
      requiredTier: extra.requiredTier ?? 'settled',
      ...extra,
    });
  }
  return { privateKey, publicKeyBase64, now, signedSnap, realCheck };
}

// money/** classifies FAIL_CLOSED -> required tier 'settled' (must-settle).
// FEEDBACK_LOOP -> required tier 'claimed' (never forced to settle).
const REQUIRED_FOR = { FAIL_CLOSED: 'settled', VERIFY_THEN_PROCEED: 'pinned', FEEDBACK_LOOP: 'claimed', FREE: 'claimed' };

// ── DOMAIN: TIER (T-2) ─────────────────────────────────────────────────────────
test('tierRank: ladder is abstained<claimed<pinned<settled', () => {
  assert.equal(tierRank('abstained'), -1);
  assert.equal(tierRank('claimed'), 0);
  assert.equal(tierRank('pinned'), 1);
  assert.equal(tierRank('settled'), 2);
});

test('tierRank: unknown tier throws', () => {
  assert.throws(() => tierRank('bogus'), TypeError);
  assert.throws(() => tierRank(''), TypeError);
});

test('tierGte: monotone comparisons across the ladder', () => {
  assert.equal(tierGte('settled', 'settled'), true);
  assert.equal(tierGte('settled', 'pinned'), true);
  assert.equal(tierGte('settled', 'claimed'), true);
  assert.equal(tierGte('pinned', 'settled'), false);
  assert.equal(tierGte('pinned', 'pinned'), true);
  assert.equal(tierGte('claimed', 'settled'), false);
  assert.equal(tierGte('claimed', 'claimed'), true);
  assert.equal(tierGte('abstained', 'claimed'), false);
  assert.equal(tierGte('abstained', 'abstained'), true);
  assert.equal(tierGte('pinned', 'claimed'), true);
  assert.equal(tierGte('pinned', 'abstained'), true);
  assert.equal(tierGte('settled', 'abstained'), true);
  assert.equal(tierGte('claimed', 'abstained'), true);
});

test('isTerminal: only abstained is terminal', () => {
  assert.equal(isTerminal('abstained'), true);
  assert.equal(isTerminal('claimed'), false);
  assert.equal(isTerminal('pinned'), false);
  assert.equal(isTerminal('settled'), false);
});

test('makeTetlockForecast: integer ppm accepted, floats/range rejected', () => {
  assert.deepEqual(makeTetlockForecast(500000), { probability_ppm: 500000, base_rate_ppm: null, brier_ppm: null });
  assert.deepEqual(makeTetlockForecast(0, 10, 20), { probability_ppm: 0, base_rate_ppm: 10, brier_ppm: 20 });
  assert.throws(() => makeTetlockForecast(0.5), TypeError);
  assert.throws(() => makeTetlockForecast(-1), RangeError);
  assert.throws(() => makeTetlockForecast(1_000_001), RangeError);
  assert.throws(() => makeTetlockForecast(100, 0.5), TypeError);
});

// ── DOMAIN: VERDICT MAPPING (T-2) ──────────────────────────────────────────────
// PENDING != INSUFFICIENT: pending -> claimed (not yet measured),
// insufficient -> abstained (measured, inconclusive). Collapsing them is a regression.
test('verdictToEarnedTier: HELD->settled, PENDING->claimed, FALSIFIED/INSUFFICIENT->abstained', () => {
  assert.equal(verdictToEarnedTier('HELD'), 'settled');
  assert.equal(verdictToEarnedTier('PENDING'), 'claimed');
  assert.equal(verdictToEarnedTier('FALSIFIED'), 'abstained');
  assert.equal(verdictToEarnedTier('INSUFFICIENT'), 'abstained');
});

test('verdictToEarnedTier: PENDING and INSUFFICIENT do NOT collapse', () => {
  assert.notEqual(verdictToEarnedTier('PENDING'), verdictToEarnedTier('INSUFFICIENT'));
  assert.throws(() => verdictToEarnedTier('NONSENSE'), TypeError);
});

// ── CLASSIFIER (T-4) ───────────────────────────────────────────────────────────
test('classify: every must-settle domain -> FAIL_CLOSED', () => {
  for (const d of ['auth/login', 'money/transfer', 'ops/deploy', 'deployed/state', 'onchain/tx', 'release/v1']) {
    assert.equal(classify(d), 'FAIL_CLOSED', d);
  }
  // nested paths under a must-settle prefix stay FAIL_CLOSED (** is recursive).
  assert.equal(classify('money/transfer/usd'), 'FAIL_CLOSED');
  assert.equal(classify('auth/oauth/callback'), 'FAIL_CLOSED');
});

test('classify: verify-then-proceed domains', () => {
  assert.equal(classify('schema/users'), 'VERIFY_THEN_PROCEED');
  assert.equal(classify('routing/edge'), 'VERIFY_THEN_PROCEED');
  assert.equal(classify('persistence/kv'), 'VERIFY_THEN_PROCEED');
});

test('classify: feedback-loop domains', () => {
  assert.equal(classify('taste/vibe'), 'FEEDBACK_LOOP');
  assert.equal(classify('feel/motion'), 'FEEDBACK_LOOP');
  assert.equal(classify('voice/tone'), 'FEEDBACK_LOOP');
});

test('classify: free domains', () => {
  assert.equal(classify('docs/readme'), 'FREE');
  assert.equal(classify('scratch/tmp'), 'FREE');
});

test('classify: unmatched domain is FAIL_CLOSED, never FREE (SKP-006)', () => {
  assert.equal(classify('unknown/domain'), 'FAIL_CLOSED');
  assert.equal(classify('random'), 'FAIL_CLOSED');
  assert.notEqual(classify('unknown/domain'), 'FREE');
});

test('classify: determinism-map sha mismatch throws (SKP-003, map-tamper)', () => {
  const tampered = { version: 1, description: 'tampered', rules: [{ glob: 'money/**', posture: 'FREE' }] };
  assert.throws(() => classify('money/transfer', tampered), /sha mismatch \(SKP-003\)/);
});

// ── GATE: DENY PATHS (T-3) ─────────────────────────────────────────────────────
test('checkSync: missing trustedVerifierPublicKey throws (fail-closed at init, A-6)', () => {
  const h = harness();
  const s = h.signedSnap({ earned_tier: 'settled', verdict: 'HELD' });
  assert.throws(() => checkSync(s, {}), /trustedVerifierPublicKey is required/);
  assert.throws(() => checkSync(s, { now: 1, requiredTier: 'settled' }), /fail-closed/);
});

test('checkSync: no snapshot denies', () => {
  const h = harness();
  const d = h.realCheck(null);
  assert.equal(d.proceed, false);
  assert.match(d.reason, /no snapshot/);
});

test('checkSync: confused-deputy — claim_id mismatch denies (A-6)', () => {
  const h = harness();
  const s = h.signedSnap({ claim_id: 'A', earned_tier: 'settled', verdict: 'HELD' });
  const d = h.realCheck(s, { claim_id: 'B' });
  assert.equal(d.proceed, false);
  assert.equal(d.earned_tier, 'abstained'); // deny stamps abstained, never the snapshot's tier
  assert.match(d.reason, /claim_id mismatch/);
});

test('checkSync: bar_sha mismatch denies (A-2)', () => {
  const h = harness();
  const s = h.signedSnap({ bar_sha: 'sha-A', earned_tier: 'settled', verdict: 'HELD' });
  const d = h.realCheck(s, { bar_sha: 'sha-B' });
  assert.equal(d.proceed, false);
  assert.match(d.reason, /bar_sha mismatch/);
});

test('checkSync: untrusted signer key denies (A-6)', () => {
  const h = harness();
  // Sign with a DIFFERENT key than the configured trusted key.
  const other = generateVerifierKeypair();
  const snapshot = { schema: 'settle.snapshot.v1', claim_id: 'c1', domain: 'money/transfer', earned_tier: 'settled', chain_health: 'ok', prepared_at: 1000, ttl: 86400 };
  const signed = signSnapshot(snapshot, other.privateKey);
  const d = h.realCheck(signed);
  assert.equal(d.proceed, false);
  assert.match(d.reason, /untrusted signer key/);
});

test('checkSync: tampered signature denies (A-6)', () => {
  const h = harness();
  const s = h.signedSnap({ earned_tier: 'settled', verdict: 'HELD' });
  // Corrupt the signature but keep the (trusted) public key.
  const flipped = s.sig[0] === 'A' ? 'B' : 'A';
  const tampered = { ...s, sig: flipped + s.sig.slice(1) };
  const d = h.realCheck(tampered);
  assert.equal(d.proceed, false);
  assert.match(d.reason, /signature invalid/);
});

test('checkSync: expired snapshot denies (TTL, SKP-005a)', () => {
  const h = harness();
  // prepared_at 1000 + ttl 100 = 1100; now 1500 > 1100 -> expired.
  const s = h.signedSnap({ earned_tier: 'settled', verdict: 'HELD', prepared_at: 1000, ttl: 100 });
  const d = h.realCheck(s);
  assert.equal(d.proceed, false);
  assert.match(d.reason, /expired/);
});

test('checkSync: earned < required denies (settled required, claimed earned)', () => {
  const h = harness();
  const s = h.signedSnap({ earned_tier: 'claimed', verdict: 'PENDING' });
  const d = h.realCheck(s, { requiredTier: 'settled' });
  assert.equal(d.proceed, false);
  assert.equal(d.earned_tier, 'claimed');
  assert.match(d.reason, /< required/);
});

// ── GATE: PROCEED PATHS + G-7 (T-3) ────────────────────────────────────────────
test('checkSync: settled snapshot proceeds in a must-settle context', () => {
  const h = harness();
  const s = h.signedSnap({ earned_tier: 'settled', verdict: 'HELD' });
  const d = h.realCheck(s, { requiredTier: 'settled' });
  assert.equal(d.proceed, true);
  assert.equal(d.earned_tier, 'settled');
  assert.equal(d.required_tier, 'settled');
});

test('checkSync: claimed proceeds when only claimed is required (feedback-loop)', () => {
  const h = harness();
  const s = h.signedSnap({ domain: 'taste/vibe', earned_tier: 'claimed', verdict: 'PENDING' });
  const d = h.realCheck(s, { requiredTier: REQUIRED_FOR.FEEDBACK_LOOP });
  assert.equal(d.proceed, true);
});

test('checkSync: G-7 — degraded chain caps settled->pinned, denies in must-settle', () => {
  const h = harness();
  const s = h.signedSnap({ earned_tier: 'settled', chain_health: 'degraded', verdict: 'HELD' });
  const d = h.realCheck(s, { requiredTier: 'settled' });
  assert.equal(d.proceed, false);
  assert.equal(d.earned_tier, 'pinned');
  assert.match(d.reason, /degraded chain/);
});

test('checkSync: G-7 — degraded settled still satisfies a pinned requirement', () => {
  const h = harness();
  const s = h.signedSnap({ earned_tier: 'settled', chain_health: 'degraded', verdict: 'HELD' });
  const d = h.realCheck(s, { requiredTier: 'pinned' });
  assert.equal(d.proceed, true);
  assert.equal(d.earned_tier, 'pinned');
});

// ── SNAPSHOT SIGNING ROUNDTRIP ─────────────────────────────────────────────────
test('signSnapshot: produces an ed25519 signature that the real gate accepts', () => {
  const h = harness();
  const s = h.signedSnap({ earned_tier: 'settled', verdict: 'HELD' });
  assert.equal(s.alg, 'ed25519');
  assert.equal(typeof s.sig, 'string');
  assert.equal(typeof s.public_key, 'string');
  assert.equal(s.public_key, h.publicKeyBase64);
  assert.equal(h.realCheck(s).proceed, true);
});

// ── INDEPENDENT VERIFIER (T-5) ─────────────────────────────────────────────────
function fixedInstrument(verdict, chain_health = 'ok') {
  return { async settle() { return { verdict, chain_health }; } };
}
const envelopeFor = (o = {}) => ({
  claim: { id: o.claim_id ?? 'c1', domain: o.domain ?? 'money/transfer' },
  bar: { sha: o.bar_sha ?? 'bar-sha' },
  instrument_id: 'inst',
  instrument_sha: 'sha1',
  // self-reported fields are present but MUST be ignored by verify (A-1):
  self_reported_verdict: o.self_reported_verdict ?? 'HELD',
  self_reported_tier: o.self_reported_tier ?? 'settled',
});

test('verify: recomputes earned_tier independently; ignores self-reported (A-1)', async () => {
  const h = harness();
  // The producer LIES (self-reports HELD/settled) but the instrument recomputes FALSIFIED.
  const signed = await verify(envelopeFor({ self_reported_verdict: 'HELD', self_reported_tier: 'settled' }), fixedInstrument('FALSIFIED'), h.privateKey, { now: 1000 });
  assert.equal(signed.snapshot.earned_tier, 'abstained');
  assert.notEqual(signed.snapshot.earned_tier, 'settled');
});

test('verify: HELD recompute earns settled', async () => {
  const h = harness();
  const signed = await verify(envelopeFor(), fixedInstrument('HELD'), h.privateKey, { now: 1000 });
  assert.equal(signed.snapshot.earned_tier, 'settled');
  assert.equal(signed.snapshot.verdict, 'HELD');
});

test('verify: produced snapshot is gate-checkable end-to-end', async () => {
  const h = harness();
  const signed = await verify(envelopeFor(), fixedInstrument('HELD'), h.privateKey, { now: 1000, ttl: 86400 });
  const d = checkSync(signed, { trustedVerifierPublicKey: h.publicKeyBase64, now: 1500, requiredTier: 'settled', claim_id: 'c1' });
  assert.equal(d.proceed, true);
});

// ── TRAIL WRITER (T-6) ─────────────────────────────────────────────────────────
test('makeTrailWriter: appends one canonical JSON line per write', () => {
  const path = join(tmpdir(), `settle-trail-${process.pid}-${Math.floor(performance.now())}.jsonl`);
  try {
    const trail = makeTrailWriter(path);
    trail.write({ proceed: false, reason: 'denied' });
    trail.write({ proceed: true, reason: 'ok' });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).proceed, false);
    assert.equal(JSON.parse(lines[1]).proceed, true);
  } finally {
    rmSync(path, { force: true });
  }
});

test('makeTrailWriter: oversize row throws, never silently truncates (SKP-004)', () => {
  const path = join(tmpdir(), `settle-trail-big-${process.pid}.jsonl`);
  try {
    const trail = makeTrailWriter(path);
    assert.throws(() => trail.write({ blob: 'x'.repeat(5000) }), /exceeds atomic-append limit/);
  } finally {
    rmSync(path, { force: true });
  }
});

// ── GATED FACADE (T-3/T-7) ─────────────────────────────────────────────────────
test('makeGatedFacade: requires a gate with checkSync', () => {
  assert.throws(() => makeGatedFacade(null, () => 1), TypeError);
  assert.throws(() => makeGatedFacade({}, () => 1), TypeError);
});

test('makeGatedFacade: runs the capability only when the gate proceeds', () => {
  const h = harness();
  let called = 0;
  const cap = () => { called++; return 'DID_THE_THING'; };
  const realGate = { checkSync };
  const settledCfg = { trustedVerifierPublicKey: h.publicKeyBase64, now: h.now, requiredTier: 'settled' };

  const denied = makeGatedFacade(realGate, cap).run(h.signedSnap({ earned_tier: 'claimed', verdict: 'PENDING' }), settledCfg);
  assert.equal(denied.proceeded, false);
  assert.equal(denied.result, undefined);
  assert.equal(called, 0);

  const allowed = makeGatedFacade(realGate, cap).run(h.signedSnap({ earned_tier: 'settled', verdict: 'HELD' }), settledCfg);
  assert.equal(allowed.proceeded, true);
  assert.equal(allowed.result, 'DID_THE_THING');
  assert.equal(called, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// COUNTER-EXAMPLES (the teeth) — ported (a)-(g) from the application-layer suite.
// ═══════════════════════════════════════════════════════════════════════════════
test('(a) a producer that lies consistently is caught (independent recompute disagrees)', async () => {
  const h = harness();
  const signed = await verify(envelopeFor({ self_reported_verdict: 'HELD', self_reported_tier: 'settled' }), fixedInstrument('FALSIFIED'), h.privateKey, { now: 1000 });
  assert.equal(signed.snapshot.earned_tier, 'abstained');
});

test('(b) a must-settle domain cannot proceed on `claimed`', () => {
  const h = harness();
  assert.equal(classify('money/transfer'), 'FAIL_CLOSED'); // must-settle
  const s = h.signedSnap({ domain: 'money/transfer', earned_tier: 'claimed', verdict: 'PENDING' });
  assert.equal(h.realCheck(s, { requiredTier: REQUIRED_FOR.FAIL_CLOSED }).proceed, false);
});

test('(c) a FEEDBACK_LOOP domain is never forced to settle', () => {
  const h = harness();
  assert.equal(classify('taste/vibe'), 'FEEDBACK_LOOP');
  const s = h.signedSnap({ domain: 'taste/vibe', earned_tier: 'claimed', verdict: 'PENDING' });
  assert.equal(h.realCheck(s, { requiredTier: REQUIRED_FOR.FEEDBACK_LOOP }).proceed, true);
});

test('(d) a missing/inconclusive instrument abstains, never settles', async () => {
  const h = harness();
  const signed = await verify(envelopeFor(), fixedInstrument('INSUFFICIENT'), h.privateKey, { now: 1000 });
  assert.equal(signed.snapshot.earned_tier, 'abstained');
  const d = checkSync(signed, { trustedVerifierPublicKey: h.publicKeyBase64, now: 1500, requiredTier: 'settled' });
  assert.equal(d.proceed, false);
  assert.equal(d.earned_tier, 'abstained');
});

test('(e) G-7: a degraded-Fable chain cannot reach settled in a must-settle domain', () => {
  const h = harness();
  const s = h.signedSnap({ domain: 'money/transfer', earned_tier: 'settled', chain_health: 'degraded', verdict: 'HELD' });
  const d = h.realCheck(s, { requiredTier: REQUIRED_FOR.FAIL_CLOSED });
  assert.equal(d.proceed, false);
  assert.match(d.reason, /degraded chain/);
});

test('(f) no silent proceed: every must-settle decision is recorded on the trail', () => {
  const h = harness();
  const path = join(tmpdir(), `settle-trail-f-${process.pid}-${Math.floor(performance.now())}.jsonl`);
  try {
    const trail = makeTrailWriter(path);
    const s = h.signedSnap({ domain: 'money/transfer', earned_tier: 'claimed', verdict: 'PENDING' });
    const d = h.realCheck(s, { requiredTier: REQUIRED_FOR.FAIL_CLOSED });
    trail.write({ claim_id: 'c1', domain: 'money/transfer', proceed: d.proceed, reason: d.reason });
    const rows = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0]).proceed, false);
  } finally {
    rmSync(path, { force: true });
  }
});

test('(g) NEGATIVE CONTROL: a deliberately-broken gate (proceed-on-claimed) flips red; the real gate fails closed', () => {
  const h = harness();
  const claimed = h.signedSnap({ domain: 'money/transfer', earned_tier: 'claimed', verdict: 'PENDING' });
  const settledCfg = { requiredTier: REQUIRED_FOR.FAIL_CLOSED };

  // The REAL gate abstains on `claimed` in a must-settle domain — the green the suite depends on.
  assert.equal(h.realCheck(claimed, settledCfg).proceed, false);

  // A deliberately-broken gate returns the WRONG answer for the same action.
  const brokenGate = { checkSync: () => ({ proceed: true, earned_tier: 'claimed', reason: 'BROKEN proceed-on-claimed' }) };
  assert.equal(brokenGate.checkSync().proceed, true);

  // Substituting `broken` for the real gate violates the must-settle invariant:
  // the two answers DIFFER, so a proceed-on-claimed regression makes this suite exit non-zero.
  assert.notEqual(brokenGate.checkSync().proceed, h.realCheck(claimed, settledCfg).proceed);

  // And through the public facade: broken proceeds, real does not — the negative control fails closed.
  const settledCfgFull = { trustedVerifierPublicKey: h.publicKeyBase64, now: h.now, requiredTier: 'settled' };
  assert.equal(makeGatedFacade(brokenGate, () => 'LEAK').run(claimed, settledCfgFull).proceeded, true);
  assert.equal(makeGatedFacade({ checkSync }, () => 'LEAK').run(claimed, settledCfgFull).proceeded, false);
});
