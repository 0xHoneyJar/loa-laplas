// legba-core.mjs confirmed: jcs sha256 hashObj sign verify — 2026-06-23
// Port of the settle substrate (application-layer draft, PR #298) into scripts/settle.
// Single ESM file — composes legba (ed25519 + JCS + sha256). Zero inline crypto.
import { jcs, sha256, hashObj, sign as legbaSign, verify as legbaVerify } from '../legba/legba-core.mjs';
import { createPublicKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// ── TIER DOMAIN (T-2) ─────────────────────────────────────────────────────────
// Rank: abstained=-1 (off the positive ladder), claimed=0, pinned=1, settled=2.
const TIER_RANK = { abstained: -1, claimed: 0, pinned: 1, settled: 2 };

export function tierRank(t) {
  if (!(t in TIER_RANK)) throw new TypeError(`unknown tier: ${t}`);
  return TIER_RANK[t];
}

export function tierGte(a, b) {
  return TIER_RANK[a] >= TIER_RANK[b];
}

export function isTerminal(t) {
  return t === 'abstained';
}

// TetlockForecast — calibrated confidence in integer ppm (no floats).
function assertPpm(n, field) {
  if (!Number.isInteger(n)) throw new TypeError(`${field} must be an integer ppm, got ${n}`);
  if (n < 0 || n > 1_000_000) throw new RangeError(`${field} out of [0, 1_000_000]: ${n}`);
}

export function makeTetlockForecast(probability_ppm, base_rate_ppm = null, brier_ppm = null) {
  assertPpm(probability_ppm, 'probability_ppm');
  if (base_rate_ppm !== null) assertPpm(base_rate_ppm, 'base_rate_ppm');
  if (brier_ppm !== null) assertPpm(brier_ppm, 'brier_ppm');
  return { probability_ppm, base_rate_ppm, brier_ppm };
}

// ── VERDICT / CLAIM DOMAIN (T-2) ─────────────────────────────────────────────
// PENDING != INSUFFICIENT: pending = not yet measured (-> claimed),
// insufficient = measured but inconclusive (-> abstained). Collapsing them is
// a regression that allows a stalled measurement to masquerade as permissive.
export function verdictToEarnedTier(v) {
  switch (v) {
    case 'HELD': return 'settled';
    case 'PENDING': return 'claimed';
    case 'FALSIFIED': return 'abstained';
    case 'INSUFFICIENT': return 'abstained';
    default: throw new TypeError(`unknown verdict: ${v}`);
  }
}

// ── POSTURE DOMAIN (T-2) ──────────────────────────────────────────────────────
function postureToRequiredTier(p) {
  switch (p) {
    case 'FAIL_CLOSED': return 'settled';
    case 'VERIFY_THEN_PROCEED': return 'pinned';
    case 'FEEDBACK_LOOP': return 'claimed';
    case 'FREE': return 'claimed';
    default: return 'settled'; // unknown posture -> most restrictive
  }
}

// ── DETERMINISM MAP + CLASSIFIER (T-4) ───────────────────────────────────────
// Inline copy of config/determinism-map.json from packages/settle.
const DETERMINISM_MAP = {
  version: 1,
  description: 'Machine twin of the vault grounding ladder: domain glob -> posture. Unmatched -> FAIL_CLOSED (enforced in code, not here).',
  rules: [
    { glob: 'auth/**', posture: 'FAIL_CLOSED' },
    { glob: 'money/**', posture: 'FAIL_CLOSED' },
    { glob: 'ops/**', posture: 'FAIL_CLOSED' },
    { glob: 'deployed/**', posture: 'FAIL_CLOSED' },
    { glob: 'onchain/**', posture: 'FAIL_CLOSED' },
    { glob: 'release/**', posture: 'FAIL_CLOSED' },
    { glob: 'schema/**', posture: 'VERIFY_THEN_PROCEED' },
    { glob: 'routing/**', posture: 'VERIFY_THEN_PROCEED' },
    { glob: 'persistence/**', posture: 'VERIFY_THEN_PROCEED' },
    { glob: 'taste/**', posture: 'FEEDBACK_LOOP' },
    { glob: 'feel/**', posture: 'FEEDBACK_LOOP' },
    { glob: 'voice/**', posture: 'FEEDBACK_LOOP' },
    { glob: 'docs/**', posture: 'FREE' },
    { glob: 'scratch/**', posture: 'FREE' },
  ],
};

// Pinned sha of DETERMINISM_MAP (JCS-canonical sha256, bare hex without prefix).
const PINNED_MAP_SHA = 'a13591a358d4bfd31ae7cae73b2f1fee666242a01e6c5c9464975cfe71116266';

function segMatch(seg, val) {
  if (seg === '*') return true;
  if (!seg.includes('*')) return seg === val;
  const parts = seg.split('*');
  const prefix = parts[0] ?? '';
  if (prefix && !val.startsWith(prefix)) return false;
  let idx = prefix.length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (part === '') continue;
    const found = val.indexOf(part, idx);
    if (found === -1) return false;
    idx = found + part.length;
  }
  const last = parts[parts.length - 1] ?? '';
  if (last && !val.endsWith(last)) return false;
  return true;
}

