#!/usr/bin/env node
/**
 * compose-bridge.mjs — derive a Legba custody chain over a Form C composition
 * run's handoff envelopes, closing the inter-envelope hash-chain hole that
 * compose-verify-run.sh:41-49 explicitly reserves ("When the v0 chained envelope
 * format lands here, extend check 4 with audit_verify_chain").
 *
 * Each handoff envelope is an AGENT emission (a model-produced handoff), so it is
 * recorded as an `attestable` Legba move (provably said, in order — never claimed
 * replayable). One envelope → one span → one signed gate token; the tokens chain
 * (prev_token_hash), and the turnstile enforces envelope ordering. The result is
 * a per-envelope custody chain a third party verifies with the gatekeeper's
 * public key alone — exactly the guarantee the set-membership check could not give
 * (the playtest's finding: "presence + set-membership, not authorship or
 * integrity-over-time").
 *
 *   compose-bridge.mjs build  <compose-run-dir>   build the chain; print receipt
 *   compose-bridge.mjs verify <compose-run-dir>   build (if absent) + verify; exit 0/1
 *
 * The Legba run lives at <compose-run-dir>/legba/ so it travels with the run and
 * verifies self-contained.
 */
import {
  loadOrInitKeys, provisionRun, record, gate, openSpan, verifyRun, readSpanLog, jcs,
} from './legba-core.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const shaBare = (o) => createHash('sha256').update(jcs(o), 'utf8').digest('hex');
const shaStr = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const attestedContent = (envBody) => envBody.verdict ?? envBody;

