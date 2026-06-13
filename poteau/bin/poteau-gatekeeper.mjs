#!/usr/bin/env node
/**
 * poteau-gatekeeper.mjs — the deterministic judge the exit-gate hook shells to.
 *
 * stdin:  {run_state, packet, transcript_tail?}   (assembled by exit-gate.sh)
 * stdout: verdict JSON {pass, receipt?|refusal}
 * exit:   0 pass (receipt minted) · 2 refuse (refusal teaches) · 5 internal (custody
 *         gates fail CLOSED: an internal error refuses, never waves through — P500)
 *
 * Checks, mapped to the issues they close:
 *   G1 packet-present + required fields            (the EOF: "done" is checkable)
 *   G2 TASK CONFORMANCE (#29): packet.task_ref must hash-match run_state.task, and
 *      packet.conformance must assert scope. The gate cannot approve work it never
 *      compared to the task — so the task travels INTO the verdict, mechanically.
 *   G3 PROOF OF GROUNDING (#31): for each run_state.mandated_reads entry, the packet
 *      rationale must OPEN with that document's literal H1 (h1_echo mode). A read that
 *      left no echo is presumed unread. Mechanical, no semantic judgment.
 *   G4 COUNCIL HONOR (#30, runtime half): if run_state.review_routing mandates a
 *      council, the packet must carry council receipts (>=2 distinct reviewer ids);
 *      a single voice on a mandated council surface refuses.
 *   G5 mint: ed25519-signed gate receipt, chained to prev receipt (legba shape).
 *
 * Zero-dep, node:crypto only. Key ceremony: per-repo key at .run/poteau/gate.key
 * (generated on first run; production: provisioned per room, versioned, public
 * keys published — see PROMPT.md Phase 4).
 */