function globMatch(pattern, path) {
  const p = pattern.split('/');
  const s = path.split('/');
  function walk(pi, si) {
    let pIdx = pi, sIdx = si;
    while (pIdx < p.length) {
      const seg = p[pIdx];
      if (seg === undefined) return false;
      if (seg === '**') {
        if (pIdx === p.length - 1) return true;
        for (let k = sIdx; k <= s.length; k++) {
          if (walk(pIdx + 1, k)) return true;
        }
        return false;
      }
      const val = s[sIdx];
      if (val === undefined) return false;
      if (!segMatch(seg, val)) return false;
      pIdx++; sIdx++;
    }
    return sIdx === s.length;
  }
  return walk(0, 0);
}

// Computes the bare-hex sha256 of JCS(map) using hashObj (which prefixes "sha256:").
function mapSha(map) {
  return hashObj(map).slice('sha256:'.length);
}

/**
 * Classify a domain against a determinism map.
 * The map's JCS sha is checked against PINNED_MAP_SHA first (SKP-003).
 * Unknown/unmatched domains return 'FAIL_CLOSED' (never 'FREE').
 *
 * @param domain - domain string to classify
 * @param map    - determinism map (default: inline DETERMINISM_MAP)
 * @returns posture string: 'FREE' | 'FEEDBACK_LOOP' | 'VERIFY_THEN_PROCEED' | 'FAIL_CLOSED' | 'MUST_SETTLE'
 */
export function classify(domain, map = DETERMINISM_MAP) {
  const actual = mapSha(map);
  if (actual !== PINNED_MAP_SHA) {
    throw new Error(
      `classify: determinism-map sha mismatch (SKP-003). expected ${PINNED_MAP_SHA}, got ${actual}. ` +
      'A change to the map must be a deliberate, reviewed sha bump.',
    );
  }
  for (const rule of map.rules) {
    if (globMatch(rule.glob, domain)) return rule.posture;
  }
  return 'FAIL_CLOSED'; // SKP-006: unmatched is never FREE
}

// ── SNAPSHOT SIGNING HELPERS ─────────────────────────────────────────────────
// All crypto ops delegate to legba-core.mjs (sign, verify, jcs, sha256).
// No generateKeyPairSync here — key custody lives in legba (Gate 1 invariant).
const SCHEMA = 'settle.snapshot.v1';

function snapshotBytes(snapshot) {
  return Buffer.from(jcs(snapshot), 'utf8');
}

// Sign a VerificationSnapshot. Returns a SignedSnapshot.
export function signSnapshot(snapshot, privKey) {
  const sig = legbaSign(snapshotBytes(snapshot), privKey).toString('base64');
  const pubKey = createPublicKey(privKey).export({ type: 'spki', format: 'der' }).toString('base64');
  return { snapshot, alg: 'ed25519', sig, public_key: pubKey };
}

