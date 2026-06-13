#!/usr/bin/env node
/**
 * reviewer-keys.mjs — FR-E reviewer keyset (bug-20260612-b2936d).
 *
 * The council's cryptographic root: one Ed25519 keypair per reviewer (provider).
 * The COUNCIL RUNNER signs each council receipt with a reviewer PRIVATE key; the
 * SEEDER provisions the matching PUBLIC keys into run_state.review_routing.
 * reviewer_keys; the GATEKEEPER (G4) verifies. A self-reflecting work agent
 * cannot forge a council because it does not hold the private keys.
 *
 *   DECLARED LIMIT (honest, per the operator's FR-E decision): in this wave the
 *   private keys live on the shared filesystem at .run/poteau/reviewers/. The
 *   tool-gate denies the governed agent from READING that dir — but that is
 *   FENCE-grade (subshell-bypassable), not hard isolation. Hard isolation is a
 *   DEPLOYMENT property: the council runner / reviewer keys must live outside the
 *   governed agent's reach (separate process or host). The code provides the
 *   mechanism; the deployment must provide the isolation.
 *
 * The signed payload is the PACKET CONTENT HASH (review C-REPLAY): the reviewer
 * signs the packet_hash = sha(jcs(packet WITHOUT council_receipts)). Binding to the
 * packet — not {task_ref,verdict} — is what makes the signature non-replayable: a
 * signature for packet P does not verify for any other packet P′. The gatekeeper
 * recomputes the same hash and verifies against it.
 *
 * CLI:
 *   reviewer-keys.mjs pub  <provider>                → ensure keypair, print SPKI pub PEM
 *   reviewer-keys.mjs sign <provider> <packet_hash>  → ensure keypair, print base64 Ed25519 sig
 * env POTEAU_REVIEWERS overrides the keyset dir (default <repo>/.run/poteau/reviewers).
 */
import { generateKeyPairSync, sign as edSign, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEYSET = process.env.POTEAU_REVIEWERS || join(REPO, '.run', 'poteau', 'reviewers');

// A provider id must be a safe filename component (no traversal / separators).
const safe = (p) => { if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) || p.includes('..')) throw new Error(`unsafe reviewer id: ${p}`); return p; };

export function ensureKeypair(provider) {
  const id = safe(provider);
  mkdirSync(KEYSET, { recursive: true });
  const privPath = join(KEYSET, id + '.key');
  const pubPath = join(KEYSET, id + '.pub');
  if (!existsSync(privPath)) {
    const kp = generateKeyPairSync('ed25519');
    writeFileSync(privPath, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(pubPath, kp.publicKey.export({ type: 'spki', format: 'pem' }));
  }
  return { privPath, pubPath };
}

export function pubPem(provider) {
  const { pubPath } = ensureKeypair(provider);
  return readFileSync(pubPath, 'utf8');
}

// Sign the packet content hash (C-REPLAY: binds the receipt to THIS packet).
export function signCouncil(provider, packetHash) {
  if (!packetHash) throw new Error('signCouncil requires a packet_hash to sign');
  const { privPath } = ensureKeypair(provider);
  const priv = createPrivateKey(readFileSync(privPath));
  return edSign(null, Buffer.from(String(packetHash)), priv).toString('base64');
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, provider, packetHash] = process.argv.slice(2);
  try {
    if (cmd === 'pub') process.stdout.write(pubPem(provider).trim() + '\n');
    else if (cmd === 'sign') process.stdout.write(signCouncil(provider, packetHash) + '\n');
    else { console.error('usage: reviewer-keys.mjs pub <provider> | sign <provider> <packet_hash>'); process.exit(64); }
  } catch (e) { console.error('reviewer-keys: ' + (e && e.message ? e.message : e)); process.exit(1); }
}
