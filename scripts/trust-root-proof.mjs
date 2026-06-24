#!/usr/bin/env node
// trust-root-proof.mjs — the CONSTRUCTIVE answer to the trust-substrate audit sweep (2026-06-24).
//
// Three trust-lens audits (poteau / settle / compose-verify) found the same thing: every consumer
// gate defaults to POSITIONAL self-consistency, and legba's ONE sound piece — the root-signed
// trust-store + resolveGatekeeperPubkey (#59, the cure all three panels praised) — is reached for
// by NONE of them. The audits proved what's broken. This proves the cure WORKS, end-to-end, in an
// isolated tmp world (no real keys touched): a gate that resolves its anchor THROUGH the rooted
// store accepts an AUTHENTIC claim and rejects every substitution the consumers were open to —
// a forged key, an agent-built store under a different root, and an in-repo anchor.
//
// "The substrate's word and the world's state are the same word — when the root is wired."
//
// Run: node scripts/trust-root-proof.mjs   (exit 0 = the vision holds; non-zero = it does not)
import { generateKeyPairSync, sign, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jcs, resolveGatekeeperPubkey } from './legba/legba-core.mjs';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', x: '\x1b[0m' };
const pemOf = (kp) => kp.publicKey.export({ type: 'spki', format: 'pem' });
const indent = (pem, n) => pem.trimEnd().split('\n').map((l) => ' '.repeat(n) + l).join('\n') + '\n';

// Provision a rooted trust-store exactly as legba's own verify path expects: the MAINTAINER ROOT
// signs the store body (schema + keys + revocations + cutoff); the pinned root pubkey is the
// out-of-band anchor the agent cannot forge against.
function writeRootedStore(path, rootPriv, rootPubPem, keys) {
  const core = { schema_version: '1.0', keys, revocations: [], trust_cutoff: { default_strict_after: '2026-05-03T00:00:00Z' } };
  const rootSig = sign(null, Buffer.from(jcs(core)), rootPriv).toString('base64');
  const keysYaml = keys.length
    ? '\n' + keys.map((k) => `  - key_id: "${k.key_id}"\n    gatekeeper_id: "${k.gatekeeper_id}"\n    pubkey_pem: |\n${indent(k.pubkey_pem, 6)}`).join('')
    : ' []';
  writeFileSync(path,
    `---\nschema_version: "1.0"\nroot_signature:\n  algorithm: ed25519\n  signer_pubkey: |\n${indent(rootPubPem, 4)}  signed_at: "2026-05-03T00:00:00Z"\n  signature: "${rootSig}"\nkeys:${keysYaml}\nrevocations: []\ntrust_cutoff:\n  default_strict_after: "2026-05-03T00:00:00Z"\n`);
}

// A consumer GATE that does what no consumer does today: resolve its anchor through the rooted
// store (strict), then verify the claim's signature against the RESOLVED pubkey — never a key the
// caller handed in. Returns { proceed, reason }.
function rootedGate(signedClaim, man, { trustStorePath, pinnedRootPubkeyPath } = {}) {
  const res = resolveGatekeeperPubkey(man, { strict: true, trustStorePath, pinnedRootPubkeyPath });
  if (!res.ok) return { proceed: false, reason: `anchor rejected (${res.status}): ${res.error}` };
  // verify the claim's signature against the ROOTED pubkey — not man.gatekeeper_pubkey_pem blindly.
  const pub = createPublicKey(res.pubkeyPem);
  const ok = verify(null, Buffer.from(jcs(signedClaim.claim)), pub, Buffer.from(signedClaim.sig, 'base64'));
  return ok ? { proceed: true, reason: `verified against the rooted gatekeeper key (status: ${res.status})` }
            : { proceed: false, reason: 'claim signature does not verify against the rooted key' };
}

const world = mkdtempSync(join(tmpdir(), 'trust-root-proof-'));
let failures = 0;
const scene = (n, want, got, detail) => {
  const ok = want === got.proceed;
  if (!ok) failures++;
  const tag = ok ? `${C.g}✓ as designed${C.x}` : `${C.r}✗ UNEXPECTED${C.x}`;
  process.stdout.write(`  ${tag}  ${C.b}${n}${C.x}\n      ${C.d}want proceed=${want}, got proceed=${got.proceed} — ${got.reason}${C.x}\n      ${C.d}${detail}${C.x}\n`);
};

try {
  process.stdout.write(`${C.b}∴ trust-root proof${C.x} ${C.d}— the audits' cure, wired end-to-end (isolated)${C.x}\n${C.d}${'─'.repeat(66)}${C.x}\n`);

  // ── provision the out-of-band root + a gatekeeper key ROOTED in it ──────────
  const root = generateKeyPairSync('ed25519');
  const rootPub = pemOf(root);
  const gk = generateKeyPairSync('ed25519');
  const gkPub = pemOf(gk);
  const man = { gatekeeper_id: 'proof:gate', gatekeeper_key_id: 'gk-v1', gatekeeper_pubkey_pem: gkPub };
  const trustStorePath = join(world, 'trust-store.yaml');
  const pinnedRootPath = join(world, 'maintainer-root-pubkey.txt');
  writeFileSync(pinnedRootPath, rootPub);
  writeRootedStore(trustStorePath, root.privateKey, rootPub, [{ key_id: 'gk-v1', gatekeeper_id: 'proof:gate', pubkey_pem: gkPub }]);
  const anchor = { trustStorePath, pinnedRootPubkeyPath: pinnedRootPath };

  // helper: sign a claim with a given private key
  const signClaim = (claim, priv) => ({ claim, sig: sign(null, Buffer.from(jcs(claim)), priv).toString('base64') });

  // ── 1. AUTHENTIC — the rooted gatekeeper signs; the gate proceeds ──────────
  scene('AUTHENTIC claim, rooted key',
    true,
    rootedGate(signClaim({ verdict: 'HELD', work: 'real' }, gk.privateKey), man, anchor),
    'the only outcome where the substrate\'s word == the world\'s state.');

  // ── 2. FORGED KEY — an agent signs with its OWN key, claims it as the gate ──
  const evil = generateKeyPairSync('ed25519');
  scene('FORGED key (agent self-signs, presents its own pubkey as the gate)',
    false,
    rootedGate(signClaim({ verdict: 'HELD', work: 'fake' }, evil.privateKey),
      { ...man, gatekeeper_pubkey_pem: pemOf(evil) }, anchor),
    'rejected: the presented key is not the one the root signed — the agent cannot substitute the anchor (Form-C cure).');

  // ── 3. SUBSTITUTED STORE — agent builds its OWN store under its OWN root ────
  const evilRoot = generateKeyPairSync('ed25519');
  const evilStore = join(world, 'evil-trust-store.yaml');
  writeRootedStore(evilStore, evilRoot.privateKey, pemOf(evilRoot), [{ key_id: 'gk-v1', gatekeeper_id: 'proof:gate', pubkey_pem: pemOf(evil) }]);
  scene('SUBSTITUTED store (agent roots its own key under its own root)',
    false,
    rootedGate(signClaim({ verdict: 'HELD', work: 'fake' }, evil.privateKey),
      { ...man, gatekeeper_pubkey_pem: pemOf(evil) }, { trustStorePath: evilStore, pinnedRootPubkeyPath: pinnedRootPath }),
    'rejected: the store\'s signer diverges from the PINNED maintainer root — substitution defeated.');

  // ── 4. IN-REPO ANCHOR — strict refuses an anchor inside the working tree ────
  const repoStore = join(fileURLToPath(new URL('.', import.meta.url)), '_proof_in_repo_store.yaml');
  writeRootedStore(repoStore, root.privateKey, rootPub, [{ key_id: 'gk-v1', gatekeeper_id: 'proof:gate', pubkey_pem: gkPub }]);
  try {
    scene('IN-REPO anchor (agent-writable store inside the repo tree)',
      false,
      rootedGate(signClaim({ verdict: 'HELD', work: 'real' }, gk.privateKey), man, { trustStorePath: repoStore, pinnedRootPubkeyPath: pinnedRootPath }),
      'rejected: strict verify refuses an anchor inside the repo (anchor_in_repo) — no agent-writable root.');
  } finally { rmSync(repoStore, { force: true }); }

  process.stdout.write(`${C.d}${'─'.repeat(66)}${C.x}\n`);
  if (failures === 0) {
    process.stdout.write(`${C.g}${C.b}∴ the vision holds.${C.x} The rooted anchor accepts only the authentic claim and defeats every\n  substitution the consumers were open to. ${C.b}This is what poteau/settle/compose-verify do not yet\n  reach for — but now CAN${C.x} ${C.d}(resolveGatekeeperPubkey is exported). The cure is real; it is unwired.${C.x}\n`);
  } else {
    process.stdout.write(`${C.r}${C.b}∴ ${failures} scene(s) did not behave as designed — the proof FAILED.${C.x}\n`);
  }
} finally {
  rmSync(world, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
