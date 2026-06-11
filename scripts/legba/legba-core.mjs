/**
 * legba-core.mjs — file-backed Legba substrate (cycles 2–5: recorder, gatekeeper,
 * turnstile, verify/challenge). Adapts the operator-supplied reference impl
 * (legba.mjs, in-memory) onto a real, root-independent run directory so an
 * operator can record, gate, and VERIFY actual composition runs.
 *
 * Schema shapes (SpanMove / GateToken / RunReceipt) mirror loa-hounfour PR #118
 * (legba/cycle-1-schemas). PROVISIONAL until that PR merges — field names and
 * the contract_version literal track the proposal.
 *
 * Zero dependencies: node:crypto + node:fs only. Mirrors the reference's
 * discipline (ed25519 + sha256 + JCS-lite). The JCS here is the RFC-8785 SUBSET
 * sufficient for these flat shapes; swap in a full impl before cross-runtime
 * producers appear (same caveat the reference carries).
 *
 * Run-dir layout (LG-10: ONE canonical, root-independent address):
 *   <run-dir>/                     default ~/.loa/runs/<run_id>/
 *     manifest.json                run_id, gatekeeper pubkey + key_id, contract_version
 *     cas/<sha256hex>.json         content-addressed input/output/emission bodies
 *     spans/span-<n>.log.jsonl     the hash-chained move log per span
 *     tokens/token-<n>.json        sealed gate tokens (the custody chain)
 *     receipt.json                 the run receipt (token-hash chain → one hash)
 * Keys: ed25519 keypair in ~/.config/loa/audit-keys/<gatekeeperId>.{priv,pub}
 *       (key ceremony); the PUBLIC key is also copied into the run manifest so a
 *       third party verifies with the run dir alone.
 */
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync,
  appendFileSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const CONTRACT_VERSION = '8.8.0'; // tracks hounfour PR #118 (provisional)
export const GENESIS = 'sha256:' + '0'.repeat(64);

// ── canonicalization + hashing (RFC-8785 subset) ────────────────────────────
export function jcs(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
export const sha256 = (s) => 'sha256:' + sha(s);
export const hashObj = (o) => sha256(jcs(o));
/** record_hash convention (LM-3): sha256 of JCS(record with record_hash key ABSENT), bare hex. */
export const recordHashBare = (rec) => {
  const { record_hash: _omit, ...rest } = rec;
  return sha(jcs(rest));
};

// ── run dir + key ceremony ──────────────────────────────────────────────────
export function runDir(runId, base) {
  return base || join(homedir(), '.loa', 'runs', runId);
}
function keyDir() {
  const d = join(homedir(), '.config', 'loa', 'audit-keys');
  mkdirSync(d, { recursive: true });
  return d;
}
/** Key ceremony: generate a per-room ed25519 keypair, persist it, publish nothing yet. */
export function initKeys(gatekeeperId = 'legba:default', keyVersion = 1) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const kd = keyDir();
  const safe = gatekeeperId.replace(/[^A-Za-z0-9._-]/g, '_');
  writeFileSync(join(kd, `${safe}.priv`), priv, { mode: 0o600 });
  writeFileSync(join(kd, `${safe}.pub`), pub);
  // key_id = sha256(gatekeeperId ':' keyVersion) bare hex — hounfour derivation invariant
  const key_id = sha(`${gatekeeperId}:${keyVersion}`);
  return { gatekeeperId, keyVersion, key_id, publicKeyPem: pub, _privateKeyPem: priv };
}
function loadPriv(gatekeeperId) {
  const safe = gatekeeperId.replace(/[^A-Za-z0-9._-]/g, '_');
  return readFileSync(join(keyDir(), `${safe}.priv`), 'utf8');
}
/**
 * Load an existing gatekeeper keypair, or run the ceremony if none exists.
 * Provisioning a second run with the same gatekeeper MUST NOT silently rotate the
 * key — an earlier still-open run's manifest holds the old public key and would
 * fail to verify gates signed by a new private key. Pass {rotate:true} to mint a
 * fresh key on purpose. (Codex P2.)
 */
