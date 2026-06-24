#!/usr/bin/env node
// poteau-verify-receipts.mjs — verify the AUTHENTICITY of a poteau receipt chain, not just its
// linkage (the other half of the "poteau gate forgeable" fix · construct-rooms-substrate-chk).
//
// compose-verify-run.sh --poteau checks the chain LINKS (prev_receipt_hash). It does NOT check
// that each receipt carries a valid Ed25519 SIGNATURE — so a work agent forges a gate by
// writing a chain-valid receipts.jsonl with NO valid signature (it was never verified). This
// closes that: every receipt must verify against the gatekeeper's TRUSTED public key.
//
// Trusted pubkey, in order: custody (LEGBA_SIGNER_SOCKET → the daemon pubkey, which the work
// agent cannot read or substitute) → else the legacy on-disk gate.key.pub (weaker — agent-
// writable, but still catches the unsigned/garbage forge).
//
// Usage: poteau-verify-receipts.mjs <receipts.jsonl> [gate.key.pub]
// Exit:  0 all receipts authentic · 4 a signature is invalid/absent/tampered · 2 usage/no-pubkey
import { readFileSync, existsSync } from 'node:fs';
import { createHash, verify, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const jcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
const fail = (msg, code = 4) => { process.stderr.write('poteau-verify-receipts: ' + msg + '\n'); process.exit(code); };

const receiptsPath = process.argv[2];
const pubkeyPath = process.argv[3];
if (!receiptsPath || !existsSync(receiptsPath)) fail('usage: poteau-verify-receipts.mjs <receipts.jsonl> [gate.key.pub]', 2);

// resolve the trusted gatekeeper public key
let pub;
const socket = process.env.LEGBA_SIGNER_SOCKET || process.env.POTEAU_SIGNER_SOCKET;
if (socket) {
  const relay = new URL('../../scripts/legba/legba-signer-relay.mjs', import.meta.url).pathname;
  const gatekeeperId = process.env.POTEAU_GATEKEEPER_ID ?? 'poteau-gate';
  let out;
  try {
    out = JSON.parse(execFileSync(process.execPath, [relay, 'pubkey'], {
      input: JSON.stringify({ gatekeeperId }), encoding: 'utf8',
      env: { ...process.env, LEGBA_SIGNER_SOCKET: socket },
    }));
  } catch (e) { fail('signer pubkey fetch failed (' + (e && e.message ? e.message : e) + ')', 2); }
  const pem = out && (out.publicKeyPem || out.publicKey || out.pubkey);
  if (!pem) fail('signer daemon returned no public key (' + JSON.stringify(out) + ')', 2);
  pub = createPublicKey(pem);
} else if (pubkeyPath && existsSync(pubkeyPath)) {
  pub = createPublicKey(readFileSync(pubkeyPath));
} else {
  fail('no trusted gatekeeper public key — set LEGBA_SIGNER_SOCKET (custody) or pass gate.key.pub', 2);
}

const lines = readFileSync(receiptsPath, 'utf8').trim().split('\n').filter(Boolean);
if (!lines.length) fail('empty receipt chain', 4);
for (const [i, line] of lines.entries()) {
  let sealed;
  try { sealed = JSON.parse(line); } catch { fail(`receipt ${i}: unparseable JSON`); }
  if (!sealed.receipt || typeof sealed.signature !== 'string') fail(`receipt ${i}: missing receipt or signature (forged/incomplete)`);
  if (sealed.receipt_hash !== sha(jcs(sealed.receipt))) fail(`receipt ${i}: receipt_hash does not match the receipt body (tampered)`);
  let ok = false;
  try { ok = verify(null, Buffer.from(jcs(sealed.receipt)), pub, Buffer.from(sealed.signature, 'base64')); } catch { ok = false; }
  if (!ok) fail(`receipt ${i}: signature does NOT verify against the gatekeeper key (forged gate pass)`);
}
process.stdout.write(JSON.stringify({ ok: true, verified: lines.length, custody: !!socket }) + '\n');
