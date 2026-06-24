#!/usr/bin/env node
// grounded-scan.mjs — the GROUNDED reflex (gate-honesty axis 4, the Trusting-Trust axis).
//
// Hunts the MOCK-AS-ATTESTATION failure: a brakes-layer test that stands up an IN-PROCESS MOCK of
// a daemon/signer/verifier it CLAIMS to verify, with NO real-process companion — so the green
// certifies the MOCK's contract, not the real thing's. "The check I ran is the check I claim to
// run" — reproduced, not vouched.
//
// The canonical instance is the session's own wound: the #67 "custody verified" test (kdm) stood
// up an in-process server that signed `req.token`; the REAL legba daemon ignores `req.token` and
// replays the run dir, so it rejects that payload. The green certified a custody path that does
// not exist. The CURE (already applied to that file): keep the mock as a unit test, but ALSO
// spawn the REAL daemon and assert the true behaviour — the mock no longer stands alone as the
// attestation. This reflex flags mocks that DO still stand alone.
//
// Surfaces candidates for triage (a reflex, not a proof). Usage: node scripts/grounded-scan.mjs [--json]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');
const SCAN_DIRS = ['poteau', 'scripts/legba', 'scripts/settle', 'scripts'];
const SKIP = /node_modules|\/dist\/|\/\.git\/|grounded-scan/;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (!SKIP.test(p + '/')) walk(p, acc); }
    else if (/\.test\.mjs$/.test(e) && !SKIP.test(p)) acc.push(p);
  }
  return acc;
}
const files = [...new Set(SCAN_DIRS.flatMap((d) => walk(join(REPO, d))))];

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const findings = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  // (1) does it stand up an in-process MOCK of a service that signs/responds as the thing-under-test?
  const mockIdx = src.search(/net\.createServer|createServer\s*\(/);
  const mocksAService = mockIdx !== -1 && /sign\s*\(|signature\b|\bok:\s*true|conn\.end\s*\(/.test(src);
  // (2) does the file CLAIM to attest a real custody/signing integration (not just a pure unit)?
  const claimsRealIntegration = /custody|daemon|signer|sign-gate|signing|gatekeeper/i.test(file)
    || /CUSTODY|daemon|signer|sign-gate/i.test(src);
  // (3) is there a REAL-process companion — the mock is NOT the sole attestation?
  const hasRealCompanion = /spawn\s*\([^;\n]*DAEMON|spawn\s*\([^;\n]*process\.execPath[^;\n]*[Dd]aemon|REAL daemon|real-signer|legba-signer-daemon\.mjs/i.test(src);

  if (mocksAService && claimsRealIntegration && !hasRealCompanion) {
    findings.push({
      file: relative(REPO, file), line: lineOf(src, mockIdx), class: 'mock-as-attestation', cured: false,
      why: 'stands up an in-process MOCK of a daemon/signer it claims to verify, with NO real-process '
        + 'companion (no spawn of the real daemon). A green here certifies the MOCK\'s contract, not the '
        + 'real thing\'s — the kdm failure. Cure: ALSO spawn the real process and assert its true behaviour.',
    });
  } else if (mocksAService && claimsRealIntegration && hasRealCompanion) {
    findings.push({
      file: relative(REPO, file), line: lineOf(src, mockIdx), class: 'mock-as-attestation', cured: true,
      why: 'mocks a service BUT also spawns the real one — the mock is a unit, the real-process test is '
        + 'the attestation. GROUNDED (this is the cure; surfaced as a positive, not a candidate).',
    });
  }
}

findings.sort((a, b) => a.file.localeCompare(b.file));
const open = findings.filter((f) => !f.cured);
if (asJson) {
  process.stdout.write(JSON.stringify({ scanned: files.length, findings }, null, 2) + '\n');
} else {
  const R = '\x1b[0m', D = '\x1b[2m', B = '\x1b[1m', Y = '\x1b[33m', G = '\x1b[32m';
  process.stdout.write(`${B}∴ grounded scan${R} ${D}· axis 4 (Trusting-Trust) · ${files.length} test files · ${open.length} ungrounded candidate(s)${R}\n${D}${'─'.repeat(66)}${R}\n`);
  if (!findings.length) process.stdout.write('  ✓ no mock-as-attestation surfaces\n');
  for (const f of findings) {
    const tag = f.cured ? `${G}✓ grounded (cured)${R}` : `${Y}mock-as-attestation${R}`;
    process.stdout.write(`  ${tag}  ${B}${f.file}:${f.line}${R}\n      ${D}${f.why}${R}\n`);
  }
}
// exit 4 if any UNGROUNDED candidate (a mock standing alone as attestation); cured ones are informational.
process.exit(open.length ? 4 : 0);
