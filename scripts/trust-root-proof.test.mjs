// trust-root-proof.test.mjs — pins the constructive proof. The rooted anchor must accept the
// authentic claim and defeat every substitution (forged key, agent-rooted store, in-repo anchor).
// If a future change weakens legba's rooted verify, the proof exits non-zero and this goes red.
//
// Run: node --test scripts/trust-root-proof.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROOF = join(dirname(fileURLToPath(import.meta.url)), 'trust-root-proof.mjs');

test('the trust-root proof holds — rooted anchor accepts authentic, defeats every substitution', () => {
  const r = spawnSync(process.execPath, [PROOF], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'the vision must hold (exit 0) · ' + r.stdout + r.stderr);
  assert.match(r.stdout, /AUTHENTIC claim, rooted key/);
  assert.match(r.stdout, /the vision holds/);
  assert.doesNotMatch(r.stdout, /UNEXPECTED/, 'no scene may behave against design');
});
