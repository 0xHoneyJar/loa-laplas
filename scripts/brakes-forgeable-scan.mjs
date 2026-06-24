#!/usr/bin/env node
// brakes-forgeable-scan.mjs — hunt the FORGEABLE-GATE vulnerability class across the brakes
// layer. The immune reflex, born from the poteau fix (construct-rooms-substrate-chk, PR #67).
//
// A gate is forgeable when ANY of these hold:
//   (A) MINT RESIDUE — it signs with a private key an agent can READ (a key under .run/ or the
//       working tree, loaded/written by the same process), instead of signer-mediated custody.
//   (B) STRUCTURE-ONLY VERIFY — it handles signed artifacts (a `.signature` field) in a verify
//       path but never calls verify() on the ed25519 signature. (This was poteau's BIGGER hole:
//       the chain links were checked, the signatures never were — forging needed no key at all.)
//   (C) POSITIONAL PASS — a "pass/true" hinges on a field an agent writes (a string verdict, a
//       self-asserted flag) rather than a signature it cannot forge. (Heuristic, noisy.)
//
// This SURFACES candidates (file:line + why) for adversarial triage — a reflex, not a proof.
// The cure each points toward is the custody pattern: keys held off-agent (legba signer daemon),
// signatures verified against a trusted key. settle / poteau (post-#67) are the worked examples.
//
// Usage: node scripts/brakes-forgeable-scan.mjs [--json] [--root DIR]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

// the brakes layer: where gates, custody, and verification live.
const SCAN_DIRS = ['poteau', 'scripts/legba', 'scripts/settle', 'scripts'];
const CODE = /\.(mjs|js|ts|sh)$/;
const SKIP = /node_modules|\/dist\/|\/\.git\/|\.test\.|\.security\.test\.|forgeable-scan|verify-receipts\.test/;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (!SKIP.test(p + '/')) walk(p, acc); }
    else if (CODE.test(e) && !SKIP.test(p)) acc.push(p);
  }
  return acc;
}
// dedupe files reachable from multiple roots
const files = [...new Set(SCAN_DIRS.flatMap((d) => walk(join(REPO, d))))];

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const findings = [];
const flag = (file, line, klass, why) => findings.push({ file: relative(REPO, file), line, class: klass, why });

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const usesCustody = /LEGBA_SIGNER_SOCKET|POTEAU_SIGNER_SOCKET|signer-relay|custodySign|callSigner|sign-gate/.test(src);
  const requiresCustodyGuard = /REQUIRE_CUSTODY|custodyRefuse|CUSTODY_REFUSED|fail.?closed/i.test(src);

  // (A) MINT RESIDUE — generates/loads a private key from agent-readable space AND signs with it.
  const signsLocally = /\bsign\s*\(\s*null/.test(src) || /\.sign\s*\(/.test(src);
  const keyResidueRe = /(generateKeyPairSync|createPrivateKey\s*\(\s*readFileSync|writeFileSync\s*\([^)]*key)/g;
  let m;
  while ((m = keyResidueRe.exec(src))) {
    // is the key path agent-readable (.run/ or a bare relative path), not a socket/custody?
    const around = src.slice(Math.max(0, m.index - 200), m.index + 200);
    const agentReadablePath = /\.run\/|['"`][^'"`]*\.key['"`]|gate\.key|POTEAU_KEY/.test(around);
    if (signsLocally && agentReadablePath && !(usesCustody && requiresCustodyGuard)) {
      flag(file, lineOf(src, m.index), 'A:mint-residue',
        'signs with a private key from agent-readable space (.run/ or a working-tree path) ' +
        (usesCustody ? 'with a custody path present but no fail-closed enforcement' : 'with no signer-mediated custody') +
        ' — a work agent can read the key and self-mint. Cure: route signing through a signer daemon (legba pattern) + fail closed.');
      break; // one finding per file is enough to trigger triage
    }
  }

  // (B) STRUCTURE-ONLY VERIFY — handles a `.signature` field in a verify context but never verify()s it.
  const handlesSignature = /\.signature\b|signature:|receipt_hash|token_hash/.test(src);
  const isVerifyContext = /verify|gate|receipt|attest|proof|custody|seal/i.test(file) || /verify-?gate|verifyRun|verifyToken|--poteau|chain integrity|receipt chain/i.test(src);
  // recognizes the signature actually being checked — inline, OR delegated to a verifier helper.
  const verifiesSignature = /\bverify\s*\(\s*null|verifyTokenSignature|legbaVerify|verifySnapshotSig|verifyRun|verifyToken|verify\s*\(.*sig|audit_verify/i.test(src);
  const delegatesVerify = /execFileSync[^;\n]*verify|spawn[^;\n]*verify|node[^;\n]*verify[-_]|poteau-verify-receipts|_LEGBA_BRIDGE|legba['"\s]+verify/i.test(src);
  // a MINTER produces signed artifacts; it is NOT supposed to verify (that happens downstream).
  const isMinter = /\bseal\s*\(|signToken|mint[A-Za-z]*\s*\(|derive[^;\n]*chain|sign-gate|--mint/i.test(src);
  if (handlesSignature && isVerifyContext && !verifiesSignature && !delegatesVerify && !isMinter) {
    const idx = src.search(/\.signature\b|receipt_hash|token_hash/);
    flag(file, lineOf(src, Math.max(0, idx)), 'B:structure-only-verify',
      'handles signed artifacts (a .signature / *_hash field) in a verify context but never calls ' +
      'verify() on the signature — chain/hash structure is checked, authorship is not. A chain-valid ' +
      'artifact with no valid signature passes. Cure: verify each signature against a trusted key.');
  }
}

// report
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
if (asJson) {
  process.stdout.write(JSON.stringify({ scanned: files.length, findings }, null, 2) + '\n');
} else {
  const C = { 'A:mint-residue': '\x1b[31m', 'B:structure-only-verify': '\x1b[33m' };
  const R = '\x1b[0m', D = '\x1b[2m', B = '\x1b[1m';
  process.stdout.write(`${B}∴ brakes forgeable-gate scan${R} ${D}· ${files.length} files · ${findings.length} candidate(s) (triage, not proof)${R}\n`);
  process.stdout.write(`${D}${'─'.repeat(64)}${R}\n`);
  if (!findings.length) process.stdout.write('  ✓ no forgeable-gate candidates surfaced\n');
  for (const f of findings) {
    process.stdout.write(`  ${C[f.class] || ''}${f.class}${R}  ${B}${f.file}:${f.line}${R}\n      ${D}${f.why}${R}\n`);
  }
}
// exit 4 if any A-class (mint residue) candidate — the higher-severity forge. B is informational.
process.exit(findings.some((f) => f.class.startsWith('A')) ? 4 : 0);
