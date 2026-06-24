// poteau-gatekeeper.honest-exit.test.mjs — the truthful-door teeth.
// xok: an honest abort must have a sanctioned exit (no faked in_scope/council, recorded as an
// abort). 2h1: the no-packet refusal must cite the path the exit-gate actually reads (run-scoped
// when armed). A gate must be exitable-when-honest as much as it must be unforgeable.
//
// Run: node --test poteau/bin/poteau-gatekeeper.honest-exit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GK = join(dirname(fileURLToPath(import.meta.url)), 'poteau-gatekeeper.mjs');
const jcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'poteau-he-'));
const run = (input, cwd, env = {}) => spawnSync(process.execPath, [GK], { cwd, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, LEGBA_SIGNER_SOCKET: '', POTEAU_SIGNER_SOCKET: '', POTEAU_REQUIRE_CUSTODY: '', ...env } });
const last = (s) => JSON.parse(String(s).trim().split('\n').pop());

const TASK = { id: 't', goal: 'do the thing' };
const ARMED = { run_state: { run_id: 'he-test', armed_at: '2020-01-01T00:00:00.000Z', task: TASK } };

test('HONEST EXIT (xok): verdict:aborted clears the gate (exit 0) without in_scope or council', () => {
  const cwd = tmp();
  try {
    const r = run({ ...ARMED, packet: { verdict: 'aborted', rationale: 'recon-only session; nothing to complete in scope' } }, cwd);
    assert.equal(r.status, 0, 'an honest abort must exit 0 (allow the stop) · ' + r.stderr);
    const out = last(r.stdout);
    assert.equal(out.aborted, true);
    assert.equal(out.pass, false); // it is an abort, NOT a completion pass
    const sealed = JSON.parse(readFileSync(join(cwd, '.run/poteau', 'he-test', 'receipts.jsonl'), 'utf8').trim().split('\n').pop());
    assert.equal(sealed.receipt.receipt_kind, 'poteau_gate_abort');
    assert.equal(sealed.receipt.outcome, 'aborted');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('the abort door does NOT weaken the gate: a real completion claim with NO in_scope still REFUSES (P202)', () => {
  const cwd = tmp();
  try {
    // correct task_ref (passes G2's conformance check) but no conformance.in_scope → P202
    const r = run({ ...ARMED, packet: { verdict: 'complete', rationale: 'done', task_ref: sha(jcs(TASK)) } }, cwd);
    assert.equal(r.status, 2, 'a completion claim without in_scope must still refuse');
    assert.equal(last(r.stdout).code, 'P202');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('2h1: the no-packet refusal cites the RUN-SCOPED path when armed', () => {
  const cwd = tmp();
  try {
    const r = run({ run_state: { run_id: 'r99' }, packet: null }, cwd);
    assert.equal(r.status, 2);
    assert.match(last(r.stdout).refusal, /\.run\/poteau\/r99\/packet\.json/, 'must cite the run-scoped path the exit-gate reads, not the flat one');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('2h1: unarmed (no run_id) still cites the flat path', () => {
  const cwd = tmp();
  try {
    const r = run({ run_state: {}, packet: null }, cwd);
    assert.equal(r.status, 2);
    assert.match(last(r.stdout).refusal, /\.run\/poteau\/packet\.json/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
