#!/usr/bin/env node
/**
 * legba-signer.mjs — custody signer for Legba gate tokens.
 *
 * SECURITY: this signer deliberately uses LEGBA_SIGNER_KEY_DIR, not the audited
 * process' LEGBA_AUDIT_KEY_DIR / ~/.config/loa/audit-keys path. In-repo custody
 * provides a separate process/key-custody boundary plus verify-before-sign teeth.
 * Full structural disjointness on a multi-tenant host still requires the operator
 * deployment step: run this signer under a separate OS UID with filesystem
 * permissions that the audited process cannot read.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { buildGateToken, hashObj, jcs } from './legba-core.mjs';
import { REGISTRY } from './tools.mjs';

function safeId(gatekeeperId) {
  return gatekeeperId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function signerKeyDir() {
  const d = process.env.LEGBA_SIGNER_KEY_DIR || join(homedir(), '.config', 'loa', 'legba-signer-keys');
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

function keyPaths(gatekeeperId) {
  const safe = safeId(gatekeeperId);
  const d = signerKeyDir();
  return { priv: join(d, `${safe}.priv`), pub: join(d, `${safe}.pub`) };
}

function keyId(gatekeeperId, keyVersion) {
  // Keep derivation byte-for-byte aligned with legba-core's sha(gatekeeperId:keyVersion).
  return createHash('sha256').update(`${gatekeeperId}:${keyVersion}`, 'utf8').digest('hex');
}

function loadOrInitSignerKeys(gatekeeperId = 'legba:default', keyVersion = 1, { rotate = false } = {}) {
  const p = keyPaths(gatekeeperId);
  if (!rotate && existsSync(p.priv) && existsSync(p.pub)) {
    return {
      gatekeeperId,
      keyVersion,
      key_id: keyId(gatekeeperId, keyVersion),
      publicKeyPem: readFileSync(p.pub, 'utf8'),
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(p.priv, priv, { mode: 0o600 });
  writeFileSync(p.pub, pub);
  return { gatekeeperId, keyVersion, key_id: keyId(gatekeeperId, keyVersion), publicKeyPem: pub };
}

function loadSignerPriv(gatekeeperId) {
  const p = keyPaths(gatekeeperId).priv;
  if (!existsSync(p)) throw new Error(`signer private key not found for ${gatekeeperId}`);
  return readFileSync(p, 'utf8');
}

function seal(token, gatekeeperId) {
  const signature = sign(null, Buffer.from(jcs(token)), loadSignerPriv(gatekeeperId)).toString('base64');
  return { token, signature, token_hash: hashObj(token) };
}

function refuse(status, detail = {}) {
  const err = new Error(status);
  err.status = status;
  err.detail = detail;
  throw err;
}

function signGate(req) {
  const built = buildGateToken(req.dir, {
    runId: req.runId,
    gateIndex: Number(req.gateIndex),
    registry: REGISTRY,
    artifacts: req.artifacts || [],
    sampleRate: req.sampleRate ?? 0.5,
  });

  if (built.reexec_count === 0 || built.replay_sample_count === 0) {
    refuse('no_verifiable_evidence', {
      reexec_count: built.reexec_count,
      replay_sample_count: built.replay_sample_count,
    });
  }
  if (!built.pass) {
    refuse('independent_replay_failed', built.checks);
  }
  return seal(built.token, built.gatekeeper_id);
}

function readStdinJson() {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('error', reject);
    process.stdin.on('end', () => {
      const raw = chunks.join('').trim();
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); } // malformed stdin → structured reject, not uncaughtException (F-002)
    });
  });
}

async function main() {
  const cmd = process.argv[2];
  const req = await readStdinJson();
  let out;
  if (cmd === 'init-keys' || cmd === 'pubkey') {
    out = loadOrInitSignerKeys(req.gatekeeperId || 'legba:default', Number(req.keyVersion || 1), { rotate: !!req.rotate });
  } else if (cmd === 'sign-gate') {
    out = signGate(req);
  } else {
    throw new Error(`unknown signer command: ${cmd}`);
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, status: e.status || 'signer_error', error: e.message, detail: e.detail || {} }));
  process.exit(1);
});
