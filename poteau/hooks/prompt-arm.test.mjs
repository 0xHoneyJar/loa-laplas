// prompt-arm.test.mjs — gate-honesty axis 3 (truthful-state): the arm hook must NOT claim a
// session is in a run it never entered. 9x7: a recon/inspect session that merely types /compose
// must NOT get a by-session link forged from a stale run-state (which would deadlock it at the
// exit-gate). The DISPATCHER's gate 0 is the sole armer/linker; this hook only READS the link.
//
// Run: node --test poteau/hooks/prompt-arm.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'prompt-arm.sh');
const tmp = () => mkdtempSync(join(tmpdir(), 'poteau-arm-'));
const run = (payload, cwd) => spawnSync('bash', [HOOK], { cwd, input: JSON.stringify(payload), encoding: 'utf8' });

test('9x7: a recon session (stale run-state present, NO dispatcher link) is NOT armed — no by-session forged', () => {
  const cwd = tmp();
  try {
    // a stale, unrelated armed run lying around from some prior /compose (the bug's bait).
    mkdirSync(join(cwd, '.run/poteau/stale-run'), { recursive: true });
    writeFileSync(join(cwd, '.run/poteau/stale-run/run-state.json'), JSON.stringify({ run_id: 'stale-run', task: { id: 'x' } }));
    const r = run({ prompt: '/compose inspect something', session_id: 'recon-sess' }, cwd);
    assert.equal(r.status, 0, r.stderr);
    // THE FIX: the recon session must NOT have been linked to the stale run.
    assert.ok(!existsSync(join(cwd, '.run/poteau/by-session/recon-sess')), 'a recon session must not adopt a stale run — no by-session link forged');
    assert.match(r.stdout, /no run is armed for this session|dispatch with --module/, 'should nudge toward dispatch, not claim ARMED');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('a real session WITH a dispatcher-written link gets the accurate ARMED gradient (reads, never forges)', () => {
  const cwd = tmp();
  try {
    mkdirSync(join(cwd, '.run/poteau/real-run'), { recursive: true });
    writeFileSync(join(cwd, '.run/poteau/real-run/run-state.json'), JSON.stringify({ run_id: 'real-run', task: { id: 'x' } }));
    // the DISPATCHER (gate 0) already linked this session → run.
    mkdirSync(join(cwd, '.run/poteau/by-session'), { recursive: true });
    writeFileSync(join(cwd, '.run/poteau/by-session/real-sess'), JSON.stringify({ run_id: 'real-run', armed_at: '2020-01-01T00:00:00Z' }));
    const r = run({ prompt: '/compose the-real-thing', session_id: 'real-sess' }, cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /POTEAU ARMED \(run real-run\)/, 'an authentically-linked session sees its run');
    assert.match(r.stdout, /verdict:aborted/, 'the gradient should now point at the sanctioned abort door (xok)');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('the hook never creates a by-session link for a session the dispatcher did not link (idempotent read)', () => {
  const cwd = tmp();
  try {
    // no run-state at all, no link — a bare /compose.
    const r = run({ prompt: '/compose', session_id: 's1' }, cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(join(cwd, '.run/poteau/by-session/s1')), 'no link must be forged');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
