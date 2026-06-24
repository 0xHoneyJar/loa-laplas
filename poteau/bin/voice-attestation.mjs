#!/usr/bin/env node
/**
 * voice-attestation.mjs — poteau G4.5: the proof-of-call instrument.
 *
 * G4 (council honor) proves a reviewer KEY signed. This proves the claimed
 * MODEL-VOICE was actually DISPATCHED to a real provider — cross-checked
 * against the MODELINV audit chain (.run/model-invoke.jsonl, written
 * independently by the cheval substrate on every model invocation). It is the
 * deterministic answer to "did the agent actually call what it says it called?"
 *
 * A review that CLAIMS a cross-model council (claude + codex + cursor) but only
 * single-voiced claude is the failure mode this catches — fail-closed.
 *
 * BIPARTITE FRAMING (honeycomb / EULER): claimed voices are left nodes,
 * MODELINV dispatch events are right nodes; an edge exists when an event's
 * models_succeeded covers the claimed voice (and transport=cli under
 * --require-cli). The verdict is ATTESTED iff every left node is covered — a
 * full left-coverage / left-perfect matching. A missing left node is an
 * unproven claim: a lie the verdict must not be allowed to carry.
 *
 * stdin/args:  --claim a,b,c | --envelope <verdict_quality.json>
 *              --invoke <path>           (default .run/model-invoke.jsonl)
 *              --require-cli             (only transport=cli counts as proof)
 *              --require-families <N>    (proven voices must span >= N families)
 *              --primitive <name>        (only count dispatches from this primitive)
 * stdout:      verdict JSON
 * exit:        0 ATTESTED · 2 UNATTESTED (refusal teaches) · 5 internal (fail-closed)
 *
 * Zero-dep, node: builtins only.
 */
import { readFileSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Pure core (exported for the test suite)
// ---------------------------------------------------------------------------

/**
 * Scope the MODELINV chain to THIS review's window. Attesting against the whole
 * historical chain is meaningless — any past codex/cursor call anywhere would
 * satisfy a council claim. A real attestation scopes to the dispatches that
 * belong to the review under judgment.
 *
 * @param {object[]} entries  MODELINV records (top-level ts_utc + payload)
 * @param {object} o
 * @param {number} [o.last]   keep only the last N entries (the review's own tail)
 * @param {string} [o.since]  keep only entries with ts_utc >= this ISO-8601 UTC
 *                            timestamp (lexical compare is valid for UTC Zulu).
 */
export function scopeEntries(entries, { last = 0, since = null } = {}) {
  let out = entries;
  if (since) out = out.filter((e) => typeof e?.ts_utc === 'string' && e.ts_utc >= since);
  if (last > 0) out = out.slice(-last);
  return out;
}

/** Map a model id (provider:model OR a bare slug) to its provider family. */
export function familyOf(modelId) {
  if (!modelId || typeof modelId !== 'string') return 'unknown';
  const id = modelId.toLowerCase();
  if (id.includes(':')) {
    const provider = id.slice(0, id.indexOf(':'));
    // bedrock serves Anthropic models; normalize to the model family.
    if (provider === 'bedrock') return 'anthropic';
    if (provider === 'vertex') return 'google';
    return provider;
  }
  // Bare slug — infer family from the well-known model namespaces.
  if (id.startsWith('claude')) return 'anthropic';
  if (id.startsWith('gpt') || id.startsWith('codex') || id.startsWith('o1') || id.startsWith('o3')) return 'openai';
  if (id.startsWith('gemini')) return 'google';
  if (id.startsWith('cursor')) return 'cursor';
  if (id.startsWith('grok')) return 'xai';
  return 'unknown';
}

/** The model slug (the part a human names): drop the provider prefix. */
function slug(modelId) {
  const id = String(modelId).toLowerCase();
  return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}

/** Does a claimed voice match a succeeded model id? Exact, or by model slug. */
function voiceMatches(claimed, succeeded) {
  const c = String(claimed).toLowerCase();
  const s = String(succeeded).toLowerCase();
  return c === s || slug(c) === slug(s);
}

/**
 * Attest claimed voices against MODELINV dispatch events.
 *
 * @param {object} o
 * @param {string[]} o.claimed         voices the review CLAIMS it consulted
 * @param {object[]} o.entries         MODELINV records ({payload:{...}} or {...})
 * @param {boolean} [o.requireCli]     only transport=cli dispatches prove a call
 * @param {number}  [o.requireFamilies] proven voices must span >= N families
 * @param {string}  [o.callingPrimitive] only count dispatches from this primitive
 * @returns {{verdict, proven, missing, extra, familiesProven, reasons}}
 */
export function attestVoices({ claimed = [], entries = [], requireCli = false,
                               requireFamilies = 0, callingPrimitive = null } = {}) {
  // Right side of the bipartite graph: the set of successfully-dispatched
  // models that count as proof under the current evidence rules.
  const proofs = []; // {model, family, transport}
  for (const e of entries) {
    const p = (e && e.payload) ? e.payload : (e || {});
    if (callingPrimitive && p.calling_primitive !== callingPrimitive) continue;
    if (requireCli && p.transport !== 'cli') continue;
    for (const m of (p.models_succeeded || [])) {
      proofs.push({ model: m, family: familyOf(m), transport: p.transport });
    }
  }

  // Left-coverage: every claimed voice needs >= 1 edge to a proof.
  const proven = [];
  const missing = [];
  const provenFamilies = new Set();
  for (const voice of claimed) {
    const hit = proofs.find((pr) => voiceMatches(voice, pr.model));
    if (hit) {
      proven.push(voice);
      provenFamilies.add(hit.family);
    } else {
      missing.push(voice);
    }
  }

  // Informational: dispatched-but-not-claimed (the council ran a voice the
  // packet never declared — surfaced, not failed).
  const claimedSlugs = new Set(claimed.map(slug));
  const extra = [...new Set(
    proofs.map((pr) => pr.model).filter((m) => !claimedSlugs.has(slug(m))),
  )];

  const familiesProven = [...provenFamilies];
  const reasons = [];
  if (missing.length) {
    reasons.push(`unproven claimed voice(s): ${missing.join(', ')} — no matching dispatch in the MODELINV chain${requireCli ? ' (transport=cli required)' : ''}`);
  }
  if (requireFamilies && familiesProven.length < requireFamilies) {
    reasons.push(`single-family masquerade: proven voices span ${familiesProven.length} provider famil${familiesProven.length === 1 ? 'y' : 'ies'} (${familiesProven.join(', ') || 'none'}), a genuine cross-model council needs >= ${requireFamilies}`);
  }

  const verdict = reasons.length === 0 ? 'ATTESTED' : 'UNATTESTED';
  return { verdict, proven, missing, extra, familiesProven, reasons };
}

// ---------------------------------------------------------------------------
// CLI wrapper — fail-closed (a parsing/IO fault REFUSES, never waves through).
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { invoke: '.run/model-invoke.jsonl', claim: null, envelope: null,
              requireCli: false, requireFamilies: 0, primitive: null,
              last: 0, since: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--invoke') a.invoke = argv[++i];
    else if (k === '--claim') a.claim = argv[++i];
    else if (k === '--envelope') a.envelope = argv[++i];
    else if (k === '--require-cli') a.requireCli = true;
    else if (k === '--require-families') a.requireFamilies = parseInt(argv[++i], 10) || 0;
    else if (k === '--primitive') a.primitive = argv[++i];
    else if (k === '--last') a.last = parseInt(argv[++i], 10) || 0;
    else if (k === '--since') a.since = argv[++i];
  }
  return a;
}

function readEntries(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function failClosed(msg) {
  process.stdout.write(JSON.stringify({ verdict: 'UNATTESTED', code: 'P500', reasons: [msg] }) + '\n');
  process.exit(5);
}

function main() {
  const a = parseArgs(process.argv.slice(2));

  let claimed = [];
  if (a.claim) {
    claimed = a.claim.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (a.envelope) {
    try {
      const env = JSON.parse(readFileSync(a.envelope, 'utf8'));
      // a verdict_quality envelope declares the voices it claims succeeded.
      claimed = env.voices_succeeded_ids || env.claimed_voices || [];
    } catch (e) {
      failClosed(`cannot read claim envelope ${a.envelope}: ${e.message}`);
    }
  } else {
    failClosed('no claim supplied — pass --claim a,b,c or --envelope <verdict_quality.json>. The instrument cannot attest a claim it was never given.');
  }

  let entries;
  try { entries = readEntries(a.invoke); }
  catch (e) { return failClosed(`cannot read MODELINV chain ${a.invoke}: ${e.message}`); }

  // Scope to the review's window — attesting against all history is meaningless.
  entries = scopeEntries(entries, { last: a.last, since: a.since });

  const result = attestVoices({
    claimed, entries,
    requireCli: a.requireCli,
    requireFamilies: a.requireFamilies,
    callingPrimitive: a.primitive,
  });

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  // poteau convention: 0 pass · 2 refuse (the refusal teaches via `reasons`).
  process.exit(result.verdict === 'ATTESTED' ? 0 : 2);
}

// Only run main() when invoked directly, not when imported by the test suite.
if (import.meta.url === `file://${process.argv[1]}`) main();
