#!/usr/bin/env node
/**
 * legba-signer-daemon.mjs — in-memory custody signer for Legba gate tokens.
 *
 * SECURITY: daemon mode is the hardened single-host path. The gatekeeper Ed25519
 * private key is generated on daemon start and kept in this process only; this
 * file never writes the private key to disk. Clients talk over LEGBA_SIGNER_SOCKET
 * and receive only public-key metadata or sealed gate tokens for independently
 * replayable evidence.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, lstatSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { buildGateToken, hashObj, jcs } from './legba-core.mjs';
import { REGISTRY } from './tools.mjs';

function keyId(gatekeeperId, keyVersion) {
  return createHash('sha256').update(`${gatekeeperId}:${keyVersion}`, 'utf8').digest('hex');
}

const keys = new Map();

function initKeys(gatekeeperId = 'legba:default', keyVersion = 1, { rotate = false } = {}) {
  const existing = keys.get(gatekeeperId);
  if (existing && !rotate) {
    return {
      gatekeeperId,
      keyVersion: existing.keyVersion,
      key_id: keyId(gatekeeperId, existing.keyVersion),
      publicKeyPem: existing.publicKeyPem,
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  keys.set(gatekeeperId, { privateKey, publicKeyPem, keyVersion });
  return { gatekeeperId, keyVersion, key_id: keyId(gatekeeperId, keyVersion), publicKeyPem };
}

function seal(token, gatekeeperId) {
  const k = keys.get(gatekeeperId);
  if (!k) throw Object.assign(new Error(`daemon key not initialized for ${gatekeeperId}`), { status: 'key_not_initialized' });
  const signature = sign(null, Buffer.from(jcs(token)), k.privateKey).toString('base64');
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
  if (!built.pass) refuse('independent_replay_failed', built.checks);
  return seal(built.token, built.gatekeeper_id);
}

function handle(req) {
  if (req.cmd === 'init-keys' || req.cmd === 'pubkey') {
    return initKeys(req.gatekeeperId || 'legba:default', Number(req.keyVersion || 1), { rotate: !!req.rotate });
  }
  if (req.cmd === 'sign-gate') return signGate(req);
  throw Object.assign(new Error(`unknown daemon command: ${req.cmd}`), { status: 'unknown_command' });
}

function responseFor(req) {
  try {
    return handle(req);
  } catch (e) {
    return { ok: false, status: e.status || 'signer_error', error: e.message, detail: e.detail || {} };
  }
}

const socketPath = process.env.LEGBA_SIGNER_SOCKET;
if (!socketPath) {
  process.stderr.write('LEGBA_SIGNER_SOCKET is required\n');
  process.exit(2);
}

if (existsSync(socketPath)) {
  if (!lstatSync(socketPath).isSocket()) {
    process.stderr.write(`LEGBA_SIGNER_SOCKET exists and is not a socket: ${socketPath}\n`);
    process.exit(1);
  }
  unlinkSync(socketPath);
}

const server = net.createServer((conn) => {
  let buf = '';
  conn.setEncoding('utf8');
  conn.on('data', (chunk) => { buf += chunk; });
  conn.on('end', () => {
    let req;
    try {
      req = JSON.parse(buf || '{}');
    } catch (e) {
      conn.end(JSON.stringify({ ok: false, status: 'bad_json', error: e.message }));
      return;
    }
    conn.end(JSON.stringify(responseFor(req)));
  });
});

server.on('error', (e) => {
  process.stderr.write(`signer daemon listen failed: ${e.code || e.message}: ${e.message}\n`);
  try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch { /* best effort cleanup */ }
  process.exit(1);
});

server.listen(socketPath, () => {
  process.stdout.write(JSON.stringify({ ok: true, socket: socketPath }) + '\n');
});

function shutdown() {
  server.close(() => {
    try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch { /* best effort cleanup */ }
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
