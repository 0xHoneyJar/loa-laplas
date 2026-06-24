// poteau-verify-receipts.test.mjs — the verify-side teeth (construct-rooms-substrate-chk).
// The chain-only verifier accepted a receipts.jsonl with no valid signature; this proves the
// signature check catches that forge, rejects tampering, and fails closed without a pubkey.
//
// Run: node --test poteau/bin/poteau-verify-receipts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

const VERIFY = join(dirname(fileURLToPath(import.meta.url)), 'poteau-verify-receipts.mjs');
const jcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'poteau-vr-'));
const run = (args, env = {}) => spawnSync(process.execPath, [VERIFY, ...args], { encoding: 'utf8', env: { ...process.env, LEGBA_SIGNER_SOCKET: '', POTEAU_SIGNER_SOCKET: '', ...env } });

// build a 2-link chain; `mutate` optionally tampers the sealed object after signing.
function writeChain(cwd, signer, mutate = (s) => s) {
  let prev = null; const lines = [];
  for (const gate_index of [0, 1]) {
    const receipt = { receipt_kind: 'poteau_gate_pass', run_id: 'r1', gate_index, prev_receipt_hash: prev };
    const sealed = mutate({ receipt, signature: signer(receipt), receipt_hash: sha(jcs(receipt)) });
    lines.push(JSON.stringify(sealed));
    prev = sealed.receipt_hash;
  }
  const p = join(cwd, 'receipts.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}
function withPub(cwd) {
  const kp = generateKeyPairSync('ed25519');
  const pubPath = join(cwd, 'gate.key.pub');
  writeFileSync(pubPath, kp.publicKey.export({ type: 'spki', format: 'pem' }));
  return { kp, pubPath };
}

test('authentic chain signed by the gatekeeper key → verified (exit 0)', () => {
  const cwd = tmp();
  try {
    const { kp, pubPath } = withPub(cwd);
    const chain = writeChain(cwd, (r) => sign(null, Buffer.from(jcs(r)), kp.privateKey).toString('base64'));
    const r = run([chain, pubPath]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout.trim()).verified, 2);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('FORGED: a chain-valid receipt with a bogus signature → REJECTED (exit 4) — the gap the chain-only verifier missed', () => {
  const cwd = tmp();
  try {
    const { pubPath } = withPub(cwd);
    // the forger writes a chain-valid receipt but does NOT hold the key → a fabricated signature
    const chain = writeChain(cwd, () => Buffer.from('not-a-real-signature').toString('base64'));
    const r = run([chain, pubPath]);
    assert.equal(r.status, 4);
    assert.match(r.stderr, /signature does NOT verify/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('TAMPERED: signed, then receipt body mutated without re-hashing → REJECTED (exit 4)', () => {
  const cwd = tmp();
  try {
    const { kp, pubPath } = withPub(cwd);
    const chain = writeChain(
      cwd,
      (r) => sign(null, Buffer.from(jcs(r)), kp.privateKey).toString('base64'),
      (sealed) => { sealed.receipt.gate_index = 999; return sealed; }, // body changed, receipt_hash stale
    );
    const r = run([chain, pubPath]);
    assert.equal(r.status, 4);
    assert.match(r.stderr, /tampered|hash/i);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('no trusted pubkey (no socket, no .pub) → exit 2 (fails closed, never silently passes)', () => {
  const cwd = tmp();
  try {
    const chain = writeChain(cwd, () => 'x');
    const r = run([chain]); // no pubkey arg, no socket
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no trusted gatekeeper public key/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
