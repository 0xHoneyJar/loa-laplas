#!/usr/bin/env node
// descend-check.mjs — validate that a substrate has correctly DESCENDED to the brakes
// layer (Phase 3 of the Descent: the reusable rail).
//
// GENERIC — works on ANY substrate dir, not just settle. This is the falsifiable tail of
// the descent procedure (grimoires/loa/runbooks/descent-procedure.md): after you walk a
// substrate from app → brakes, run this to prove it descended without bespoke steps.
//
// Usage: node scripts/descend-check.mjs <substrate-dir>
//   node scripts/descend-check.mjs scripts/settle                 # the real substrate
//   node scripts/descend-check.mjs scripts/descent-example-stub   # the proof stub
// Exit: 0 = descended · 1 = incomplete · 2 = bad usage
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error('descend-check: usage: node scripts/descend-check.mjs <substrate-dir>');
  process.exit(2);
}

const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
const mjs = files.filter((f) => f.endsWith('.mjs'));
const tests = files.filter((f) => f.endsWith('.test.mjs'));
const src = mjs.filter((f) => !f.endsWith('.test.mjs'));

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });

// 1. scripts-first: the substrate is .mjs ESM (laplas-native), not a TS package.
add('scripts-first (.mjs ESM)', src.length > 0, `${src.length} .mjs source file(s)`);

// 2. composes legba — no OWN ed25519 key generation (the single-signer invariant).
const ownSigner = src.filter((f) => /generateKeyPairSync\s*\(/.test(readFileSync(join(dir, f), 'utf8')));
add('composes legba (no own ed25519 signer)', ownSigner.length === 0,
  ownSigner.length ? `OWN signer in ${ownSigner.join(', ')}` : 'zero generateKeyPairSync calls');

// 3. the teeth: a test file exists and passes (counter-examples / negative control).
add('has tests (the teeth)', tests.length > 0, `${tests.length} test file(s)`);
if (tests.length) {
  let pass = false;
  try { execFileSync('node', ['--test', ...tests.map((t) => join(dir, t))], { stdio: 'pipe' }); pass = true; } catch { pass = false; }
  add('tests pass (node --test exit 0)', pass, pass ? 'green' : 'red');
}

// 4. the layer-law gate holds — this substrate introduced no inversion.
let gateOk = false;
try { execFileSync('bash', [join(HERE, 'layer-law-gate.sh')], { stdio: 'pipe' }); gateOk = true; } catch { gateOk = false; }
add('layer-law gate passes (VIOLATION=0)', gateOk, gateOk ? 'pass' : 'fail');

const allOk = checks.every((c) => c.ok);
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`);
console.log(`descend-check: ${allOk ? 'DESCENDED ✓' : 'INCOMPLETE ✗'} (${dir})`);
process.exit(allOk ? 0 : 1);
