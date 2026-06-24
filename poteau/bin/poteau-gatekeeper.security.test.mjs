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

// HONEST SCOPE (bead construct-rooms-substrate-kdm, found by the trust-lens audit 2026-06-24):
// this proves only the gatekeeper's CLIENT-SIDE custody PROTOCOL — it sends the receipt to the
// socket, mints from the response, and writes NO on-disk key. The in-process server below is a
// STAND-IN that signs req.token. The REAL legba-signer-daemon does NOT honor that contract: its
// sign-gate IGNORES req.token and runs buildGateToken(req.dir, …) (independent run-dir replay),
// so against the shipped daemon poteau's payload throws and custody mint FAILS CLOSED. So this
// test does NOT prove end-to-end custody works — the next test (real daemon) documents the gap.
test('CUSTODY (client protocol, STAND-IN signer): the gate mints from a socket response — NO on-disk key', async () => {
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

// THE HONEST RECORD (bead construct-rooms-substrate-kdm): the custody mint against the SHIPPED
// daemon currently fails CLOSED — the trust-lens audit's reproduced finding, captured as a test
// so the suite stops claiming custody works. SAFE because fail-closed leaks nothing (no forged
// receipt); the gap is that the secure posture (REQUIRE_CUSTODY=1) is non-functional, so the
// daemon needs a real sign-token primitive and poteau must route to it. Flip this assertion the
// moment kdm lands.
test('CUSTODY (REAL daemon, KNOWN GAP kdm): poteau payload mismatches the daemon sign-gate contract → fails CLOSED, WITNESSING the cause', async () => {
  const cwd = tmp();
  const sockPath = join(cwd, 'real-signer.sock');
  const DAEMON = new URL('../../scripts/legba/legba-signer-daemon.mjs', import.meta.url).pathname;
  const RELAY = new URL('../../scripts/legba/legba-signer-relay.mjs', import.meta.url).pathname;
  const daemon = spawn(process.execPath, [DAEMON], { env: { ...process.env, LEGBA_SIGNER_SOCKET: sockPath }, stdio: 'ignore' });
  const relay = (cmd, req) => spawnSync(process.execPath, [RELAY, cmd], { input: JSON.stringify(req), env: { ...process.env, LEGBA_SIGNER_SOCKET: sockPath }, encoding: 'utf8' });
  try {
    for (let i = 0; i < 60 && !existsSync(sockPath); i++) await new Promise((r) => setTimeout(r, 50));
    // (1) WITNESS the daemon is UP + functional — init-keys returns a real pubkey. This is what
    //     makes the exit 5 below mean "the contract was rejected", NOT "the daemon never started"
    //     (BB #71 HIGH: exit 5 is custodyRefuse for ANY fault; pin down which fault).
    const init = JSON.parse((relay('init-keys', { gatekeeperId: 'poteau-gate' }).stdout || '{}').trim() || '{}');
    assert.ok(init.publicKeyPem, 'precondition: the REAL daemon is up + keyed (so exit 5 cannot mean daemon-never-started)');
    // (2) WITNESS the CAUSE directly — the daemon's sign-gate REJECTS poteau's {token} payload
    //     with the contract-mismatch error (it ignores token, runs buildGateToken(req.dir,…) → undefined).
    const probe = JSON.parse((relay('sign-gate', { token: { receipt_kind: 'poteau_gate_pass', run_id: 'sec-test', gate_index: 0 }, gatekeeperId: 'poteau-gate' }).stdout || '{}').trim() || '{}');
    assert.equal(probe.ok, false, 'the real daemon REJECTS poteau\'s sign-gate payload');
    assert.match(JSON.stringify(probe), /path|undefined|dir/i, 'the rejection is the req.dir contract mismatch, not a transient error');
    // (3) the gatekeeper therefore fails CLOSED — exit 5, no receipt, refusal names the signer failure.
    const r = await runGateAsync(cwd, { LEGBA_SIGNER_SOCKET: sockPath, POTEAU_REQUIRE_CUSTODY: '1' });
    assert.equal(r.status, 5, 'custody mint fails closed (kdm) · ' + r.stdout + r.stderr);
    assert.match(lastLine(r.stdout).refusal || '', /signer|custody|mint/i, 'the refusal names the signer-mediated failure, not a generic fault');
    assert.equal(existsSync(join(cwd, '.run/poteau', 'sec-test', 'receipts.jsonl')), false, 'no forged receipt minted');
  } finally { daemon.kill(); rmSync(cwd, { recursive: true, force: true }); }
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
