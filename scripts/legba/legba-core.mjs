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
import { createHash, createPublicKey, generateKeyPairSync, sign as _sign, verify as _verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync,
  appendFileSync, chmodSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
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
  const d = process.env.LEGBA_AUDIT_KEY_DIR || process.env.LOA_AUDIT_KEY_DIR || join(homedir(), '.config', 'loa', 'audit-keys');
  mkdirSync(d, { recursive: true });
  return d;
}
function custodySignerPath() {
  const v = process.env.LEGBA_SIGNER;
  if (!v) return null;
  if (v === '1' || v === 'true') return new URL('./legba-signer.mjs', import.meta.url).pathname;
  return v;
}
function custodySignerSocket() {
  return process.env.LEGBA_SIGNER_SOCKET || null;
}
function custodyRelayPath() {
  return new URL('./legba-signer-relay.mjs', import.meta.url).pathname;
}
function callSigner(cmd, payload) {
  const socketPath = custodySignerSocket();
  if (socketPath) {
    try {
      const stdout = execFileSync(process.execPath, [custodyRelayPath(), cmd], {
        input: JSON.stringify(payload ?? {}),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 10_000, // a hung signer must not wedge gate() indefinitely (F-001)
        env: { ...process.env, LEGBA_SIGNER_SOCKET: socketPath, LEGBA_SIGNER: '', LEGBA_AUDIT_KEY_DIR: '', LOA_AUDIT_KEY_DIR: '' },
      });
      return JSON.parse(stdout);
    } catch (e) {
      let msg = e.message;
      try {
        const parsed = JSON.parse(e.stdout || '');
        msg = parsed.error || parsed.status || msg;
      } catch { /* keep child_process error */ }
      throw new Error(`LEGBA_SIGNER_REFUSED: ${msg}`);
    }
  }
  const signerPath = custodySignerPath();
  if (!signerPath) throw new Error('LEGBA_CUSTODY_DISABLED: no LEGBA_SIGNER configured');
  try {
    const stdout = execFileSync(process.execPath, [signerPath, cmd], {
      input: JSON.stringify(payload ?? {}),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000, // a hung signer must not wedge gate() indefinitely (F-001)
      // Custody mode must not let the signer resolve the audited process key dir,
      // and must not re-enter custody itself (F-005 latent-loop guard).
      env: { ...process.env, LEGBA_SIGNER: '', LEGBA_SIGNER_SOCKET: '', LEGBA_AUDIT_KEY_DIR: '', LOA_AUDIT_KEY_DIR: '' },
    });
    return JSON.parse(stdout);
  } catch (e) {
    let msg = e.message;
    try {
      const parsed = JSON.parse(e.stdout || '');
      msg = parsed.error || parsed.status || msg;
    } catch { /* keep child_process error */ }
    throw new Error(`LEGBA_SIGNER_REFUSED: ${msg}`);
  }
}
/** Key ceremony: generate a per-room ed25519 keypair, persist it, publish nothing yet. */
export function initKeys(gatekeeperId = 'legba:default', keyVersion = 1) {
  if (custodySignerSocket() || custodySignerPath()) return callSigner('init-keys', { gatekeeperId, keyVersion });
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
  if (custodySignerSocket() || custodySignerPath()) return callSigner('init-keys', { gatekeeperId, keyVersion, rotate });
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

// ── rooted trust-store (merge verify path) ───────────────────────────────────
function repoRoot() {
  return new URL('../..', import.meta.url).pathname;
}
// BB #59 F-001: the trust anchor MUST live outside the attacker's write path.
// Strict defaults resolve to the operator's out-of-band ~/.config/loa, NOT the
// repo tree; in strict mode an anchor resolving inside the repo is rejected.
// (Env overrides remain for non-strict/bootstrap only — see resolveGatekeeperPubkey.)
const operatorRootDir = () => join(homedir(), '.config', 'loa');
const defaultTrustStorePath = () => join(operatorRootDir(), 'trust-store.yaml');
const defaultPinnedRootPath = () => join(operatorRootDir(), 'maintainer-root-pubkey.txt');
function isInsideRepo(p) {
  const root = resolve(repoRoot());
  const rp = resolve(p);
  return rp === root || rp.startsWith(root + sep);
}
function stripInlineComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'") && s[i - 1] !== '\\') quote = quote === c ? null : (quote || c);
    if (c === '#' && !quote && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}
function scalar(s) {
  const v = stripInlineComment(s).trim();
  if (v === '[]') return [];
  if (v === 'null') return null;
  if (v === '""' || v === "''") return '';
  const q = v.match(/^["'](.*)["']$/);
  return q ? q[1] : v;
}
function readBlock(lines, i, indent) {
  const out = [];
  const pad = ' '.repeat(indent);
  while (i < lines.length && (lines[i].startsWith(pad) || lines[i].trim() === '')) {
    if (lines[i].trim() !== '') out.push(lines[i].slice(indent));
    i++;
  }
  return { value: out.join('\n') + (out.length ? '\n' : ''), next: i };
}
function parseMap(lines, i, indent) {
  const obj = {};
  const pad = ' '.repeat(indent);
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.startsWith(pad) || raw.startsWith(pad + '  ') || raw.trim().startsWith('- ')) break;
    const line = stripInlineComment(raw.slice(indent));
    if (!line || !line.includes(':')) { i++; continue; }
    const [k, ...rest] = line.split(':');
    const val = rest.join(':').trim();
    if (val === '|') {
      const block = readBlock(lines, i + 1, indent + 2);
      obj[k.trim()] = block.value;
      i = block.next;
    } else {
      obj[k.trim()] = scalar(val);
      i++;
    }
  }
  return { value: obj, next: i };
}
function parseList(lines, i, indent) {
  const arr = [];
  const itemPad = ' '.repeat(indent) + '- ';
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.startsWith(itemPad)) break;
    const obj = {};
    const first = stripInlineComment(raw.slice(itemPad.length));
    i++;
    if (first && first.includes(':')) {
      const [k, ...rest] = first.split(':');
      obj[k.trim()] = scalar(rest.join(':').trim());
    }
    const props = parseMap(lines, i, indent + 2);
    Object.assign(obj, props.value);
    i = props.next;
    arr.push(obj);
  }
  return { value: arr, next: i };
}
function parseTrustStoreYaml(raw) {
  const lines = raw.split('\n').filter((l) => {
    const t = l.trim();
    return t && t !== '---' && !t.startsWith('#');
  });
  const doc = {};
  for (let i = 0; i < lines.length;) {
    if (/^\s/.test(lines[i])) { i++; continue; }
    const line = stripInlineComment(lines[i]);
    const [k, ...rest] = line.split(':');
    const key = k.trim();
    const val = rest.join(':').trim();
    i++;
    if (val) {
      doc[key] = scalar(val);
    } else if (key === 'keys' || key === 'revocations') {
      const list = parseList(lines, i, 2);
      doc[key] = list.value;
      i = list.next;
    } else {
      const map = parseMap(lines, i, 2);
      doc[key] = map.value;
      i = map.next;
    }
  }
  if (!Array.isArray(doc.keys)) doc.keys = [];
  if (!Array.isArray(doc.revocations)) doc.revocations = [];
  return doc;
}
function pemDer(pem) {
  return createPublicKey(pem).export({ type: 'spki', format: 'der' });
}
function samePem(a, b) {
  try { return pemDer(a).equals(pemDer(b)); } catch { return false; }
}
function keyIdOf(k) {
  return k.key_id || k.gatekeeper_key_id || k.writer_id || k.id;
}
function keyMatches(k, man) {
  return keyIdOf(k) === man.gatekeeper_key_id || keyIdOf(k) === man.gatekeeper_id
    || k.gatekeeper_id === man.gatekeeper_id || k.writer_id === man.gatekeeper_id;
}
function trustStoreBootstrap(doc) {
  const rs = doc?.root_signature || {};
  return (!doc || ((doc.keys || []).length === 0 && (doc.revocations || []).length === 0
    && !(rs.signature || '').trim()));
}
function verifyTrustStore(doc, pinnedRootPubkeyPath) {
  const rs = doc.root_signature;
  if (!doc.schema_version) return { ok: false, error: 'trust-store missing schema_version' };
  if (!rs || rs.algorithm !== 'ed25519') return { ok: false, error: 'trust-store missing ed25519 root_signature' };
  if (!rs.signer_pubkey || !rs.signature) return { ok: false, error: 'trust-store missing root signer/signature' };
  if (!existsSync(pinnedRootPubkeyPath)) return { ok: false, error: `pinned root pubkey not found: ${pinnedRootPubkeyPath}` };
  const pinned = readFileSync(pinnedRootPubkeyPath, 'utf8');
  if (!samePem(rs.signer_pubkey, pinned)) return { ok: false, error: 'trust-store signer_pubkey diverges from pinned root pubkey' };
  const core = {
    schema_version: doc.schema_version,
    keys: doc.keys || [],
    revocations: doc.revocations || [],
    trust_cutoff: doc.trust_cutoff || {},
  };
  let ok = false;
  try { ok = _verify(null, Buffer.from(jcs(core)), pinned, Buffer.from(rs.signature, 'base64')); }
  catch { ok = false; }
  return ok ? { ok: true } : { ok: false, error: 'trust-store root_signature does NOT verify' };
}
// EXPORTED (trust-root-proof, 2026-06-24): the audit sweep found the rooted trust-store is the one
// sound trust anchor in the brakes layer, but no consumer could REACH it — it lived private to
// verifyRun. Exporting it is the enabling step the deferred fixes (poteau zss, settle fgl) need:
// a consumer can now resolve its gatekeeper pubkey through the pinned maintainer root instead of an
// agent-substitutable key. Pure + read-only (resolves files, verifies the root signature, returns
// a verdict object) — no side effects.
export function resolveGatekeeperPubkey(man, {
  strict = true,
  trustStorePath,
  pinnedRootPubkeyPath,
} = {}) {
  // BB #59 F-002: in strict mode the anchor must not be set by ambient env.
  // Env overrides are honored only in non-strict/bootstrap mode AND only when the
  // caller did not pass explicit trusted paths; their presence in strict fails closed.
  const envTs = process.env.LOA_TRUST_STORE_FILE;
  const envPk = process.env.LOA_PINNED_ROOT_PUBKEY_PATH;
  if (strict && trustStorePath === undefined && pinnedRootPubkeyPath === undefined && (envTs || envPk)) {
    return { ok: false, status: 'env_override_in_strict',
      error: 'strict verify refuses env-supplied trust anchors (LOA_TRUST_STORE_FILE / LOA_PINNED_ROOT_PUBKEY_PATH); pass an explicit trusted path' };
  }
  trustStorePath = trustStorePath ?? (strict ? defaultTrustStorePath() : (envTs || defaultTrustStorePath()));
  pinnedRootPubkeyPath = pinnedRootPubkeyPath ?? (strict ? defaultPinnedRootPath() : (envPk || defaultPinnedRootPath()));
  // BB #59 F-001: in strict/merge mode the anchor must be out-of-band, never the repo tree.
  if (strict && (isInsideRepo(trustStorePath) || isInsideRepo(pinnedRootPubkeyPath))) {
    return { ok: false, status: 'anchor_in_repo',
      error: 'strict verify refuses a trust anchor inside the repo working tree; provision the root key out-of-band' };
  }
  if (!existsSync(trustStorePath)) {
    if (!strict) return { ok: true, pubkeyPem: man.gatekeeper_pubkey_pem, rooted: false, status: 'bootstrap_pending', reason: 'trust-store missing' };
    return { ok: false, status: 'missing', error: `trust-store not found: ${trustStorePath}` };
  }
  let doc;
  try { doc = parseTrustStoreYaml(readFileSync(trustStorePath, 'utf8')); }
  catch (e) { return { ok: false, status: 'invalid', error: `trust-store parse failed: ${e.message}` }; }
  if (trustStoreBootstrap(doc)) {
    if (!strict) return { ok: true, pubkeyPem: man.gatekeeper_pubkey_pem, rooted: false, status: 'bootstrap_pending', reason: 'trust-store BOOTSTRAP-PENDING' };
    return { ok: false, status: 'bootstrap_pending', error: 'trust-store BOOTSTRAP-PENDING is not valid for strict verify' };
  }
  // BB #59 F-003: a store claiming to be rooted must be structurally valid; fail closed
  // loudly rather than letting the narrow YAML parser silently reshape it past verification.
  if (typeof doc.schema_version !== 'string' || !Array.isArray(doc.keys) || !Array.isArray(doc.revocations)
      || typeof doc.root_signature !== 'object' || doc.root_signature === null) {
    return { ok: false, status: 'invalid', error: 'trust-store failed schema validation (malformed structure)' };
  }
  const root = verifyTrustStore(doc, pinnedRootPubkeyPath);
  if (!root.ok) return { ok: false, status: 'unrooted', error: root.error };
  const rooted = (doc.keys || []).find((k) => keyMatches(k, man) && k.pubkey_pem);
  if (!rooted) return { ok: false, status: 'key_not_rooted', error: `gatekeeper key not rooted: ${man.gatekeeper_id}/${man.gatekeeper_key_id}` };
  const revoked = (doc.revocations || []).some((r) => keyMatches(r, man) && (!r.pubkey_pem || samePem(r.pubkey_pem, rooted.pubkey_pem)));
  if (revoked) return { ok: false, status: 'revoked', error: `gatekeeper key revoked: ${man.gatekeeper_id}/${man.gatekeeper_key_id}` };
  if (!samePem(rooted.pubkey_pem, man.gatekeeper_pubkey_pem)) {
    return { ok: false, status: 'manifest_divergence', error: 'manifest gatekeeper_pubkey_pem diverges from rooted trust-store key' };
  }
  return { ok: true, pubkeyPem: rooted.pubkey_pem, rooted: true, status: 'rooted' };
}

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
  if (custodySignerSocket() || custodySignerPath()) throw new Error('LEGBA_CUSTODY_REFUSED_LOCAL_SIGN: custody mode requires signer-mediated gate signing');
  const signature = _sign(null, Buffer.from(jcs(token)), loadPriv(gatekeeperId)).toString('base64');
  return { token, signature, token_hash: hashObj(token) };
}
export function verifyTokenSignature(sealed, pubkeyPem) {
  return _verify(null, Buffer.from(jcs(sealed.token)), pubkeyPem, Buffer.from(sealed.signature, 'base64'));
}