import { createHash, generateKeyPairSync, sign, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const jcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');

const refuse = (code, teach) => {  // refusals teach: what failed, the fix, the why — one breath
  process.stdout.write(JSON.stringify({ pass: false, code, refusal: teach }) + '\n');
  process.exit(2);
};
// custody refusals fail CLOSED with exit 5 (distinct from the policy refusals'
// exit 2) — an internal/custody fault refuses, never waves through (P500).
const custodyRefuse = (teach) => {
  process.stdout.write(JSON.stringify({ pass: false, code: 'P500', refusal: teach }) + '\n');
  process.exit(5);
};

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch { process.stdout.write(JSON.stringify({ pass: false, code: 'P500', refusal: 'gatekeeper: malformed stdin — custody gates fail closed; fix the exit-gate assembly, do not bypass.' }) + '\n'); process.exit(5); }

const { run_state: rs = {}, packet } = input;

// G1 — the EOF
if (!packet) refuse('P101', 'No handoff packet found. Emit the construct-handoff packet (verdict, outputs, rationale) to .run/poteau/packet.json, then stop again. The packet IS the exit — there is no door without it.');
for (const f of ['verdict', 'rationale']) if (!(f in packet))
  refuse('P102', `Handoff packet missing required field "${f}". Add it and stop again. (Three-tier discipline: required fields fail closed.)`);

// G2 — task conformance (#29: the gate must see the task)
if (rs.task) {
  const want = sha(jcs(rs.task));
  if (packet.task_ref !== want)
    refuse('P201', `Packet.task_ref does not match the armed task (expected ${want.slice(0, 26)}…). Copy run_state.task_ref into the packet and assert conformance — the gate judges work AGAINST THE TASK, not coherence in a vacuum.`);
  if (!packet.conformance || packet.conformance.in_scope !== true)
    refuse('P202', 'Packet.conformance.in_scope must be explicitly asserted (true) with a one-line scope note. Verdict rule: CHANGES_REQUIRED if the diff does not implement the TASK within SCOPE, regardless of internal quality.');
}

// G3 — proof of grounding (#31: reads leave echoes)
if ((rs.mandated_reads ?? []).length) {
  const rationale = String(packet.rationale ?? '');
  for (const read of rs.mandated_reads) {
    const h1 = String(read.h1 ?? '').trim();
    if (!h1) continue;
    if (!rationale.includes(h1))
      refuse('P203', `Mandated read not evidenced: rationale must quote the H1 of "${read.path}" verbatim — open your rationale with: ${h1} — then ground your reasoning in it. A read that left no echo is presumed unread (0/4 becomes 4/4 by mechanism, not memory).`);
  }
}

// G4 — council honor (#30, runtime half)
if (rs.review_routing?.council === true) {
  const voices = new Set((packet.council_receipts ?? []).map(r => r.reviewer_id));
  if (voices.size < (rs.review_routing.min_voices ?? 2))
    refuse('P204', `This surface mandates a council (min ${rs.review_routing.min_voices ?? 2} voices); packet carries ${voices.size}. Single-model review FORBIDDEN here — attach council receipts or route through the council runner. Silent downgrade is the one failure this gate exists to prevent.`);
}

// G5 — mint the receipt (legba shape: signed, chained). CUSTODY: the whole
// block fails CLOSED — any throw (corrupt key, bad digest) → P500 exit 5, never
// an uncaught exit-1 wave-through (bridgebuilder finding).
try {
  // run-scoped chain (bridgebuilder/B8): each ceremony OWNS its chain at
  // .run/poteau/<run_id>/receipts.jsonl. An unarmed session (no run_id) must
  // produce ABSENCE of receipts, not an "unarmed" one verify-gate would mistake
  // for forgery — so refuse rather than mint unscoped.
  if (!rs.run_id) custodyRefuse('gatekeeper: armed mint requires run_state.run_id — refusing to mint an unscoped receipt. An unarmed session produces NO receipts (verify-gate stamps governance:unarmed); arm via the dispatcher gate 0.');
  const runDir = '.run/poteau/' + rs.run_id;
  mkdirSync(runDir, { recursive: true });
  const keyPath = process.env.POTEAU_KEY ?? '.run/poteau/gate.key';  // shared until FR-E per-run keys
  let priv;
  if (existsSync(keyPath)) priv = createPrivateKey(readFileSync(keyPath));
  else {
    const kp = generateKeyPairSync('ed25519');
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(keyPath + '.pub', kp.publicKey.export({ type: 'spki', format: 'pem' }));
    priv = kp.privateKey;
  }
  const chainPath = runDir + '/receipts.jsonl';
  let prev = null;
  if (existsSync(chainPath)) {
    const lines = readFileSync(chainPath, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) prev = JSON.parse(lines[lines.length - 1]).receipt_hash;
  }
  const receipt = {
    receipt_kind: 'poteau_gate_pass', poteau_version: '0.1.0',
    run_id: rs.run_id, gate_index: rs.gate_index ?? 0,
    prev_receipt_hash: prev,
    task_ref: packet.task_ref ?? null,
    packet_hash: sha(jcs(packet)),
    checks: { task_conformance: !!rs.task, grounding: (rs.mandated_reads ?? []).length, council: !!rs.review_routing?.council },
    ts: new Date().toISOString(),
  };
  // IMP-011 freshness: the run-scoped chain already makes cross-run replay
  // structurally impossible; additionally refuse a receipt predating arming.
  if (rs.armed_at && receipt.ts < rs.armed_at) custodyRefuse('gatekeeper: receipt ts predates run armed_at (clock skew or replay) — refused (IMP-011).');
  const sealed = { receipt, signature: sign(null, Buffer.from(jcs(receipt)), priv).toString('base64'), receipt_hash: sha(jcs(receipt)) };
  writeFileSync(chainPath, (existsSync(chainPath) ? readFileSync(chainPath, 'utf8') : '') + JSON.stringify(sealed) + '\n');
  process.stdout.write(JSON.stringify({ pass: true, receipt_hash: sealed.receipt_hash, gate_index: receipt.gate_index }) + '\n');
} catch (e) {
  custodyRefuse('gatekeeper: receipt mint failed (' + (e && e.message ? e.message : e) + ') — custody fails closed, never waved through.');
}