export function loadOrInitKeys(gatekeeperId = 'legba:default', keyVersion = 1, { rotate = false } = {}) {
  const safe = gatekeeperId.replace(/[^A-Za-z0-9._-]/g, '_');
  const privPath = join(keyDir(), `${safe}.priv`);
  const pubPath = join(keyDir(), `${safe}.pub`);
  if (!rotate && existsSync(privPath) && existsSync(pubPath)) {
    return {
      gatekeeperId, keyVersion, key_id: sha(`${gatekeeperId}:${keyVersion}`),
      publicKeyPem: readFileSync(pubPath, 'utf8'), _privateKeyPem: readFileSync(privPath, 'utf8'),
    };
  }
  return initKeys(gatekeeperId, keyVersion);
}

// ── manifest ────────────────────────────────────────────────────────────────
export function provisionRun(runId, gk, base) {
  const dir = runDir(runId, base);
  for (const sub of ['cas', 'spans', 'tokens']) mkdirSync(join(dir, sub), { recursive: true });
  const manifest = {
    run_id: runId, contract_version: CONTRACT_VERSION,
    gatekeeper_id: gk.gatekeeperId, gatekeeper_key_id: gk.key_id, key_version: gk.keyVersion,
    gatekeeper_pubkey_pem: gk.publicKeyPem,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

// ── CAS (file-backed) ────────────────────────────────────────────────────────
function casPut(dir, value) {
  const body = jcs(value);
  const h = sha(body);
  writeFileSync(join(dir, 'cas', `${h}.json`), body);
  return h; // bare hex
}
// Content-addressing is ENFORCED, not assumed: a blob whose file content no
// longer hashes to its filename is rejected (a blob edited in place keeping its
// hash-name must NOT pass). Without this, verify/challenge would replay against
// altered inputs — the store would not be tamper-evident. (Codex P1.)
function casGet(dir, hashBare) {
  const p = join(dir, 'cas', `${hashBare}.json`);
  if (!existsSync(p)) return undefined;
  const raw = readFileSync(p, 'utf8');
  if (sha(raw) !== hashBare) return undefined; // tampered blob — content ≠ name
  return JSON.parse(raw);
}
function casHas(dir, hashBare) {
  const p = join(dir, 'cas', `${hashBare}.json`);
  return existsSync(p) && sha(readFileSync(p, 'utf8')) === hashBare;
}

// ── recorder (LG-1): append one chained SpanMove ─────────────────────────────
function spanLogPath(dir, spanIndex) { return join(dir, 'spans', `span-${spanIndex}.log.jsonl`); }
function readSpanLog(dir, spanIndex) {
  const p = spanLogPath(dir, spanIndex);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** Append a move. determinism: 're_executable' (needs env_fingerprint) | 'attestable'. */
export function record(dir, { runId, spanIndex, kind, determinism, tool, label, input, output, content, envFingerprint }) {
  const log = readSpanLog(dir, spanIndex);
  const seq = log.length;
  const prev_hash = seq === 0 ? GENESIS : 'sha256:' + log[seq - 1].record_hash;
  const move = {
    move_kind: 'legba_span_move', contract_version: CONTRACT_VERSION,
    run_id: runId, span_index: spanIndex, seq, prev_hash, kind, determinism,
    ts: new Date().toISOString().replace('Z', '000Z'), // microsecond-ish; pinned format
  };
  if (kind === 'tool') {
    move.tool = tool;
    move.input_hash = casPut(dir, input);
    move.output_hash = casPut(dir, output);
    if (determinism === 're_executable') move.env_fingerprint = envFingerprint || sha('env:reference');
  } else {
    move.label = label;
    move.input_hash = casPut(dir, { label });
    move.output_hash = casPut(dir, content);
  }
  // canonical size cap (LM-5): refuse loudly, never truncate
  if (Buffer.byteLength(jcs({ ...move, record_hash: '' }), 'utf8') > 4096)
    throw new Error('LEGBA_MOVE_TOO_LARGE: canonical move exceeds 4096 bytes');
  move.record_hash = recordHashBare(move);
  appendFileSync(spanLogPath(dir, spanIndex), JSON.stringify(move) + '\n');
  return move.record_hash;
}

// ── chain replay (LG-2) ──────────────────────────────────────────────────────
export function replayChain(log) {
  let prev = GENESIS;
  for (const m of log) {
    if (m.prev_hash !== prev) throw new Error(`chain break at seq ${m.seq}: prev_hash mismatch`);
    if (recordHashBare(m) !== m.record_hash) throw new Error(`chain break at seq ${m.seq}: record tampered`);
    prev = 'sha256:' + m.record_hash;
  }
  return prev === GENESIS ? null : prev.slice(7); // bare head
}

// ── token sign/verify ────────────────────────────────────────────────────────
function signToken(token, gatekeeperId) {
  const signature = sign(null, Buffer.from(jcs(token)), loadPriv(gatekeeperId)).toString('base64');
  return { token, signature, token_hash: hashObj(token) };
}
export function verifyTokenSignature(sealed, pubkeyPem) {
  return verify(null, Buffer.from(jcs(sealed.token)), pubkeyPem, Buffer.from(sealed.signature, 'base64'));
}

// ── gatekeeper (LG-3/4/6): close span, check, mint token ─────────────────────
export function gate(dir, { runId, gateIndex, registry = {}, artifacts = [], sampleRate = 0.5 }) {
  const log = readSpanLog(dir, gateIndex);
  const checks = {};
  let head = null;
  try { head = replayChain(log); checks.chain = true; }
  catch (e) { checks.chain = false; checks.chain_error = e.message; }

  const refs = log.flatMap((m) => [m.input_hash, m.output_hash].filter(Boolean));
  checks.cas_complete = refs.every((h) => casHas(dir, h));

  const reexec = log.filter((m) => m.determinism === 're_executable');
  const sampled = reexec.filter((_, i) => reexec.length <= 2 || (i / reexec.length) < sampleRate);
  checks.replay = sampled.every((m) => {
    const fn = registry[m.tool];
    if (!fn) return false;
    return sha(jcs(fn(casGet(dir, m.input_hash)))) === m.output_hash;
  });
  checks.replay_sampled = `${sampled.length}/${reexec.length}`;

  const artifact_hashes = artifacts.map((a) => 'sha256:' + casPut(dir, a));
  const prevPath = join(dir, 'tokens', `token-${gateIndex - 1}.json`);
  const prevSealed = gateIndex > 0 && existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
  const man = readManifest(dir);

  const pass = checks.chain && checks.cas_complete && checks.replay;
  const token = {
    token_kind: 'legba_gate_token', contract_version: CONTRACT_VERSION,
    run_id: runId, gate_index: gateIndex, wave_number: 0,
    prev_token_hash: prevSealed ? prevSealed.token_hash : GENESIS,
    span_log_head: head, span_move_count: log.length,
    artifact_hashes,
    verdict: pass ? 'pass' : 'fail',
    checks: {
      chain: !!checks.chain, cas_complete: !!checks.cas_complete,
      replay_sample: checks.replay ? 'pass' : 'fail', artifact_shape: true,
    },
    replay_seed: sha((head || '') + ':seed'), // reference seed (full impl binds gatekeeper sig)
    gatekeeper_key_id: man.gatekeeper_key_id, key_version: man.key_version,
    ts: new Date().toISOString().replace('Z', '000Z'),
  };
  const sealed = signToken(token, man.gatekeeper_id);
  writeFileSync(join(dir, 'tokens', `token-${gateIndex}.json`), JSON.stringify(sealed, null, 2));
  return sealed;
}

// ── turnstile (LG-3): refuse to open span N>0 without gate N-1's pass token ──
export function openSpan(dir, { runId, spanIndex }) {
  if (spanIndex === 0) return { ok: true };
  const man = readManifest(dir);
  const prevPath = join(dir, 'tokens', `token-${spanIndex - 1}.json`);
  if (!existsSync(prevPath))
    throw new Error(`LEGBA_REFUSED: span ${spanIndex} requires the gate-${spanIndex - 1} token. No key, no crossing.`);
  const sealed = JSON.parse(readFileSync(prevPath, 'utf8'));
  if (!verifyTokenSignature(sealed, man.gatekeeper_pubkey_pem))
    throw new Error('LEGBA_REFUSED: entry token signature invalid.');
  const t = sealed.token;
  if (t.run_id !== runId) throw new Error('LEGBA_REFUSED: entry token belongs to a different run.');
  if (t.gate_index !== spanIndex - 1) throw new Error(`LEGBA_REFUSED: token is for gate ${t.gate_index}, span ${spanIndex} needs gate ${spanIndex - 1}.`);
  if (t.verdict !== 'pass') throw new Error('LEGBA_REFUSED: entry token verdict is not pass (terminal).');
  return { ok: true };
}

// ── whole-run verification (LG: third party, run dir + public key only) ──────
export function verifyRun(dir) {
  const man = readManifest(dir);
  const pub = man.gatekeeper_pubkey_pem;
  const tokenFiles = existsSync(join(dir, 'tokens'))
    ? readdirSync(join(dir, 'tokens')).filter((f) => f.endsWith('.json'))
        .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))
    : [];
  const report = { run_id: man.run_id, ok: true, gates: [] };
  let prevHash = GENESIS;
  const tokenHashes = [];
  for (const tf of tokenFiles) {
    const sealed = JSON.parse(readFileSync(join(dir, 'tokens', tf), 'utf8'));
    const t = sealed.token;
    const log = readSpanLog(dir, t.gate_index);
    const g = {
      gate_index: t.gate_index,
      signature: verifyTokenSignature(sealed, pub),
      custody: t.prev_token_hash === prevHash,
      span_head: (() => { try { return replayChain(log) === t.span_log_head; } catch { return false; } })(),
      artifacts_present: t.artifact_hashes.every((h) => casHas(dir, h.replace('sha256:', ''))),
      verdict_pass: t.verdict === 'pass',
    };
    g.ok = g.signature && g.custody && g.span_head && g.artifacts_present && g.verdict_pass;
    report.gates.push(g);
    report.ok = report.ok && g.ok;
    prevHash = sealed.token_hash;
    tokenHashes.push(sealed.token_hash);
  }
  report.run_receipt_hash = hashObj(tokenHashes);
  report.gate_count = tokenFiles.length;
  return report;
}

// ── fraud proof (LG-4): challenge one re_executable move, any time ───────────
export function challenge(dir, spanIndex, seq, registry = {}) {
  const log = readSpanLog(dir, spanIndex);
  const m = log[seq];
  if (!m) return { challengeable: false, reason: `no move at span ${spanIndex} seq ${seq}` };
  if (m.determinism !== 're_executable')
    return { challengeable: false, reason: 'attestable move: sampled-but-signed, no replay exists. Verify via reconstruction tests, not re-execution.' };
  const fn = registry[m.tool];
  const input = casGet(dir, m.input_hash);
  if (!fn || input === undefined) return { challengeable: true, ok: false, reason: 'tool or input unavailable — custody failure' };
  const recomputed = sha(jcs(fn(input)));
  return { challengeable: true, ok: recomputed === m.output_hash, recorded: m.output_hash, recomputed };
}

export { casGet, casHas, readSpanLog, readManifest };
