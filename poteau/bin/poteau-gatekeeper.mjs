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
 *   G3 GROUNDING HEURISTIC (#31; honestly reframed by bug-20260612-b2936d): the
 *      packet rationale must echo each mandated read's H1. A WEAK signal, not a
 *      proof — the H1 lives in the readable run_state, so it proves the string was
 *      reproduced, not that the doc was read. Catches the agent that ignored the
 *      mandate; does not prove grounding. See the G3 block for the declared limit.
 *   G4 COUNCIL HONOR (#30, runtime half; hardened by bug-20260612-b2936d): if
 *      run_state.review_routing mandates a council, each council receipt must carry
 *      a valid Ed25519 SIGNATURE from a distinct PROVISIONED reviewer key (verified
 *      against run_state.review_routing.reviewer_keys) — not a fabricable id string.
 *      This is the gate's own G5 signature discipline turned inward, and it is what
 *      restores author/judge isolation (a work agent can write any packet but cannot
 *      sign for reviewer keys it does not hold).
 *   G5 mint: ed25519-signed gate receipt, chained to prev receipt (legba shape).
 *
 * Zero-dep, node:crypto only. Key ceremony: per-repo key at .run/poteau/gate.key
 * (generated on first run; production: provisioned per room, versioned, public
 * keys published — see PROMPT.md Phase 4).
 */
import { createHash, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

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

// 2h1: cite the EXACT packet path the exit-gate reads — run-scoped when armed
// (.run/poteau/<run_id>/packet.json), flat only on the unarmed port fallback. An agent that
// obeys a flat-path refusal while armed writes where the gate never looks → deadlock. Align
// the message with exit-gate.sh's RUN_DIR resolution.
const packetPath = rs.run_id ? `.run/poteau/${rs.run_id}/packet.json` : '.run/poteau/packet.json';

// G1 — the EOF
if (!packet) refuse('P101', `No handoff packet found. Emit the construct-handoff packet (verdict, outputs, rationale) to ${packetPath}, then stop again. The packet IS the exit — there is no door without it.`);
for (const f of ['verdict', 'rationale']) if (!(f in packet))
  refuse('P102', `Handoff packet missing required field "${f}". Add it and stop again. (Three-tier discipline: required fields fail closed.)`);

// HONEST EXIT (xok): an aborting agent cannot truthfully assert conformance.in_scope — it is
// NOT completing the task in scope. Without a sanctioned abort, an honest no-op deadlocks at
// G2 (only operator break-glass or the loop-guard releases it). verdict:'aborted' is the
// truthful door: it clears the COMPLETION gates (G2 in_scope, G3 grounding, G4 council — none
// apply to a withdrawal) and mints an ABORT receipt, recorded as an abort, NOT a pass. The
// gated capability still requires a real pass downstream; an abort grants nothing — it only
// lets honest non-completion stop cleanly, with a truthful trail entry instead of a deadlock.
const ABORTING = packet.verdict === 'aborted';

// G2 — task conformance (#29: the gate must see the task). Skipped for an honest abort (xok).
if (!ABORTING && rs.task) {
  const want = sha(jcs(rs.task));
  if (packet.task_ref !== want)
    refuse('P201', `Packet.task_ref does not match the armed task (expected ${want.slice(0, 26)}…). Copy run_state.task_ref into the packet and assert conformance — the gate judges work AGAINST THE TASK, not coherence in a vacuum.`);
  if (!packet.conformance || packet.conformance.in_scope !== true)
    refuse('P202', 'Packet.conformance.in_scope must be explicitly asserted (true) with a one-line scope note. Verdict rule: CHANGES_REQUIRED if the diff does not implement the TASK within SCOPE, regardless of internal quality.');
}

// G3 — grounding HEURISTIC (#31). HONEST LIMIT (bug-20260612-b2936d): the H1
// lives in run_state.mandated_reads[].h1 (readable), so this checks the H1 string
// was REPRODUCED, not that the document was read or the reasoning grounded in it.
// It is a weak signal — it catches the agent that ignored the mandate entirely —
// NOT a proof. Any grounding proof an agent can produce by reading the doc it can
// also produce by reading the run-state if the proof is embedded there; closing
// this absolutely requires an out-of-band check (the gatekeeper reading the actual
// file), which is deferred. We keep the signal but DO NOT over-claim "proof".
if (!ABORTING && (rs.mandated_reads ?? []).length) {
  const rationale = String(packet.rationale ?? '');
  for (const read of rs.mandated_reads) {
    const h1 = String(read.h1 ?? '').trim();
    if (!h1) continue;
    if (!rationale.includes(h1))
      refuse('P203', `Mandated read not evidenced: rationale must quote the H1 of "${read.path}" verbatim — open your rationale with: ${h1} — then ground your reasoning in it. (Heuristic: a missing echo signals the mandate was ignored; a present echo is necessary but not sufficient.)`);
  }
}

// G4 — council honor (#30, runtime half). SUBSTANCE not FORM (bug-20260612-b2936d):
// a council receipt must be a real Ed25519 SIGNATURE from a DISTINCT provisioned
// reviewer key, not a fabricable reviewer_id string. Forging a string is trivial;
// forging a signature against a key you do not hold is not. This is the legba/G5
// discipline the gate uses on its OWN receipt, turned inward on the council inputs,
// and it is what restores author/judge isolation: a work agent may WRITE any packet
// (the mailbox stays open) but cannot make one PASS without the reviewer keys.
//   DECLARED LIMIT (a deployment property the gatekeeper cannot enforce): this holds
//   ONLY while reviewer PRIVATE keys live outside the governed agent's filesystem
//   reach — held by the council runner / provisioned per room. If a deployment writes
//   reviewer private keys into the agent-readable run dir, forgery returns. The PUBLIC
//   keys in run_state.review_routing.reviewer_keys are safe to be readable.
let councilVoices = 0;
if (!ABORTING && rs.review_routing?.council === true) {
  const min = rs.review_routing.min_voices ?? 2;
  // min_voices must be a positive integer: a 0 / negative / NaN threshold would
  // let a MANDATED council "pass" with zero valid signatures (cross-model audit
  // 2026-06-24: codex HIGH). A council policy that sets no real threshold cannot
  // be honored — custody fails closed.
  if (!Number.isInteger(min) || min < 1)
    custodyRefuse(`gatekeeper: review_routing.min_voices must be a positive integer (got ${JSON.stringify(min)}) — a council with no real threshold cannot be honored; custody fails closed.`);
  const pems = rs.review_routing.reviewer_keys ?? [];
  // reviewer_keys must be PUBLIC keys. createPublicKey silently DERIVES a public
  // key from a private PEM, so a private key here would be accepted — but a
  // private signing secret in the (potentially agent-readable) run_state is a
  // forgery vector (codex HIGH). Guard on the PEM text before parsing.
  if (pems.some((p) => typeof p === 'string' && /PRIVATE KEY/.test(p)))
    custodyRefuse('gatekeeper: review_routing.reviewer_keys contains a PRIVATE key — reviewer keys must be PUBLIC; a private key in the run-state is a forgery vector, custody fails closed.');
  let keys;
  try { keys = pems.map(p => createPublicKey(p)); }
  catch { custodyRefuse('gatekeeper: review_routing.reviewer_keys holds an unparseable public key — custody fails closed, never waved through.'); }
  // Dedupe by KEY MATERIAL (SPKI fingerprint), not array position: a duplicate
  // PEM must not let ONE private key satisfy min_voices via two indices — the
  // distinctness loop below blocks re-use of the same INDEX, not the same KEY
  // (cross-model audit: cursor + codex HIGH, converged with a manual trace).
  {
    const seen = new Set();
    keys = keys.filter((k) => {
      const fp = createHash('sha256').update(k.export({ type: 'spki', format: 'der' })).digest('hex');
      if (seen.has(fp)) return false;
      seen.add(fp); return true;
    });
  }
  if (!keys.length)
    refuse('P204', `This surface mandates a council (min ${min} voices) but no reviewer public keys are provisioned (run_state.review_routing.reviewer_keys is empty). A council that cannot be verified cannot be honored — provision reviewer keys via the council runner.`);
  // C-REPLAY + freshness (audit): each reviewer signs the COUNCIL SUBJECT —
  // sha(jcs({gate_index, packet_hash, run_id})) where packet_hash = sha(jcs(packet
  // WITHOUT council_receipts)). Binding to the packet kills same-task replay; also
  // binding to run_id + gate_index kills cross-run / cross-gate replay of an
  // identical packet. A signature is valid for exactly one (packet, run, gate).
  // Count DISTINCT reviewer keys with a valid signature (a receipt binds to one key).
  const { council_receipts: _cr, ...packetCore } = packet;
  const packetHash = sha(jcs(packetCore));
  const councilSubject = sha(jcs({ gate_index: rs.gate_index ?? 0, packet_hash: packetHash, run_id: rs.run_id ?? null }));
  const councilPayload = Buffer.from(councilSubject);
  const verified = new Set();
  for (const r of (packet.council_receipts ?? [])) {
    if (!r || typeof r.signature !== 'string') continue;
    let sig; try { sig = Buffer.from(r.signature, 'base64'); } catch { continue; }
    for (let i = 0; i < keys.length; i++) {
      if (verified.has(i)) continue;
      let ok = false; try { ok = verify(null, councilPayload, keys[i], sig); } catch { ok = false; }
      if (ok) { verified.add(i); break; }
    }
  }
  councilVoices = verified.size;
  if (councilVoices < min)
    refuse('P204', `This surface mandates a council (min ${min} distinct voices); the packet carries ${councilVoices} VALID reviewer signature(s) over THIS packet's content hash. Fabricated strings and replayed signatures from other packets no longer pass — each council receipt must carry an Ed25519 signature over sha(jcs(packet without council_receipts)), from a DISTINCT provisioned reviewer key. The council runner holds those private keys; a self-reflecting work agent cannot sign for them. Silent downgrade is the one failure this gate exists to prevent.`);
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
  const chainPath = runDir + '/receipts.jsonl';
  let prev = null;
  if (existsSync(chainPath)) {
    const lines = readFileSync(chainPath, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) prev = JSON.parse(lines[lines.length - 1]).receipt_hash;
  }
  const receipt = {
    receipt_kind: ABORTING ? 'poteau_gate_abort' : 'poteau_gate_pass', poteau_version: '0.1.0',
    outcome: ABORTING ? 'aborted' : 'pass',
    run_id: rs.run_id, gate_index: rs.gate_index ?? 0,
    prev_receipt_hash: prev,
    task_ref: packet.task_ref ?? null,
    packet_hash: sha(jcs(packet)),
    checks: ABORTING ? { aborted: true } : { task_conformance: !!rs.task, grounding: (rs.mandated_reads ?? []).length, council: (rs.review_routing?.council === true ? councilVoices : false) },
    ts: new Date().toISOString(),
  };
  // IMP-011 freshness: the run-scoped chain already makes cross-run replay
  // structurally impossible; additionally refuse a receipt predating arming.
  if (rs.armed_at && receipt.ts < rs.armed_at) custodyRefuse('gatekeeper: receipt ts predates run armed_at (clock skew or replay) — refused (IMP-011).');
  // ── G5 signing custody (security: severity:critical fix — self-minted gate passes) ──────────
  // The gatekeeper's OWN signing key must obey the same rule it enforces on council keys (G4,
  // lines 98-102): a key inside the agent-readable run dir is FORGEABLE — a work agent reads it
  // and self-mints a valid poteau_gate_pass. So:
  //   1. If a signer socket is configured → sign via the legba signer daemon (key held
  //      in-memory, off the agent-readable disk). Compose legba's custody; don't duplicate it.
  //   2. Else if custody is REQUIRED (POTEAU_REQUIRE_CUSTODY=1) → REFUSE (fail closed). Never
  //      mint with an agent-readable on-disk key when enforcement is on.
  //   3. Else → the legacy on-disk-key path, but loudly warned as forgeable (dev only). Flip
  //      POTEAU_REQUIRE_CUSTODY once the signer daemon is wired (operator-gated, shadow→enforce).
  // `||` (not `??`) so an EMPTY-string LEGBA_SIGNER_SOCKET falls through to POTEAU_SIGNER_SOCKET —
  // matching the verifier (poteau-verify-receipts.mjs); `??` would keep "" and ignore the fallback,
  // so mint + verify could resolve different anchors on an empty env (BB #78 MEDIUM).
  const signerSocket = process.env.LEGBA_SIGNER_SOCKET || process.env.POTEAU_SIGNER_SOCKET;
  let signature;
  if (signerSocket) {
    const relay = new URL('../../scripts/legba/legba-signer-relay.mjs', import.meta.url).pathname;
    const gatekeeperId = process.env.POTEAU_GATEKEEPER_ID ?? 'poteau-gate';
    let out;
    try {
      out = JSON.parse(execFileSync(process.execPath, [relay, 'sign-gate'], {
        input: JSON.stringify({ token: receipt, gatekeeperId }),
        encoding: 'utf8', maxBuffer: 1024 * 1024,
        env: { ...process.env, LEGBA_SIGNER_SOCKET: signerSocket },
      }));
    } catch (e) {
      custodyRefuse('gatekeeper: signer-mediated mint failed (' + (e && e.message ? e.message : e) + ') — custody fails closed, never waved through.');
    }
    if (!out || out.ok === false || typeof out.signature !== 'string')
      custodyRefuse('gatekeeper: signer daemon refused or returned no signature (' + JSON.stringify(out) + ') — custody fails closed.');
    signature = out.signature;
  } else if (process.env.POTEAU_REQUIRE_CUSTODY === '1') {
    custodyRefuse('gatekeeper: armed mint requires signer custody (set LEGBA_SIGNER_SOCKET / POTEAU_SIGNER_SOCKET) — refusing to sign with an agent-readable on-disk key. A work agent that can read .run/poteau/gate.key self-mints a valid poteau_gate_pass (forgeable gate, severity:critical). Run the legba signer daemon, or unset POTEAU_REQUIRE_CUSTODY for dev (forgeable).');
  } else {
    process.stderr.write('poteau-gatekeeper: WARNING — signing with an agent-readable on-disk key (.run/poteau/gate.key). This is FORGEABLE (a work agent can self-mint). Wire the legba signer daemon + set POTEAU_REQUIRE_CUSTODY=1 for production.\n');
    const keyPath = process.env.POTEAU_KEY ?? '.run/poteau/gate.key';
    let priv;
    if (existsSync(keyPath)) priv = createPrivateKey(readFileSync(keyPath));
    else {
      const kp = generateKeyPairSync('ed25519');
      mkdirSync(dirname(keyPath), { recursive: true });
      writeFileSync(keyPath, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      writeFileSync(keyPath + '.pub', kp.publicKey.export({ type: 'spki', format: 'pem' }));
      priv = kp.privateKey;
    }
    signature = sign(null, Buffer.from(jcs(receipt)), priv).toString('base64');
  }
  const sealed = { receipt, signature, receipt_hash: sha(jcs(receipt)) };
  writeFileSync(chainPath, (existsSync(chainPath) ? readFileSync(chainPath, 'utf8') : '') + JSON.stringify(sealed) + '\n');
  process.stdout.write(JSON.stringify({ pass: !ABORTING, aborted: ABORTING, receipt_hash: sealed.receipt_hash, gate_index: receipt.gate_index }) + '\n');
} catch (e) {
  custodyRefuse('gatekeeper: receipt mint failed (' + (e && e.message ? e.message : e) + ') — custody fails closed, never waved through.');
}