// Verify a snapshot signature. Returns { ok, reason }.
function verifySnapshotSig(signed) {
  try {
    const pub = createPublicKey({ key: Buffer.from(signed.public_key, 'base64'), format: 'der', type: 'spki' });
    const ok = legbaVerify(snapshotBytes(signed.snapshot), Buffer.from(signed.sig, 'base64'), pub);
    return { ok, reason: ok ? 'signature valid' : 'signature invalid' };
  } catch (e) {
    return { ok: false, reason: `verify error: ${e.message}` };
  }
}

// ── GATE (T-3) ────────────────────────────────────────────────────────────────
/**
 * Synchronous gate. Reads a signed snapshot, verifies sig + TTL + claim_id +
 * bar_sha binding, returns GateDecision. No async paths (A-5 mitigation).
 *
 * config: {
 *   trustedVerifierPublicKey: string,  // base64 SPKI-DER; required
 *   now: number,                        // injectable clock (integer)
 *   requiredTier: string,               // tier required to proceed
 *   claim_id?: string,                  // expected claim id (confused-deputy guard)
 *   bar_sha?: string,                   // expected bar sha (A-2 guard)
 * }
 */
export function checkSync(signed, config) {
  // Fail-closed at gate init: missing key throws before any other check (A-6, T-3 AC).
  if (!config || !config.trustedVerifierPublicKey) {
    throw new Error('checkSync: config.trustedVerifierPublicKey is required (fail-closed at gate init)');
  }

  const { trustedVerifierPublicKey, now, requiredTier, claim_id, bar_sha } = config;

  const deny = (reason) => ({
    proceed: false,
    earned_tier: 'abstained',
    required_tier: requiredTier,
    reason,
    snapshot_id: signed?.snapshot ? hashObj(signed.snapshot) : 'none',
  });

  if (!signed || !signed.snapshot) return deny('no snapshot provided');

  const snap = signed.snapshot;

  // Confused-deputy guard: claim_id must match if provided (A-6).
  if (claim_id !== undefined && snap.claim_id !== claim_id) {
    return deny(`snapshot claim_id mismatch: got ${snap.claim_id}, expected ${claim_id}`);
  }

  // Bar sha guard: bar_sha must match if provided (A-2).
  if (bar_sha !== undefined && snap.bar_sha !== bar_sha) {
    return deny(`snapshot bar_sha mismatch: got ${snap.bar_sha}, expected ${bar_sha}`);
  }

  // Trusted key check (A-6): snapshot must come from the configured verifier key.
  if (signed.public_key !== trustedVerifierPublicKey) {
    return deny('untrusted signer key');
  }

  // Signature check (A-6): sig must verify.
  const sigResult = verifySnapshotSig(signed);
  if (!sigResult.ok) return deny(`signature invalid: ${sigResult.reason}`);

  // TTL check (SKP-005a): snapshot must not be expired. Validate the clock and
  // snapshot times are non-negative safe integers FIRST — a NaN/string/missing
  // value slips past `now > prepared_at + ttl` (NaN comparisons are false),
  // failing OPEN on a malformed snapshot (FAGAN major). Fail closed instead.
  const { prepared_at, ttl } = snap;
  if (!Number.isSafeInteger(now) || now < 0) return deny(`invalid gate clock: now must be a non-negative safe integer, got ${now}`);
  if (!Number.isSafeInteger(prepared_at) || prepared_at < 0) return deny(`invalid snapshot prepared_at: must be a non-negative safe integer, got ${prepared_at}`);
  if (!Number.isSafeInteger(ttl) || ttl < 0) return deny(`invalid snapshot ttl: must be a non-negative safe integer, got ${ttl}`);
  if (now > prepared_at + ttl) {
    return deny(`snapshot expired (now ${now} > prepared_at ${prepared_at} + ttl ${ttl})`);
  }

  // G-7: degraded chain capped below settled.
  let earned_tier = snap.earned_tier;
  let degraded_capped = false;
  if (snap.chain_health === 'degraded' && earned_tier === 'settled') {
    earned_tier = 'pinned';
    degraded_capped = true;
  }

  const proceed = tierGte(earned_tier, requiredTier);
  // Preserve the G-7 cause in the reason even when the cap also fails the tier
  // check — the trail must record WHY (degraded chain), not just "< required".
  let reason;
  if (degraded_capped) {
    reason = `degraded chain capped settled->pinned (G-7); ${proceed ? `pinned >= required ${requiredTier}` : `pinned < required ${requiredTier} -> ABSTAIN/HALT`}`;
  } else if (proceed) {
    reason = `earned ${earned_tier} >= required ${requiredTier}`;
  } else {
    reason = `earned ${earned_tier} < required ${requiredTier} -> ABSTAIN/HALT`;
  }

  return {
    proceed,
    earned_tier,
    required_tier: requiredTier,
    reason,
    snapshot_id: hashObj(snap),
  };
}

