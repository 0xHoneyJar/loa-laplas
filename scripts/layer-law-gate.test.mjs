// layer-law-gate.test.mjs — the gate's teeth, proven (Phase 3 of the Descent).
//
// Like settle's broken-gate negative control: a gate you can't watch BITE is not a
// gate. This drops an intentionally-INVERTED fixture into laplas (a lower layer, depth
// 1, importing a higher one — the application layer, depth 2) and asserts the gate exits
// NON-ZERO. Then it removes the fixture and asserts the gate goes quiet again.
//
// NOTE: the higher-layer repo name is assembled at runtime (HIGHER below) so this
// committed test file does NOT itself contain that literal — otherwise the verifier's
// coarse grep would flag the test as a real inversion (the Phase-1 self-reference trap).
//
// Run: node --test scripts/layer-law-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, 'layer-law-gate.sh');
const REPO = join(HERE, '..');
const FIXTURE_DIR = join(REPO, 'scripts', '__layerlaw_inverted_fixture__');
const FIXTURE = join(FIXTURE_DIR, 'inverted.mjs');

function runGate() {
  try {
    execFileSync('bash', [GATE], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

function cleanup() {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

test('layer-law gate PASSES on a clean tree (VIOLATION=0)', () => {
  cleanup();
  assert.equal(runGate(), 0, 'gate must exit 0 when no inversion exists');
});

// The higher-layer repo name, assembled so the literal never appears in this committed file.
const HIGHER = 'loa-' + 'free' + 'side';

test('NEGATIVE CONTROL: an inverted fixture (lower → higher layer) makes the gate BITE (exit non-zero)', () => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  // The inversion the Descent Law forbids: a lower layer importing a higher one.
  writeFileSync(
    FIXTURE,
    "// INTENTIONALLY INVERTED — proves the layer-law gate's teeth. Not real code.\n" +
    `import higher from '${HIGHER}/some-higher-layer-module';\n` +
    "export default higher;\n",
  );
  try {
    const code = runGate();
    assert.notEqual(code, 0, 'the gate MUST exit non-zero on an inversion (downward-only violated)');
    assert.equal(code, 1, 'exit 1 = VIOLATION (the inversion was detected)');
  } finally {
    cleanup();
  }
});

test('gate goes quiet again once the inversion is removed (teeth retract cleanly)', () => {
  assert.equal(runGate(), 0, 'gate must exit 0 once the inversion is gone');
});
