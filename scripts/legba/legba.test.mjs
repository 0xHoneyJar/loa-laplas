/**
 * legba.test.mjs — the security guarantees as executable assertions.
 * Zero-dep: node:test + node:assert. Run: node --test scripts/legba/
 *
 * Each test names the invariant it pins. These ARE the acceptance criteria for
 * the runnable substrate: a green run means tamper is caught, forgery is caught,
 * fraud is provable, the turnstile refuses, and an honest run verifies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  initKeys, loadOrInitKeys, provisionRun, record, gate, openSpan, verifyRun, challenge, jcs,
} from './legba-core.mjs';
import { REGISTRY } from './tools.mjs';
import { startSignerDaemon } from './legba-signer-daemon-test-helper.mjs';

process.env.LEGBA_AUDIT_KEY_DIR = mkdtempSync(join(tmpdir(), 'legba-keys-'));

function freshRun() {
  const dir = mkdtempSync(join(tmpdir(), 'legba-test-'));
  const runId = 'test-run';
  const gk = initKeys('legba:test');
  provisionRun(runId, gk, dir);
  record(dir, { runId, spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '2 + 3 * 4' }, output: { result: 14 } });
  record(dir, { runId, spanIndex: 0, kind: 'emission', determinism: 'attestable', label: 'plan', content: { note: 'ok' } });
  const sealed = gate(dir, { runId, gateIndex: 0, registry: REGISTRY, artifacts: [{ a: 1 }] });
  return { dir, runId, sealed };
}

test('LG: honest run gate passes and verifies (third-party, pubkey only)', () => {
  const { dir, sealed } = freshRun();
  assert.equal(sealed.token.verdict, 'pass');
  const v = verifyRun(dir, { strict: false });
  assert.equal(v.ok, true, 'honest run must verify');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-2: tampering a recorded move is caught (chain break)', () => {
  const { dir } = freshRun();
  const p = join(dir, 'spans', 'span-0.log.jsonl');
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  lines[0].output_hash = 'deadbeef'.repeat(8);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(verifyRun(dir, { strict: false }).ok, false, 'tampered run must NOT verify');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-6: a forged gate token (no private key) is caught (signature invalid)', () => {
  const { dir } = freshRun();
  const p = join(dir, 'tokens', 'token-0.json');
  const forged = JSON.parse(readFileSync(p, 'utf8'));
  forged.signature = Buffer.from('forged').toString('base64');
  writeFileSync(p, JSON.stringify(forged));
  assert.equal(verifyRun(dir, { strict: false }).ok, false, 'forged token must NOT verify');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-8: tampering the unsigned token_hash is caught — verifyRun recomputes, never trusts', () => {
  // The ed25519 signature covers jcs(token), NOT sealed.token_hash. The custody
  // chain + run receipt anchor on token_hash, so a run-dir writer who rewrites it
  // (to splice the chain or forge the receipt) must be caught. verifyRun must
  // recompute hashObj(token) and refuse a stored token_hash that does not match.
  const { dir } = freshRun();
  const p = join(dir, 'tokens', 'token-0.json');
  const sealed = JSON.parse(readFileSync(p, 'utf8'));
  sealed.token_hash = 'deadbeef'.repeat(8); // valid signature, lying hash
  writeFileSync(p, JSON.stringify(sealed));
  assert.equal(verifyRun(dir, { strict: false }).ok, false, 'a token_hash that does not match the signed token must NOT verify');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-9: a token bound to a different run_id is rejected (no cross-run replay)', () => {
  // codex CRITICAL #2: verifyRun must bind each token to THIS run, else another
  // run's signed tokens (same gatekeeper key) can be replayed in.
  const { dir } = freshRun();
  const mp = join(dir, 'manifest.json');
  const man = JSON.parse(readFileSync(mp, 'utf8'));
  man.run_id = 'a-different-run'; // signed token still carries the original run_id
  writeFileSync(mp, JSON.stringify(man));
  const r = verifyRun(dir, { strict: false });
  assert.equal(r.ok, false, 'token.run_id must match the manifest run_id');
  assert.ok(r.gates.some((g) => g.run_id_matches === false), 'the run_id binding is what caught it');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-10: a gap in the gate sequence (skip / first-token delete) is rejected', () => {
  // codex #3: gates must be a contiguous sequence from 0 — no skips/reorders.
  const dir = mkdtempSync(join(tmpdir(), 'legba-test-'));
  const runId = 'contig-run';
  const gk = initKeys('legba:test');
  provisionRun(runId, gk, dir);
  record(dir, { runId, spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '1 + 1' }, output: { result: 2 } });
  gate(dir, { runId, gateIndex: 0, registry: REGISTRY });
  openSpan(dir, { runId, spanIndex: 1 });
  record(dir, { runId, spanIndex: 1, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '2 + 2' }, output: { result: 4 } });
  gate(dir, { runId, gateIndex: 1, registry: REGISTRY });
  assert.equal(verifyRun(dir, { strict: false }).ok, true, 'honest 2-gate run verifies');
  rmSync(join(dir, 'tokens', 'token-0.json')); // gap: token-1 (gate_index 1) is now first
  const r = verifyRun(dir, { strict: false });
  assert.equal(r.ok, false, 'a non-contiguous gate sequence must NOT verify');
  assert.ok(r.gates.some((g) => g.gate_index_contiguous === false), 'the contiguity gap is what caught it');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-4: a confabulated re_executable output is fraud-proven by re-execution', () => {
  const { dir, runId } = freshRun();
  record(dir, { runId, spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '2 + 2' }, output: { result: 5 } });
  const log = readFileSync(join(dir, 'spans', 'span-0.log.jsonl'), 'utf8').split('\n').filter(Boolean);
  const r = challenge(dir, 0, log.length - 1, REGISTRY);
  assert.equal(r.challengeable, true);
  assert.equal(r.ok, false, 'confabulated output must be proven fraudulent');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-4 (honest): a truthful re_executable move survives challenge', () => {
  const { dir } = freshRun();
  const r = challenge(dir, 0, 0, REGISTRY);
  assert.equal(r.ok, true, 'honest move must survive');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-7: an attestable emission cannot be challenged by re-execution (detector-tier)', () => {
  const { dir } = freshRun();
  const r = challenge(dir, 0, 1, REGISTRY); // seq 1 is the emission
  assert.equal(r.challengeable, false, 'attestable moves are not replayable');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-3: the turnstile refuses span 1 without the gate-0 token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legba-test-'));
  const gk = initKeys('legba:test');
  provisionRun('ts-run', gk, dir);
  // no gate run → no token-0 → opening span 1 must throw
  assert.throws(() => openSpan(dir, { runId: 'ts-run', spanIndex: 1 }), /LEGBA_REFUSED/);
  rmSync(dir, { recursive: true, force: true });
});

test('LG-3 (terminal fail-token): a fail verdict does not open the next span', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legba-test-'));
  const runId = 'fail-run';
  const gk = initKeys('legba:test');
  provisionRun(runId, gk, dir);
  // record a confabulated re_executable move → gate replay fails → fail token
  record(dir, { runId, spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '1 + 1' }, output: { result: 99 } });
  const sealed = gate(dir, { runId, gateIndex: 0, registry: REGISTRY });
  assert.equal(sealed.token.verdict, 'fail');
  assert.throws(() => openSpan(dir, { runId, spanIndex: 1 }), /not pass/);
  rmSync(dir, { recursive: true, force: true });
});

// ── compose-bridge: the inter-envelope chain over a Form C run ───────────────
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync as wf } from 'node:fs';

function fakeComposeRun() {
  const dir = mkdtempSync(join(tmpdir(), 'legba-compose-'));
  writeFileSync(join(dir, 'form-c-manifest.json'), JSON.stringify({ composition_run_id: 'bridge-test', segments: [{ stage: 1 }, { stage: 2 }] }));
  wf(join(dir, 'orchestrator.jsonl'), JSON.stringify({ event: 'form_c.manifest', run_id: 'bridge-test' }) + '\n'); // anchor lands here
  mkdirSync(join(dir, 'envelopes'), { recursive: true });
  wf(join(dir, 'envelopes', '01.alpha.handoff.json'), JSON.stringify({ composition_run_id: 'bridge-test', stage_index: 1, construct_slug: 'alpha', verdict: { outcome: 'converged', n: 1 } }));
  wf(join(dir, 'envelopes', '02.beta.handoff.json'), JSON.stringify({ composition_run_id: 'bridge-test', stage_index: 2, construct_slug: 'beta', verdict: { outcome: 'converged', n: 2 } }));
  return dir;
}
const BRIDGE = new URL('./compose-bridge.mjs', import.meta.url).pathname;
const runBridge = (cmd, dir, ...extra) => {
  try { return { code: 0, out: JSON.parse(execFileSync('node', [BRIDGE, cmd, dir, ...extra], { encoding: 'utf8' })) }; }
  catch (e) { return { code: e.status ?? 1, out: e.stdout ? JSON.parse(e.stdout) : null }; }
};

test('bridge: derives a verifying custody chain over executed envelopes', () => {
  const dir = fakeComposeRun();
  const r = runBridge('verify', dir, '--repair', '--bootstrap');
  assert.equal(r.code, 0, 'honest compose run must verify');
  assert.equal(r.out.ok, true);
  assert.equal(r.out.binding.ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('ATK-2: strict compose verify fails instead of auto-building when legba manifest is absent', () => {
  const dir = fakeComposeRun();
  const r = runBridge('verify', dir);
  assert.equal(r.code, 1, 'strict verify must not auto-build a missing legba manifest');
  assert.equal(existsSync(join(dir, 'legba', 'manifest.json')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('bridge: an envelope edited after gating fails the binding check', () => {
  const dir = fakeComposeRun();
  runBridge('build', dir); // pin the chain
  const p = join(dir, 'envelopes', '01.alpha.handoff.json');
  const env = JSON.parse(readFileSync(p, 'utf8'));
  env.verdict.injected = 'tamper'; writeFileSync(p, JSON.stringify(env));
  const r = runBridge('verify', dir, '--bootstrap');
  assert.equal(r.code, 1, 'tampered run must NOT verify');
  assert.equal(r.out.binding.ok, false);
  assert.equal(r.out.binding.mismatches.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

// ── Codex review hardening ───────────────────────────────────────────────────
import { readdirSync } from 'node:fs';

test('P1: a CAS blob edited in place (same filename) is rejected — content-addressing enforced', () => {
  const { dir } = freshRun();
  // find the arith input blob and rewrite its content while keeping the filename
  const casDir = join(dir, 'cas');
  const before = readdirSync(casDir);
  // tamper EVERY cas blob's content; verify must now fail (cas_complete / artifacts)
  for (const f of before) writeFileSync(join(casDir, f), JSON.stringify({ tampered: true }));
  assert.equal(verifyRun(dir, { strict: false }).ok, false, 'in-place CAS edit must break verification');
  // and a challenge against a tampered input must not silently pass
  const r = challenge(dir, 0, 0, REGISTRY);
  assert.equal(r.ok, false, 'challenge must not replay against a tampered input blob');
  rmSync(dir, { recursive: true, force: true });
});

test('P2: provisioning a second run with the same gatekeeper reuses the key (earlier run still verifies)', () => {
  const a = mkdtempSync(join(tmpdir(), 'legba-keyA-'));
  const b = mkdtempSync(join(tmpdir(), 'legba-keyB-'));
  const gkId = 'legba:shared-' + Math.floor(process.hrtime()[1]); // unique per run
  const k1 = loadOrInitKeys(gkId);
  provisionRun('run-a', k1, a);
  record(a, { runId: 'run-a', spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '1 + 1' }, output: { result: 2 } });
  gate(a, { runId: 'run-a', gateIndex: 0, registry: REGISTRY });
  // second provision, SAME gatekeeper — must reuse, not overwrite
  const k2 = loadOrInitKeys(gkId);
  provisionRun('run-b', k2, b);
  assert.equal(k1.publicKeyPem, k2.publicKeyPem, 'same gatekeeper must reuse the keypair');
  assert.equal(verifyRun(a, { strict: false }).ok, true, 'earlier run still verifies after the second provision');
  rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true });
});

function pemBlock(pem, indent) {
  const pad = ' '.repeat(indent);
  return pem.trim().split('\n').map((l) => pad + l).join('\n');
}

function writeRootedTrustStore(path, rootPriv, rootPubPem, keys) {
  const core = {
    schema_version: '1.0',
    keys,
    revocations: [],
    trust_cutoff: { default_strict_after: '2026-05-03T00:00:00Z' },
  };
  const rootSig = sign(null, Buffer.from(jcs(core)), rootPriv).toString('base64');
  const keysYaml = keys.length ? '\n' + keys.map((k) => (
    `  - key_id: "${k.key_id}"\n`
    + `    gatekeeper_id: "${k.gatekeeper_id}"\n`
    + `    pubkey_pem: |\n${pemBlock(k.pubkey_pem, 6)}`
  )).join('\n') : '[]';
  writeFileSync(path, `---\nschema_version: "1.0"\nroot_signature:\n  algorithm: ed25519\n  signer_pubkey: |\n${pemBlock(rootPubPem, 4)}\n  signed_at: "2026-05-03T00:00:00Z"\n  signature: "${rootSig}"\nkeys: ${keysYaml}\nrevocations: []\ntrust_cutoff:\n  default_strict_after: "2026-05-03T00:00:00Z"\n`);
}

const SIGNER = new URL('./legba-signer.mjs', import.meta.url).pathname;

function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) prev[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function safeKeyName(gatekeeperId) {
  return gatekeeperId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function rootedFixture(dir, man) {
  const root = generateKeyPairSync('ed25519');
  const rootPubPem = root.publicKey.export({ type: 'spki', format: 'pem' });
  const trustStore = join(dir, 'trust-store.yaml');
  const pinnedRoot = join(dir, 'root.pub');
  writeFileSync(pinnedRoot, rootPubPem);
  writeRootedTrustStore(trustStore, root.privateKey, rootPubPem, [{
    key_id: man.gatekeeper_key_id,
    gatekeeper_id: man.gatekeeper_id,
    pubkey_pem: man.gatekeeper_pubkey_pem,
  }]);
  return { trustStore, pinnedRoot };
}

test('daemon custody: in-memory signer gates legitimate evidence and refuses evidence-free work', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'legba-daemon-legit-'));
  const empty = mkdtempSync(join(tmpdir(), 'legba-daemon-empty-'));
  const daemonDir = mkdtempSync(join(tmpdir(), 'legba-daemon-'));
  const auditKeys = mkdtempSync(join(tmpdir(), 'legba-daemon-audited-keys-'));
  const signerKeys = mkdtempSync(join(tmpdir(), 'legba-daemon-signer-keys-'));
  const socketPath = join(daemonDir, 'signer.sock');
  let daemon;
  try {
    daemon = await startSignerDaemon(socketPath, { LEGBA_SIGNER_KEY_DIR: signerKeys, LEGBA_AUDIT_KEY_DIR: auditKeys });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
    rmSync(daemonDir, { recursive: true, force: true });
    rmSync(auditKeys, { recursive: true, force: true });
    rmSync(signerKeys, { recursive: true, force: true });
    if (/\bEPERM\b/.test(e.message)) {
      t.skip('Unix-domain sockets are unavailable in this sandbox');
      return;
    }
    throw e;
  }
  try {
    withEnv({
      LEGBA_SIGNER: undefined,
      LEGBA_SIGNER_SOCKET: socketPath,
      LEGBA_SIGNER_KEY_DIR: signerKeys,
      LEGBA_AUDIT_KEY_DIR: auditKeys,
    }, () => {
      const gkId = 'legba:daemon:legit';
      const gk = initKeys(gkId);
      assert.equal(gk._privateKeyPem, undefined, 'daemon init must expose only public key material');
      assert.equal(existsSync(join(auditKeys, `${safeKeyName(gkId)}.priv`)), false, 'audited key dir must not receive a private key');
      assert.equal(existsSync(join(signerKeys, `${safeKeyName(gkId)}.priv`)), false, 'daemon mode must not persist a signer private key');

      const man = provisionRun('daemon-legit', gk, dir);
      record(dir, { runId: 'daemon-legit', spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '8 * 7' }, output: { result: 56 } });
      const sealed = gate(dir, { runId: 'daemon-legit', gateIndex: 0, registry: REGISTRY, artifacts: [{ result: 56 }] });
      assert.equal(sealed.token.verdict, 'pass');

      const roots = rootedFixture(dir, man);
      const v = verifyRun(dir, { strict: true, trustStorePath: roots.trustStore, pinnedRootPubkeyPath: roots.pinnedRoot });
      assert.equal(v.ok, true, 'daemon-gated legitimate run must verify strict + rooted');
      assert.equal(v.trust_store.status, 'rooted');

      const badGk = initKeys('legba:daemon:evidence-free');
      provisionRun('daemon-empty', badGk, empty);
      record(empty, { runId: 'daemon-empty', spanIndex: 0, kind: 'emission', determinism: 'attestable', label: 'claim', content: { fabricated: true } });
      assert.throws(
        () => gate(empty, { runId: 'daemon-empty', gateIndex: 0, registry: REGISTRY }),
        /no_verifiable_evidence/,
        'daemon must refuse evidence-free work',
      );
      assert.equal(existsSync(join(empty, 'tokens', 'token-0.json')), false, 'daemon refusal must not emit a token');
      assert.equal(existsSync(join(signerKeys, `${safeKeyName('legba:daemon:evidence-free')}.priv`)), false, 'daemon must not persist evidence-free signer private key either');
    });
  } finally {
    await daemon.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
    rmSync(daemonDir, { recursive: true, force: true });
    rmSync(auditKeys, { recursive: true, force: true });
    rmSync(signerKeys, { recursive: true, force: true });
  }
});

test('custody forge_cannot_self_sign: gate has no local-key fallback in custody mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legba-custody-self-'));
  const auditKeys = mkdtempSync(join(tmpdir(), 'legba-audited-keys-'));
  const signerKeys = mkdtempSync(join(tmpdir(), 'legba-signer-keys-'));
  const gkId = 'legba:custody:self';
  withEnv({ LEGBA_SIGNER: SIGNER, LEGBA_SIGNER_KEY_DIR: signerKeys, LEGBA_AUDIT_KEY_DIR: auditKeys }, () => {
    const gk = initKeys(gkId);
    assert.equal(gk._privateKeyPem, undefined, 'custody init must expose only the signer public key');
    assert.equal(existsSync(join(auditKeys, `${safeKeyName(gkId)}.priv`)), false, 'audited key dir must not receive the signer private key');
    provisionRun('custody-self', gk, dir);
    record(dir, { runId: 'custody-self', spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '1 + 1' }, output: { result: 2 } });
  });
  const refusingSigner = join(dir, 'refusing-signer.mjs');
  writeFileSync(refusingSigner, 'process.stdout.write(JSON.stringify({ ok: false, status: "unreachable", error: "signer unavailable" })); process.exit(1);\n');
  withEnv({ LEGBA_SIGNER: refusingSigner, LEGBA_SIGNER_KEY_DIR: signerKeys, LEGBA_AUDIT_KEY_DIR: auditKeys }, () => {
    assert.throws(
      () => gate(dir, { runId: 'custody-self', gateIndex: 0, registry: REGISTRY }),
      /LEGBA_SIGNER_REFUSED/,
      'custody mode must fail closed when the signer is unreachable, not sign locally',
    );
  });
  assert.equal(existsSync(join(dir, 'tokens', 'token-0.json')), false, 'unreachable signer must not leave a token');
  rmSync(dir, { recursive: true, force: true });
  rmSync(auditKeys, { recursive: true, force: true });
  rmSync(signerKeys, { recursive: true, force: true });
});

test('custody forge_signer_refuses_evidence_free: attestable-only work receives no gate signature', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legba-custody-empty-'));
  const auditKeys = mkdtempSync(join(tmpdir(), 'legba-audited-keys-'));
  const signerKeys = mkdtempSync(join(tmpdir(), 'legba-signer-keys-'));
  withEnv({ LEGBA_SIGNER: SIGNER, LEGBA_SIGNER_KEY_DIR: signerKeys, LEGBA_AUDIT_KEY_DIR: auditKeys }, () => {
    const gk = initKeys('legba:custody:evidence-free');
    const man = provisionRun('custody-empty', gk, dir);
    record(dir, { runId: 'custody-empty', spanIndex: 0, kind: 'emission', determinism: 'attestable', label: 'claim', content: { fabricated: true } });
    assert.throws(
      () => gate(dir, { runId: 'custody-empty', gateIndex: 0, registry: REGISTRY }),
      /no_verifiable_evidence/,
      'signer must refuse a run with no independently replayable evidence',
    );
    assert.equal(existsSync(join(dir, 'tokens', 'token-0.json')), false, 'refusal must not emit a token');
    const roots = rootedFixture(dir, man);
    const v = verifyRun(dir, { strict: true, trustStorePath: roots.trustStore, pinnedRootPubkeyPath: roots.pinnedRoot });
    assert.equal(v.ok, false, 'evidence-free refused run must not become a valid_run');
    assert.equal(v.gate_count, 0);
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(auditKeys, { recursive: true, force: true });
  rmSync(signerKeys, { recursive: true, force: true });
});

test('custody legit_run_passes: replayable evidence is signed by signer and strict verify roots it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legba-custody-legit-'));
  const auditKeys = mkdtempSync(join(tmpdir(), 'legba-audited-keys-'));
  const signerKeys = mkdtempSync(join(tmpdir(), 'legba-signer-keys-'));
  withEnv({ LEGBA_SIGNER: SIGNER, LEGBA_SIGNER_KEY_DIR: signerKeys, LEGBA_AUDIT_KEY_DIR: auditKeys }, () => {
    const gk = initKeys('legba:custody:legit');
    const man = provisionRun('custody-legit', gk, dir);
    record(dir, { runId: 'custody-legit', spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '(4 + 5) * 3' }, output: { result: 27 } });
    const sealed = gate(dir, { runId: 'custody-legit', gateIndex: 0, registry: REGISTRY, artifacts: [{ result: 27 }] });
    assert.equal(sealed.token.verdict, 'pass');
    const roots = rootedFixture(dir, man);
    const v = verifyRun(dir, { strict: true, trustStorePath: roots.trustStore, pinnedRootPubkeyPath: roots.pinnedRoot });
    assert.equal(v.ok, true, 'legitimate custody run must verify strictly against rooted signer public key');
    assert.equal(v.trust_store.status, 'rooted');
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(auditKeys, { recursive: true, force: true });
  rmSync(signerKeys, { recursive: true, force: true });
});

test('ATK-1: strict verify rejects a self-minted manifest key absent from the rooted trust-store', () => {
  const { dir } = freshRun();
  const root = generateKeyPairSync('ed25519');
  const rootPubPem = root.publicKey.export({ type: 'spki', format: 'pem' });
  const trustStore = join(dir, 'trust-store.yaml');
  const pinnedRoot = join(dir, 'root.pub');
  writeFileSync(pinnedRoot, rootPubPem);
  writeRootedTrustStore(trustStore, root.privateKey, rootPubPem, []);

  const v = verifyRun(dir, { strict: true, trustStorePath: trustStore, pinnedRootPubkeyPath: pinnedRoot });
  assert.equal(v.ok, false, 'self-minted, unrooted manifest key must fail strict verification');
  assert.equal(v.trust_store.status, 'key_not_rooted');
  rmSync(dir, { recursive: true, force: true });
});

test('ATK-1 regression: a rooted key verifies in strict mode; bootstrap mode still verifies install-time runs', () => {
  const { dir } = freshRun();
  const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const root = generateKeyPairSync('ed25519');
  const rootPubPem = root.publicKey.export({ type: 'spki', format: 'pem' });
  const trustStore = join(dir, 'trust-store.yaml');
  const pinnedRoot = join(dir, 'root.pub');
  writeFileSync(pinnedRoot, rootPubPem);
  writeRootedTrustStore(trustStore, root.privateKey, rootPubPem, [{
    key_id: man.gatekeeper_key_id,
    gatekeeper_id: man.gatekeeper_id,
    pubkey_pem: man.gatekeeper_pubkey_pem,
  }]);

  const strict = verifyRun(dir, { strict: true, trustStorePath: trustStore, pinnedRootPubkeyPath: pinnedRoot });
  assert.equal(strict.ok, true, 'rooted gatekeeper key must verify in strict mode');
  assert.equal(strict.trust_store.status, 'rooted');

  const bootstrap = join(dir, 'bootstrap-trust-store.yaml');
  writeFileSync(bootstrap, '---\nschema_version: "1.0"\nroot_signature:\n  algorithm: ed25519\n  signer_pubkey: ""\n  signed_at: ""\n  signature: ""\nkeys: []\nrevocations: []\ntrust_cutoff:\n  default_strict_after: "2099-01-01T00:00:00Z"\n');
  const nonStrict = verifyRun(dir, { strict: false, trustStorePath: bootstrap, pinnedRootPubkeyPath: pinnedRoot });
  assert.equal(nonStrict.ok, true, 'explicit bootstrap mode must still support install-time runs');
  assert.equal(nonStrict.trust_store.status, 'bootstrap_pending');
  rmSync(dir, { recursive: true, force: true });
});

test('ATK-1: manifest gatekeeper_pubkey_pem is redundant metadata and must match the rooted key', () => {
  const { dir } = freshRun();
  const manifestPath = join(dir, 'manifest.json');
  const man = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const root = generateKeyPairSync('ed25519');
  const rootPubPem = root.publicKey.export({ type: 'spki', format: 'pem' });
  const trustStore = join(dir, 'trust-store.yaml');
  const pinnedRoot = join(dir, 'root.pub');
  writeFileSync(pinnedRoot, rootPubPem);
  writeRootedTrustStore(trustStore, root.privateKey, rootPubPem, [{
    key_id: man.gatekeeper_key_id,
    gatekeeper_id: man.gatekeeper_id,
    pubkey_pem: man.gatekeeper_pubkey_pem,
  }]);

  const imposter = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  man.gatekeeper_pubkey_pem = imposter;
  writeFileSync(manifestPath, JSON.stringify(man, null, 2));
  const v = verifyRun(dir, { strict: true, trustStorePath: trustStore, pinnedRootPubkeyPath: pinnedRoot });
  assert.equal(v.ok, false, 'manifest pubkey divergence must fail strict verification');
  assert.equal(v.trust_store.status, 'manifest_divergence');
  rmSync(dir, { recursive: true, force: true });
});

test('BB#59 F-002: env-supplied trust anchors are refused in strict mode', () => {
  const { dir } = freshRun();
  const prev = process.env.LOA_PINNED_ROOT_PUBKEY_PATH;
  process.env.LOA_PINNED_ROOT_PUBKEY_PATH = join(dir, 'evil.pub');
  const v = verifyRun(dir, { strict: true });
  if (prev === undefined) delete process.env.LOA_PINNED_ROOT_PUBKEY_PATH; else process.env.LOA_PINNED_ROOT_PUBKEY_PATH = prev;
  assert.equal(v.ok, false, 'env-supplied anchor must fail strict verification');
  assert.equal(v.trust_store.status, 'env_override_in_strict');
  rmSync(dir, { recursive: true, force: true });
});

test('BB#59 F-001: an in-repo trust anchor is refused in strict mode (out-of-band required)', () => {
  const { dir } = freshRun();
  const inRepo = new URL('./legba-core.mjs', import.meta.url).pathname; // a path inside the repo tree
  const v = verifyRun(dir, { strict: true, pinnedRootPubkeyPath: inRepo });
  assert.equal(v.ok, false, 'in-repo anchor must fail strict verification');
  assert.equal(v.trust_store.status, 'anchor_in_repo');
  rmSync(dir, { recursive: true, force: true });
});

// ── LR-4 external anchoring ───────────────────────────────────────────────────
import { rmSync as rmr } from 'node:fs';

test('LR-4: tamper + wholesale legba/ rebuild is caught by the external anchor', () => {
  const dir = fakeComposeRun();
  runBridge('build', dir);                              // anchors content_receipt in orchestrator
  assert.equal(runBridge('verify', dir, '--bootstrap').out.anchor.state, 'anchored_match');
  // attacker: tamper an envelope AND wipe legba/ to rebuild it clean over the tamper
  const p = join(dir, 'envelopes', '01.alpha.handoff.json');
  const env = JSON.parse(readFileSync(p, 'utf8')); env.verdict.n = 999; writeFileSync(p, JSON.stringify(env));
  rmr(join(dir, 'legba'), { recursive: true, force: true });
  const r = runBridge('verify', dir, '--repair', '--bootstrap');
  assert.equal(r.code, 1, 'rebuilt-over-tamper must NOT verify');
  assert.equal(r.out.binding.ok, true, 'binding passes (rebuilt chain matches tampered envelopes)');
  assert.equal(r.out.anchor.state, 'anchored_mismatch', 'the anchor is what catches it');
  rmSync(dir, { recursive: true, force: true });
});

test('LR-4: --expect an externally-held content_receipt detects any drift', () => {
  const dir = fakeComposeRun();
  const built = runBridge('build', dir);
  const receipt = built.out.content_receipt;           // operator records this out of band
  assert.equal(runBridge('verify', dir, '--expect', receipt, '--bootstrap').out.anchor.state, 'anchored_match');
  // wrong expected receipt → mismatch
  const bad = 'sha256:' + '0'.repeat(64);
  assert.equal(runBridge('verify', dir, '--expect', bad, '--bootstrap').code, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('LR-4: an unanchored run still verifies on chain+binding (honest fallback)', () => {
  const dir = fakeComposeRun();
  // build but strip the anchor line from the orchestrator (simulate no-anchor run)
  runBridge('build', dir);
  const orch = join(dir, 'orchestrator.jsonl');
  const kept = readFileSync(orch, 'utf8').split('\n').filter((l) => l && !l.includes('legba.anchor'));
  writeFileSync(orch, kept.join('\n') + '\n');
  const r = runBridge('verify', dir, '--bootstrap');
  assert.equal(r.out.anchor.state, 'unanchored');
  assert.equal(r.out.ok, true, 'unanchored honest run still verifies on chain+binding');
  rmSync(dir, { recursive: true, force: true });
});

test('LR-4 P2: tampering a NON-verdict field (construct_slug) is caught', () => {
  const dir = fakeComposeRun();
  runBridge('build', dir);
  const p = join(dir, 'envelopes', '01.alpha.handoff.json');
  const env = JSON.parse(readFileSync(p, 'utf8'));
  env.construct_slug = 'IMPERSONATOR'; // a non-verdict field
  writeFileSync(p, JSON.stringify(env));
  const r = runBridge('verify', dir, '--bootstrap');
  assert.equal(r.code, 1, 'non-verdict tampering must NOT verify');
  assert.ok(r.out.binding.ok === false || r.out.anchor.state === 'anchored_mismatch', 'caught by binding or anchor');
  rmSync(dir, { recursive: true, force: true });
});

test('LR-4 P1: a run_id containing a shell metachar does not execute shell (no injection)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legba-inj-'));
  // manifest run_id with a single quote + command substitution attempt
  const evilId = "x'; touch " + join(dir, 'PWNED') + "; echo '";
  writeFileSync(join(dir, 'form-c-manifest.json'), JSON.stringify({ composition_run_id: evilId }));
  wf(join(dir, 'orchestrator.jsonl'), JSON.stringify({ event: 'form_c.manifest', run_id: evilId }) + '\n');
  mkdirSync(join(dir, 'envelopes'), { recursive: true });
  wf(join(dir, 'envelopes', '01.x.handoff.json'), JSON.stringify({ composition_run_id: evilId, stage_index: 1, verdict: { ok: true } }));
  // force the audit-chain path on (the injection surface), pointing at a real source-able stub
  const stub = join(dir, 'audit-stub.sh');
  wf(stub, 'audit_emit() { :; }\n');
  runBridge('build', dir, '--expect', 'sha256:' + '0'.repeat(64)); // run it (env carries LOA_AUDIT_ENVELOPE_SH via process)
  execFileSync('node', [BRIDGE, 'build', dir], { encoding: 'utf8', env: { ...process.env, LOA_AUDIT_ENVELOPE_SH: stub } });
  assert.equal(existsSync(join(dir, 'PWNED')), false, 'no shell injection — PWNED file must NOT exist');
  rmSync(dir, { recursive: true, force: true });
});
