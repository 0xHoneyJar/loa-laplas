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
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initKeys, provisionRun, record, gate, openSpan, verifyRun, challenge,
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
