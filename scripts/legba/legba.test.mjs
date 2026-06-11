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
import {
  initKeys, loadOrInitKeys, provisionRun, record, gate, openSpan, verifyRun, challenge,
} from './legba-core.mjs';
import { REGISTRY } from './tools.mjs';

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
  const v = verifyRun(dir);
  assert.equal(v.ok, true, 'honest run must verify');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-2: tampering a recorded move is caught (chain break)', () => {
  const { dir } = freshRun();
  const p = join(dir, 'spans', 'span-0.log.jsonl');
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  lines[0].output_hash = 'deadbeef'.repeat(8);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(verifyRun(dir).ok, false, 'tampered run must NOT verify');
  rmSync(dir, { recursive: true, force: true });
});

test('LG-6: a forged gate token (no private key) is caught (signature invalid)', () => {
  const { dir } = freshRun();
  const p = join(dir, 'tokens', 'token-0.json');
  const forged = JSON.parse(readFileSync(p, 'utf8'));
  forged.signature = Buffer.from('forged').toString('base64');
  writeFileSync(p, JSON.stringify(forged));
  assert.equal(verifyRun(dir).ok, false, 'forged token must NOT verify');
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
  const r = runBridge('verify', dir);
  assert.equal(r.code, 0, 'honest compose run must verify');
  assert.equal(r.out.ok, true);
  assert.equal(r.out.binding.ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('bridge: an envelope edited after gating fails the binding check', () => {
  const dir = fakeComposeRun();
  runBridge('build', dir); // pin the chain
  const p = join(dir, 'envelopes', '01.alpha.handoff.json');
  const env = JSON.parse(readFileSync(p, 'utf8'));
  env.verdict.injected = 'tamper'; writeFileSync(p, JSON.stringify(env));
  const r = runBridge('verify', dir);
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
  assert.equal(verifyRun(dir).ok, false, 'in-place CAS edit must break verification');
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
  assert.equal(verifyRun(a).ok, true, 'earlier run still verifies after the second provision');
  rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true });
});

// ── LR-4 external anchoring ───────────────────────────────────────────────────
import { rmSync as rmr } from 'node:fs';

test('LR-4: tamper + wholesale legba/ rebuild is caught by the external anchor', () => {
  const dir = fakeComposeRun();
  runBridge('build', dir);                              // anchors content_receipt in orchestrator
  assert.equal(runBridge('verify', dir).out.anchor.state, 'anchored_match');
  // attacker: tamper an envelope AND wipe legba/ to rebuild it clean over the tamper
  const p = join(dir, 'envelopes', '01.alpha.handoff.json');
  const env = JSON.parse(readFileSync(p, 'utf8')); env.verdict.n = 999; writeFileSync(p, JSON.stringify(env));
  rmr(join(dir, 'legba'), { recursive: true, force: true });
  const r = runBridge('verify', dir);
  assert.equal(r.code, 1, 'rebuilt-over-tamper must NOT verify');
  assert.equal(r.out.binding.ok, true, 'binding passes (rebuilt chain matches tampered envelopes)');
  assert.equal(r.out.anchor.state, 'anchored_mismatch', 'the anchor is what catches it');
  rmSync(dir, { recursive: true, force: true });
});

test('LR-4: --expect an externally-held content_receipt detects any drift', () => {
  const dir = fakeComposeRun();
  const built = runBridge('build', dir);
  const receipt = built.out.content_receipt;           // operator records this out of band
  assert.equal(runBridge('verify', dir, '--expect', receipt).out.anchor.state, 'anchored_match');
  // wrong expected receipt → mismatch
  const bad = 'sha256:' + '0'.repeat(64);
  assert.equal(runBridge('verify', dir, '--expect', bad).code, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('LR-4: an unanchored run still verifies on chain+binding (honest fallback)', () => {
  const dir = fakeComposeRun();
  // build but strip the anchor line from the orchestrator (simulate no-anchor run)
  runBridge('build', dir);
  const orch = join(dir, 'orchestrator.jsonl');
  const kept = readFileSync(orch, 'utf8').split('\n').filter((l) => l && !l.includes('legba.anchor'));
  writeFileSync(orch, kept.join('\n') + '\n');
  const r = runBridge('verify', dir);
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
  const r = runBridge('verify', dir);
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
