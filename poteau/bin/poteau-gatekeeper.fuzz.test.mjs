// poteau-gatekeeper.fuzz.test.mjs — adversarial property-based proof of GATE HONESTY.
//
// Hand-written tests check the cases I thought of. This generates hundreds of random
// (run_state, packet) pairs from a SEEDED prng (reproducible) and asserts the three invariants
// from grimoires/loa/doctrine/gate-honesty.md hold across the whole input space — i.e. the gate
// cannot be made to lie no matter what an adversary throws at it:
//
//   P1 EXITABLE      — an honest abort (verdict:'aborted' + rationale) ALWAYS opens the door
//                      (exit 0), for any armed run_state.
//   P2 NO-FALSE-PASS — a completion claim against the WRONG task NEVER passes (exit != 0).
//   P3 UNFORGEABLE   — a mandated council with FABRICATED receipts (no valid signatures) NEVER
//                      passes (exit != 0), however well-formed the rest of the packet is.
//
// A counter-example here is a real gate-dishonesty bug. Run: node --test ...fuzz.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GK = join(dirname(fileURLToPath(import.meta.url)), 'poteau-gatekeeper.mjs');
const jcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');

// seeded prng (mulberry32) — deterministic so a failure is reproducible (no Math.random).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const cwd = mkdtempSync(join(tmpdir(), 'poteau-fuzz-'));
const run = (input) => spawnSync(process.execPath, [GK], { cwd, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, LEGBA_SIGNER_SOCKET: '', POTEAU_SIGNER_SOCKET: '', POTEAU_REQUIRE_CUSTODY: '' } });
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const rstr = (r, n = 8) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(r() * 26))).join('');

// a random ARMED run_state (always has a run_id — an honest abort lives inside an armed run).
function randomRunState(r, i, { council = false } = {}) {
  const rs = { run_id: `fuzz-${i}-${rstr(r, 6)}`, armed_at: '2020-01-01T00:00:00.000Z', gate_index: Math.floor(r() * 3) };
  if (r() < 0.6) rs.task = { id: rstr(r, 4), goal: rstr(r, 12) };
  if (r() < 0.4) rs.mandated_reads = [{ path: rstr(r, 6), h1: rstr(r, 10) }];
  if (council) rs.review_routing = { council: true, min_voices: 1 + Math.floor(r() * 2), reviewer_keys: [generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })] };
  else if (r() < 0.3) rs.review_routing = { council: false };
  return rs;
}

test('P1 EXITABLE — an honest abort always opens the door (exit 0) for ANY armed run_state [120 cases]', () => {
  const r = rng(0xA11CE);
  for (let i = 0; i < 120; i++) {
    const rs = randomRunState(r, i, { council: r() < 0.4 });
    const out = run({ run_state: rs, packet: { verdict: 'aborted', rationale: 'withdrawing: ' + rstr(r, 20) } });
    assert.equal(out.status, 0, `EXITABLE violated — an honest abort deadlocked (exit ${out.status}) on run_state ${JSON.stringify(rs)} :: ${out.stdout}${out.stderr}`);
  }
});

test('P2 NO-FALSE-PASS — a completion claim against the WRONG task never passes [120 cases]', () => {
  const r = rng(0xB0B);
  for (let i = 0; i < 120; i++) {
    const task = { id: rstr(r, 4), goal: rstr(r, 12) };
    const rs = { run_id: `fuzz2-${i}`, armed_at: '2020-01-01T00:00:00.000Z', task };
    // a wrong task_ref (random, or omitted) — must NEVER pass, even with in_scope asserted.
    const wrongRef = r() < 0.5 ? sha(rstr(r, 20)) : undefined;
    const out = run({ run_state: rs, packet: { verdict: pick(r, ['complete', 'pass', 'done']), rationale: rstr(r, 15), task_ref: wrongRef, conformance: { in_scope: true } } });
    assert.notEqual(out.status, 0, `NO-FALSE-PASS violated — a wrong-task completion PASSED on task ${jcs(task)} ref ${wrongRef} :: ${out.stdout}`);
  }
});

test('P3 UNFORGEABLE — a mandated council with fabricated receipts never passes [80 cases]', () => {
  const r = rng(0xC0DE);
  for (let i = 0; i < 80; i++) {
    const task = { id: rstr(r, 4), goal: rstr(r, 12) };
    const rs = { run_id: `fuzz3-${i}`, armed_at: '2020-01-01T00:00:00.000Z', gate_index: 0, task, review_routing: { council: true, min_voices: 1 + Math.floor(r() * 2), reviewer_keys: [generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })] } };
    // a fully well-formed completion packet EXCEPT the council receipts are fabricated strings.
    const fakeReceipts = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ reviewer_id: rstr(r, 8), signature: Buffer.from(rstr(r, 32)).toString('base64') }));
    const out = run({ run_state: rs, packet: { verdict: 'complete', rationale: rstr(r, 15), task_ref: sha(jcs(task)), conformance: { in_scope: true }, council_receipts: fakeReceipts } });
    assert.notEqual(out.status, 0, `UNFORGEABLE violated — fabricated council PASSED (exit 0) on run ${rs.run_id} :: ${out.stdout}`);
  }
});

test.after(() => rmSync(cwd, { recursive: true, force: true }));