function envelopes(runDir) {
  const dir = join(runDir, 'envelopes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.handoff.json'))
    .map((f) => ({ file: f, body: JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
    .sort((a, b) => (a.body.stage_index ?? 0) - (b.body.stage_index ?? 0)
      || a.file.localeCompare(b.file));
}

/**
 * Deterministic content receipt over the run's envelopes (LR-4). Unlike the gate
 * tokens (which carry a wall-clock ts and so differ per build), this is a pure
 * function of the ordered envelope CONTENT — the honest build and an honest
 * re-derivation produce the same value; a tampered re-derivation does not. This
 * is the value we anchor OUTSIDE legba/ so a wholesale legba/ rebuild over
 * tampered envelopes is caught.
 */
function contentReceipt(composeRunDir) {
  const envs = envelopes(composeRunDir);
  const leaves = envs.map((e) => shaBare(attestedContent(e.body)));
  return 'sha256:' + shaStr(jcs(leaves));
}

const ORCH = (d) => join(d, 'orchestrator.jsonl');

/** Read the EARLIEST legba.anchor for this run from the orchestrator trail (the
 *  honest build-time anchor; a later appended anchor cannot displace it). */
function readAnchor(composeRunDir, runId) {
  const p = ORCH(composeRunDir);
  if (!existsSync(p)) return null;
  for (const line of readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event === 'legba.anchor' && ev.run_id === runId && ev.payload?.content_receipt) {
      return ev.payload.content_receipt;
    }
  }
  return null;
}

/** Anchor the content_receipt where a legba/ rebuild can't reach: the orchestrator
 *  trail (append-only, dispatcher-owned — a different writer than legba/), and
 *  BEST-EFFORT into the loa audit chain (hash-chained + signed) if reachable. */
function writeAnchor(composeRunDir, runId, receipt) {
  if (readAnchor(composeRunDir, runId)) return { anchored: true, where: 'orchestrator(existing)' };
  const ev = { event: 'legba.anchor', ts: new Date().toISOString(), run_id: runId, payload: { content_receipt: receipt } };
  if (existsSync(ORCH(composeRunDir))) appendFileSync(ORCH(composeRunDir), JSON.stringify(ev) + '\n');
  // best-effort hardened anchor: the loa audit chain (if the helper is reachable)
  let hardened = false;
  const auditSh = process.env.LOA_AUDIT_ENVELOPE_SH;
  if (auditSh && existsSync(auditSh)) {
    try {
      execFileSync('bash', ['-c',
        `source "${auditSh}" && audit_emit LEGBA legba.anchor '${JSON.stringify({ run_id: runId, content_receipt: receipt })}' "$PWD/.run/legba-anchors.jsonl"`,
      ], { stdio: 'ignore' });
      hardened = true;
    } catch { /* best-effort — orchestrator anchor stands */ }
  }
  return { anchored: existsSync(ORCH(composeRunDir)), where: 'orchestrator' + (hardened ? '+audit-chain' : '') };
}

function build(composeRunDir) {
  const manifestPath = join(composeRunDir, 'form-c-manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`no form-c-manifest.json under ${composeRunDir}`);
  const runId = JSON.parse(readFileSync(manifestPath, 'utf8')).composition_run_id
    || JSON.parse(readFileSync(manifestPath, 'utf8')).run_id
    || 'compose-run';
  const envs = envelopes(composeRunDir);
  if (!envs.length) throw new Error('no executed handoff envelopes — nothing to chain (compiled-only run)');

  const legbaDir = join(composeRunDir, 'legba');
  if (existsSync(legbaDir)) rmSync(legbaDir, { recursive: true, force: true });
  const gk = loadOrInitKeys(`legba:compose:${runId}`);
  provisionRun(runId, gk, legbaDir);

  envs.forEach((env, i) => {
    if (i > 0) openSpan(legbaDir, { runId, spanIndex: i }); // turnstile: requires token i-1
    record(legbaDir, {
      runId, spanIndex: i, kind: 'emission', determinism: 'attestable',
      label: `${env.body.construct_slug || 'segment'}:${env.body.stage_index ?? i}`,
      content: attestedContent(env.body), // the envelope's construct payload is the attested content
    });
    gate(legbaDir, { runId, gateIndex: i, artifacts: [{ envelope: env.file }] });
  });
  const receipt = contentReceipt(composeRunDir);
  const anchor = writeAnchor(composeRunDir, runId, receipt);
  return { legbaDir, runId, envelope_count: envs.length, content_receipt: receipt, anchor };
}

/**
 * Bind the live envelopes to the recorded chain: each envelope's CURRENT attested
 * content must hash to what its span move recorded. This is what makes an
 * envelope edit AFTER gating detectable — the chain recorded the content hash, so
 * a changed envelope no longer matches. (verifyRun proves the chain is internally
 * consistent + signed; THIS proves it still describes the live run.)
 */
function checkBinding(composeRunDir, legbaDir) {
  const envs = envelopes(composeRunDir);
  const mismatches = [];
  envs.forEach((env, i) => {
    const log = readSpanLog(legbaDir, i);
    const recorded = log[0]?.output_hash;
    const current = shaBare(attestedContent(env.body));
    if (recorded !== current) mismatches.push({ envelope: env.file, recorded, current });
  });
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Anchor check (LR-4): recompute the deterministic content_receipt from the LIVE
 * envelopes and compare it to the anchor recorded at build time (the orchestrator
 * trail, outside legba/) and/or an externally-held value (--expect). This is what
 * a wholesale legba/ rebuild over tampered envelopes CANNOT defeat: the rebuilt
 * chain matches the tampered envelopes (binding passes), but the recomputed
 * content_receipt no longer matches the anchor the honest build left behind.
 *
 * states: anchored_match (good) · anchored_mismatch (TAMPERED) · unanchored (no
 * anchor present — falls back to chain+binding only, cannot detect a rebuild).
 */
function checkAnchor(composeRunDir, runId, expect) {
  const current = contentReceipt(composeRunDir);
  const orchAnchor = readAnchor(composeRunDir, runId);
  const anchor = expect || orchAnchor;
  if (!anchor) return { state: 'unanchored', ok: true, current, source: expect ? 'expect' : 'orchestrator' };
  const match = anchor === current;
  return { state: match ? 'anchored_match' : 'anchored_mismatch', ok: match, current, anchored: anchor, source: expect ? 'expect' : 'orchestrator' };
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const composeRunDir = argv.find((a, i) => i > 0 && !a.startsWith('--'));
const expectIdx = argv.indexOf('--expect');
const expect = expectIdx >= 0 ? argv[expectIdx + 1] : null;
if (!cmd || !composeRunDir) {
  console.error('usage: compose-bridge.mjs <build|verify> <compose-run-dir> [--expect <content_receipt>]');
  process.exit(2);
}
try {
  if (cmd === 'build') {
    const { legbaDir, runId, envelope_count, content_receipt, anchor } = build(composeRunDir);
    const report = verifyRun(legbaDir);
    console.log(JSON.stringify({ ok: report.ok, run_id: runId, envelope_count, legba_dir: legbaDir, run_receipt_hash: report.run_receipt_hash, content_receipt, anchor }, null, 2));
    process.exit(report.ok ? 0 : 1);
  } else if (cmd === 'verify') {
    const legbaDir = join(composeRunDir, 'legba');
    const runId = JSON.parse(readFileSync(join(composeRunDir, 'form-c-manifest.json'), 'utf8')).composition_run_id
      || JSON.parse(readFileSync(join(composeRunDir, 'form-c-manifest.json'), 'utf8')).run_id || 'compose-run';
    if (!existsSync(join(legbaDir, 'manifest.json'))) build(composeRunDir);
    const chain = verifyRun(legbaDir);                       // chain internally consistent + signed
    const binding = checkBinding(composeRunDir, legbaDir);    // chain still describes live envelopes
    const anchor = checkAnchor(composeRunDir, runId, expect); // recomputed receipt vs external anchor
    const ok = chain.ok && binding.ok && anchor.ok;
    console.log(JSON.stringify({ ...chain, ok, binding, anchor }, null, 2));
    process.exit(ok ? 0 : 1);
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`compose-bridge: ${e.message}`);
  process.exit(1);
}
