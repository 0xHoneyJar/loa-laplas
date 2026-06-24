// poteau-gatekeeper.security.test.mjs — the teeth for the self-minted-pass fix
// (construct-rooms-substrate-chk · bug, security, severity:critical).
//
// Proves: (1) the legacy on-disk key is FORGEABLE — a work agent reads it and self-mints a
// valid poteau_gate_pass; (2) the fix — POTEAU_REQUIRE_CUSTODY=1 without a signer REFUSES
// (fail-closed, no key written); (3) with a signer socket the gate mints via the daemon and
// writes NO on-disk key (composes legba custody).
//
// Run: node --test poteau/bin/poteau-gatekeeper.security.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';

const GK = join(dirname(fileURLToPath(import.meta.url)), 'poteau-gatekeeper.mjs');
const jcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';

// Minimal packet that passes G1-G4 (no task/mandated_reads/council) and reaches the G5 mint.
const PACKET = { run_state: { run_id: 'sec-test', armed_at: '2020-01-01T00:00:00.000Z' }, packet: { verdict: 'pass', rationale: 'ok' } };
const tmp = () => mkdtempSync(join(tmpdir(), 'poteau-sec-'));
const ENV0 = { LEGBA_SIGNER_SOCKET: '', POTEAU_SIGNER_SOCKET: '', POTEAU_REQUIRE_CUSTODY: '' };
const runGate = (cwd, env = {}) =>
  spawnSync(process.execPath, [GK], { cwd, input: JSON.stringify(PACKET), encoding: 'utf8', env: { ...process.env, ...ENV0, ...env } });
// async variant — used when an IN-PROCESS mock daemon must serve the child's socket request
// (spawnSync would block the test's event loop and deadlock against the in-process server).
const runGateAsync = (cwd, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [GK], { cwd, env: { ...process.env, ...ENV0, ...env } });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
  child.stdin.end(JSON.stringify(PACKET));
});
const lastLine = (s) => JSON.parse(String(s).trim().split('\n').pop());

test('FORGEABILITY (the vuln): the legacy on-disk key lets a work agent self-mint a pass that verifies', () => {
  const cwd = tmp();
  try {
    // legacy path (no custody) writes the signing key to .run/poteau/gate.key (agent-readable).
    const r = runGate(cwd);
    assert.equal(r.status, 0, r.stderr);
    const keyPath = join(cwd, '.run/poteau/gate.key');
    assert.ok(existsSync(keyPath), 'legacy path writes the on-disk signing key');

    // THE ATTACK: a work agent (same user) reads the key and forges an arbitrary elevated receipt.
    const stolen = createPrivateKey(readFileSync(keyPath));
    const forged = { receipt_kind: 'poteau_gate_pass', run_id: 'attacker', gate_index: 999 };
    const forgedSig = sign(null, Buffer.from(jcs(forged)), stolen).toString('base64');
    const pub = createPublicKey(readFileSync(keyPath + '.pub'));
    assert.equal(verify(null, Buffer.from(jcs(forged)), pub, Buffer.from(forgedSig, 'base64')), true,
      'forged receipt verifies against the gate pubkey → the gate IS forgeable when the key is agent-readable');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('FIX: armed mint with POTEAU_REQUIRE_CUSTODY=1 and no signer REFUSES (exit 5), writes NO key', () => {
  const cwd = tmp();
  try {
    const r = runGate(cwd, { POTEAU_REQUIRE_CUSTODY: '1' });
    assert.equal(r.status, 5, 'custody fails closed with exit 5');
    const out = lastLine(r.stdout);
    assert.equal(out.pass, false);
    assert.match(out.refusal, /forgeable|custody/i);
    assert.equal(existsSync(join(cwd, '.run/poteau/gate.key')), false, 'no agent-readable key is written');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('CUSTODY: with a signer socket the gate mints via the daemon — NO on-disk key, verifies vs daemon key', async () => {
  const cwd = tmp();
  const sockPath = join(cwd, 'signer.sock');
  const daemonKp = generateKeyPairSync('ed25519'); // the daemon holds this in-memory; the agent never sees it
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => { buf += d; });
    conn.on('end', () => {
      try {
        const req = JSON.parse(buf);
        if (req.cmd === 'sign-gate') {
          const signature = sign(null, Buffer.from(jcs(req.token)), daemonKp.privateKey).toString('base64');
          conn.end(JSON.stringify({ ok: true, token: req.token, signature, token_hash: 'sha256:x' }));
        } else conn.end(JSON.stringify({ ok: false, status: 'unknown_command' }));
      } catch (e) { conn.end(JSON.stringify({ ok: false, error: e.message })); }
    });
  });
  await new Promise((res) => server.listen(sockPath, res));
  try {
    const r = await runGateAsync(cwd, { LEGBA_SIGNER_SOCKET: sockPath, POTEAU_REQUIRE_CUSTODY: '1' });
    assert.equal(r.status, 0, 'minted via custody · ' + r.stderr + r.stdout);
    assert.equal(lastLine(r.stdout).pass, true, 'minted via the daemon');
    assert.equal(existsSync(join(cwd, '.run/poteau/gate.key')), false, 'custody path writes NO agent-readable key');
    const chain = readFileSync(join(cwd, '.run/poteau', 'sec-test', 'receipts.jsonl'), 'utf8').trim();
    const sealed = JSON.parse(chain.split('\n').pop());
    assert.equal(verify(null, Buffer.from(jcs(sealed.receipt)), daemonKp.publicKey, Buffer.from(sealed.signature, 'base64')), true,
      'the receipt verifies against the DAEMON key — the key the work agent never held');
  } finally { server.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('legacy path still mints (with a forgeability WARNING) when custody is not required', () => {
  const cwd = tmp();
  try {
    const r = runGate(cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /FORGEABLE/i, 'the legacy path warns it is forgeable');
    assert.equal(lastLine(r.stdout).pass, true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
