// brakes-forgeable-scan.test.mjs — prove the immune reflex actually bites.
// A scanner you can't watch catch a planted vulnerability is decoration. This plants a Form-A
// forgeable gate (agent-readable signing key) and asserts the scanner surfaces it (exit 4),
// then removes it and asserts the scan goes quiet. (Mirror of the layer-law inverted-fixture.)
//
// Run: node --test scripts/brakes-forgeable-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN = join(HERE, 'brakes-forgeable-scan.mjs');
const REPO = join(HERE, '..');
const FIX_DIR = join(REPO, 'scripts', '__forgeable_fixture__');
const FIX = join(FIX_DIR, 'forge.mjs');
const scan = () => spawnSync(process.execPath, [SCAN, '--json'], { cwd: REPO, encoding: 'utf8' });
const cleanup = () => { if (existsSync(FIX_DIR)) rmSync(FIX_DIR, { recursive: true, force: true }); };

test('clean brakes layer → 0 A-class candidates (exit 0)', () => {
  cleanup();
  const r = scan();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).findings.filter((f) => f.class.startsWith('A')).length, 0);
});

test('NEGATIVE CONTROL: a planted Form-A forgeable gate (agent-readable signing key) is CAUGHT (exit 4)', () => {
  mkdirSync(FIX_DIR, { recursive: true });
  writeFileSync(
    FIX,
    "// a deliberately forgeable gate: signs with a key written to agent-readable space.\n" +
    "import { generateKeyPairSync, sign } from 'node:crypto';\n" +
    "import { writeFileSync } from 'node:fs';\n" +
    "const kp = generateKeyPairSync('ed25519');\n" +
    "writeFileSync('.run/poteau/gate.key', kp.privateKey.export({ type: 'pkcs8', format: 'pem' }));\n" +
    "export const pass = sign(null, Buffer.from('x'), kp.privateKey);\n",
  );
  try {
    const r = scan();
    assert.equal(r.status, 4, 'an A-class mint-residue candidate must exit 4');
    const found = JSON.parse(r.stdout).findings.find((f) => f.file.includes('__forgeable_fixture__'));
    assert.ok(found, 'the planted forgeable gate must be surfaced');
    assert.equal(found.class, 'A:mint-residue');
  } finally { cleanup(); }
});

test('scanner goes quiet again once the planted gate is removed', () => {
  const r = scan();
  assert.equal(r.status, 0);
});