// ── gatekeeper (LG-3/4/6): close span, check, mint token ─────────────────────
export function buildGateToken(dir, { runId, gateIndex, registry = {}, artifacts = [], sampleRate = 0.5 }) {
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
  return { token, checks, pass, reexec_count: reexec.length, replay_sample_count: sampled.length, gatekeeper_id: man.gatekeeper_id };
}

export function gate(dir, { runId, gateIndex, registry = {}, artifacts = [], sampleRate = 0.5 }) {
  // Run the checks CALLER-side FIRST, always. The replay check (buildGateToken,
  // line ~468) re-executes each re_executable move via `registry[tool]` — JS
  // closures that exist ONLY in this process. A custody signer daemon cannot
  // receive them (functions are not serializable), and verifyRun TRUSTS the
  // token verdict (it does not re-run the replay). So a custody path that signed
  // without first enforcing the replay here would let it be bypassed (#83
  // cross-model council finding). Build + enforce here, fail-closed, then sign.
  const built = buildGateToken(dir, { runId, gateIndex, registry, artifacts, sampleRate });
  if (custodySignerSocket() || custodySignerPath()) {
    if (!built.pass) {
      throw new Error(
        `LEGBA_REFUSED: gate ${gateIndex} checks failed caller-side ` +
        `(${JSON.stringify(built.checks)}) — refusing to request a custody signature ` +
        `for a gate whose replay/chain/CAS checks did not pass.`,
      );
    }
    // ARCHITECTURAL RESIDUAL (filed): the daemon still rebuilds + signs its own
    // token without the registry, so the SIGNED verdict is not bound to the
    // caller's replay result. The full fix binds built.token (or its replay
    // verdict) into the signature so verifyRun checks the replay that ran. The
    // caller-side gate above closes the normal-path bypass; a direct call to the
    // signer still needs the daemon to enforce/bind the replay.
    const sealed = callSigner('sign-gate', { dir, runId, gateIndex, artifacts, sampleRate });
    writeFileSync(join(dir, 'tokens', `token-${gateIndex}.json`), JSON.stringify(sealed, null, 2));
    return sealed;
  }
  const sealed = signToken(built.token, built.gatekeeper_id);
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
export function verifyRun(dir, options = {}) {
  const man = readManifest(dir);
  const resolved = resolveGatekeeperPubkey(man, options);
  const tokenFiles = existsSync(join(dir, 'tokens'))
    ? readdirSync(join(dir, 'tokens')).filter((f) => f.endsWith('.json'))
        .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))
    : [];
  const report = { run_id: man.run_id, ok: resolved.ok, trust_store: resolved.ok
    ? { status: resolved.status, rooted: !!resolved.rooted }
    : { status: resolved.status, error: resolved.error }, gates: [] };
  if (!resolved.ok) {
    report.run_receipt_hash = hashObj([]);
    report.gate_count = tokenFiles.length;
    return report;
  }
  if (tokenFiles.length === 0) {
    report.ok = false;
    report.empty = true;
    report.run_receipt_hash = hashObj([]);
    report.gate_count = 0;
    return report;
  }
  const pub = resolved.pubkeyPem;
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

// ── ed25519 primitives for consumers (settle borrows legba's key custody) ────
/** Sign `data` with an ed25519 private key. Returns a Buffer. */
export const sign = (data, privKey) =>
  _sign(null, Buffer.isBuffer(data) ? data : Buffer.from(data), privKey);

/** Verify an ed25519 signature. `sig` may be a Buffer or base64 string. Returns boolean. */
export const verify = (data, sig, pubKey) =>
  _verify(
    null,
    Buffer.isBuffer(data) ? data : Buffer.from(data),
    pubKey,
    Buffer.isBuffer(sig) ? sig : Buffer.from(sig, 'base64'),
  );

/** Generate an ephemeral ed25519 keypair. Used by settle verifier / tests — keeps
 *  generateKeyPairSync out of settle.mjs (Gate 1: single signer). */
export function generateVerifierKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}
