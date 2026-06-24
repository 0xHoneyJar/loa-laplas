// grounded-scan.test.mjs — prove the GROUNDED reflex bites. A scanner you can't watch catch a
// planted mock-as-attestation is decoration. This plants a custody test that stands up an
// in-process mock with NO real-process companion (the kdm shape) and asserts the scanner catches
// it (exit 4); the kdm fix itself must read as cured, not as a candidate.
//
// Run: node --test scripts/grounded-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN = join(HERE, 'grounded-scan.mjs');
const FIX_DIR = join(HERE, '__grounded_fixture__');
const FIX = join(FIX_DIR, 'fake-custody.test.mjs');
const scan = () => spawnSync(process.execPath, [SCAN, '--json'], { encoding: 'utf8' });
const cleanup = () => { if (existsSync(FIX_DIR)) rmSync(FIX_DIR, { recursive: true, force: true }); };

test('clean → 0 ungrounded candidates; the kdm fix reads as CURED (mock + real companion)', () => {
  cleanup();
  const r = scan();
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.findings.filter((f) => !f.cured).length, 0, 'no mock should stand alone as attestation');
  // the security test (mock + real-daemon spawn) must be recognized as the CURE, not flagged.
  const sec = out.findings.find((f) => f.file.includes('poteau-gatekeeper.security.test.mjs'));
  if (sec) assert.equal(sec.cured, true, 'a mock WITH a real-process companion is grounded, not a candidate');
});

test('NEGATIVE CONTROL: a planted mock-only custody test (the kdm shape) is CAUGHT (exit 4)', () => {
  mkdirSync(FIX_DIR, { recursive: true });
  writeFileSync(
    FIX,
    "// a deliberately ungrounded test: it 'verifies CUSTODY' against an in-process MOCK daemon,\n" +
    "// never spawning the real signer — so the green certifies the mock's contract (kdm).\n" +
    "import net from 'node:net';\n" +
    "import { sign } from 'node:crypto';\n" +
    "const server = net.createServer((conn) => {\n" +
    "  conn.on('end', () => { conn.end(JSON.stringify({ ok: true, signature: 'fake' })); });\n" +
    "});\n",
  );
  try {
    const r = scan();
    assert.equal(r.status, 4, 'a mock-only custody attestation must exit 4');
    const found = JSON.parse(r.stdout).findings.find((f) => f.file.includes('__grounded_fixture__'));
    assert.ok(found, 'the planted mock-as-attestation must be surfaced');
    assert.equal(found.cured, false, 'a mock with no real companion is an OPEN candidate, not cured');
  } finally { cleanup(); }
});

test('quiet again once the planted mock is removed', () => {
  const r = scan();
  assert.equal(r.status, 0);
});