// ── INDEPENDENT VERIFIER (T-5) ────────────────────────────────────────────────
/**
 * Re-execute the instrument against claim + bar. Map the recomputed verdict to
 * earned_tier. NEVER reads envelope.self_reported_verdict or self_reported_tier
 * in the decision path (A-1 mitigation).
 *
 * The caller supplies signerPrivKey (key custody is the embedder's job). Key
 * generation is NOT inline here — use generateVerifierKeypair() from legba-core.mjs
 * to generate a keypair without violating Gate 1 (generateKeyPairSync single-file).
 *
 * @returns { snapshot, sig, public_key } — a SignedSnapshot ready for checkSync.
 */
export async function verify(envelope, instrument, signerPrivKey, { now = 0, ttl = 86400 } = {}) {
  // Re-execute the instrument — this is the INDEPENDENT recompute path.
  // self_reported_verdict and self_reported_tier are NEVER read here (SKP-006).
  const result = await instrument.settle(envelope.claim, envelope.bar);

  const verdict = result.verdict;
  const chain_health = result.chain_health ?? 'ok';
  const earned_tier = verdictToEarnedTier(verdict);

  const snapshot = {
    schema: SCHEMA,
    claim_id: envelope.claim.id,
    domain: envelope.claim.domain,
    bar_sha: envelope.bar.sha,
    instrument_id: envelope.instrument_id,
    instrument_sha: envelope.instrument_sha,
    verdict,
    earned_tier,
    chain_health,
    prepared_at: now,
    ttl,
  };

  return signSnapshot(snapshot, signerPrivKey);
}

// ── TRAIL WRITER (T-6) ────────────────────────────────────────────────────────
// MAX_ROW_BYTES mirrors trail.live.ts: reject rows at/above this limit (not truncate).
const MAX_ROW_BYTES = 4096;

/**
 * Returns an AppendOnlyFileTrail: { write(row) }.
 * Each write is a single writeFileSync with flag:'a' (O_APPEND|O_WRONLY|O_CREAT).
 * Rows exceeding MAX_ROW_BYTES throw; never silently truncated.
 * Uses jcs from legba for canonical serialization (no local JSON.stringify ordering).
 */
export function makeTrailWriter(path) {
  return {
    write(row) {
      const line = jcs(row);
      const bytes = Buffer.from(line + '\n', 'utf8');
      if (bytes.byteLength >= MAX_ROW_BYTES) {
        throw new RangeError(
          `makeTrailWriter: row ${bytes.byteLength}B exceeds atomic-append limit ${MAX_ROW_BYTES}B (SKP-004). ` +
          'Shorten the entry or swap to a SqliteWalTrail.',
        );
      }
      writeFileSync(path, bytes, { flag: 'a' });
    },
  };
}

// ── GATED FACADE (T-3 / T-7) ─────────────────────────────────────────────────
/**
 * The ONLY public path to a must-settle capability.
 * rawCapability is not exported — it is trapped in this closure (A-4 mitigation).
 *
 * @param gate          object with checkSync(signed, config) method
 * @param rawCapability the high-blast-radius function; called only when gate proceeds
 * @returns facade object with run(signed, config) -> { proceeded, reason, result? }
 */
export function makeGatedFacade(gate, rawCapability) {
  if (!gate || typeof gate.checkSync !== 'function') {
    throw new TypeError('makeGatedFacade: gate must have a checkSync method');
  }
  return {
    run(signed, config) {
      const decision = gate.checkSync(signed, config);
      if (!decision.proceed) return { proceeded: false, reason: decision.reason };
      return { proceeded: true, reason: decision.reason, result: rawCapability() };
    },
  };
}
