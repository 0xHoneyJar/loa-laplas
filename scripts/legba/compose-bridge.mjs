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
  initKeys, provisionRun, record, gate, openSpan, verifyRun, readSpanLog, jcs,
} from './legba-core.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const shaBare = (o) => createHash('sha256').update(jcs(o), 'utf8').digest('hex');
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
  const gk = initKeys(`legba:compose:${runId}`);
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
  return { legbaDir, runId, envelope_count: envs.length };
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

const [cmd, composeRunDir] = process.argv.slice(2);
if (!cmd || !composeRunDir) {
  console.error('usage: compose-bridge.mjs <build|verify> <compose-run-dir>');
  process.exit(2);
}
try {
  if (cmd === 'build') {
    const { legbaDir, runId, envelope_count } = build(composeRunDir);
    const report = verifyRun(legbaDir);
    console.log(JSON.stringify({ ok: report.ok, run_id: runId, envelope_count, legba_dir: legbaDir, run_receipt_hash: report.run_receipt_hash }, null, 2));
    process.exit(report.ok ? 0 : 1);
  } else if (cmd === 'verify') {
    const legbaDir = join(composeRunDir, 'legba');
    if (!existsSync(join(legbaDir, 'manifest.json'))) build(composeRunDir);
    const chain = verifyRun(legbaDir);          // chain internally consistent + signed
    const binding = checkBinding(composeRunDir, legbaDir); // chain still describes live envelopes
    const ok = chain.ok && binding.ok;
    console.log(JSON.stringify({ ...chain, ok, binding }, null, 2));
    process.exit(ok ? 0 : 1);
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`compose-bridge: ${e.message}`);
  process.exit(1);
}
