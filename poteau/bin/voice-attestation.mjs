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
 * --require-cli). The verdict is ATTESTED iff every left node is matched to a
 * DISTINCT proof (a left-perfect matching, not mere coverage — one dispatch
 * cannot prove two voices). A missing left node is an unproven claim: a lie.
 *
 * HARDENED after a cross-model adversarial review (codex + cursor, 2026-06-24)
 * converged on three HIGH holes — all closed here:
 *   - unscoped-by-default (a stale dispatch attested a current single-voice):
 *     a scope is now REQUIRED (--last/--since) unless --all-history is explicit.
 *   - empty/malformed claim → vacuous ATTESTED: an empty resolved roster now
 *     fail-closes (a review claiming no voices is not a passing council).
 *   - provider-blind slug match: a provider-qualified claim now requires the
 *     provider to match (a bare slug still matches across providers, by design).
 * Plus: 1:1 proof consumption, corrupt-line-in-window fail-close, Date-based
 * timestamp compare, and a top-level try/catch that fails closed (never throws
 * past the gate). KNOWN LIMIT: this trusts the MODELINV chain's integrity
 * (hash-chain / signatures) — verifying that is legba/audit-envelope's job;
 * tracked separately. See poteau/voice-attestation.md.
 *
 * stdin/args:  --claim a,b,c | --envelope <verdict_quality.json>
 *              --invoke <path>           (default .run/model-invoke.jsonl)
 *              --last N | --since <ts> | --all-history   (scope — REQUIRED)
 *              --require-cli             (only transport=cli counts as proof)
 *              --require-families <N>    (proven voices must span >= N families)
 *              --primitive <name>        (only count dispatches from this primitive)
 * stdout:      verdict JSON
 * exit:        0 ATTESTED · 2 UNATTESTED (refusal teaches) · 5 fail-closed
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
 * belong to the review under judgment. Malformed lines are kept positionally
 * (as null) so a corrupt CURRENT line cannot be silently dropped and let an
 * OLDER line slip into the --last window (the codex review's finding).
 *
 * @param {(object|null)[]} entries  MODELINV records (null marks a corrupt line)
 * @param {object} o
 * @param {number} [o.last]   keep only the last N entries (the review's own tail)
 * @param {string} [o.since]  keep only entries with ts_utc >= this timestamp
 */
export function scopeEntries(entries, { last = 0, since = null } = {}) {
  let out = entries;
  if (since) {
    const floor = Date.parse(since);
    // Date-based compare (not lexical): mixed fractional precision like
    // "…00Z" vs "…00.001Z" sorts wrong lexically. A null (corrupt) line has no
    // ts; keep it so the window-integrity check below can still see it.
    out = out.filter((e) => e === null || (typeof e?.ts_utc === 'string' && Date.parse(e.ts_utc) >= floor));
  }
  if (last > 0) out = out.slice(-last);
  return out;
}

/** Map a model id (provider:model OR a bare slug) to its provider family. */
export function familyOf(modelId) {
  if (!modelId || typeof modelId !== 'string') return 'unknown';
  const id = modelId.toLowerCase();
  if (id.includes(':')) {
    const provider = id.slice(0, id.indexOf(':'));
    if (provider === 'bedrock') return 'anthropic';   // bedrock serves Anthropic
    if (provider === 'vertex') return 'google';
    return provider;
  }
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

/**
 * Does a claimed voice match a succeeded model id?
 *   - exact (case-insensitive) always matches;
 *   - a PROVIDER-QUALIFIED claim ("openai:codex-headless") requires the provider
 *     to match too — a bare slug match across providers is unsound
 *     (fake:codex-headless must NOT prove openai:codex-headless);
 *   - a BARE slug claim ("codex-headless") matches by model slug across
 *     providers, by design (the human named a model, not a provider).
 */
function voiceMatches(claimed, succeeded) {
  const c = String(claimed).toLowerCase();
  const s = String(succeeded).toLowerCase();
  if (c === s) return true;
  if (c.includes(':')) {
    // qualified claim: provider must match AND slug must match.
    return familyOf(c) === familyOf(s) && slug(c) === slug(s);
  }
  return slug(c) === slug(s); // bare slug: cross-provider by model name
}

/**
 * Attest claimed voices against MODELINV dispatch events. A left-perfect
 * matching: each claimed voice is matched to a DISTINCT proof (one dispatch
 * cannot prove two voices — the cursor review's finding).
 *
 * @returns {{verdict, proven, missing, extra, familiesProven, reasons}}
 */
export function attestVoices({ claimed = [], entries = [], requireCli = false,
                               requireFamilies = 0, callingPrimitive = null } = {}) {
  // Right side: successfully-dispatched models that count as proof. Each proof
  // is consumable exactly once (1:1 matching).
  const proofs = []; // {model, family, used}
  for (const e of entries) {
    const p = (e && typeof e === 'object' && e.payload) ? e.payload : null;
    if (!p) continue; // skip null (corrupt) / shapeless entries
    if (callingPrimitive && p.calling_primitive !== callingPrimitive) continue;
    if (requireCli && p.transport !== 'cli') continue;
    for (const m of (p.models_succeeded || [])) {
      proofs.push({ model: m, family: familyOf(m), used: false });
    }
  }

  const proven = [];
  const missing = [];
  const provenFamilies = new Set();
  for (const voice of claimed) {
    const hit = proofs.find((pr) => !pr.used && voiceMatches(voice, pr.model));
    if (hit) {
      hit.used = true;            // consume the proof — no double-counting
      proven.push(voice);
      provenFamilies.add(hit.family);
    } else {
      missing.push(voice);
    }
  }

  const claimedSlugs = new Set(claimed.map(slug));
  const extra = [...new Set(
    proofs.map((pr) => pr.model).filter((m) => !claimedSlugs.has(slug(m))),
  )];

  const familiesProven = [...provenFamilies];
  const reasons = [];
  if (claimed.length === 0) {
    reasons.push('no voices claimed — a review that claims no voices is not a passing council');
  }
  if (missing.length) {
    reasons.push(`unproven claimed voice(s): ${missing.join(', ')} — no matching distinct dispatch in the MODELINV window${requireCli ? ' (transport=cli required)' : ''}`);
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
              last: 0, since: null, allHistory: false };
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
    else if (k === '--all-history') a.allHistory = true;
  }
  return a;
}

/** Read MODELINV as a POSITIONAL array; a corrupt line becomes null (kept in
 *  place) so --last cannot silently skip a tampered current line. */
function readRawEntries(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } });
}

function failClosed(msg) {
  process.stdout.write(JSON.stringify({ verdict: 'UNATTESTED', code: 'P500', reasons: [msg] }) + '\n');
  process.exit(5);
}

function main() {
  let a;
  try {
    a = parseArgs(process.argv.slice(2));

    // Resolve the claim.
    let claimed;
    if (a.claim != null) {
      claimed = a.claim.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.envelope) {
      const env = JSON.parse(readFileSync(a.envelope, 'utf8'));
      const roster = env.voices_succeeded_ids ?? env.claimed_voices;
      if (roster != null && !Array.isArray(roster)) {
        return failClosed(`envelope voice roster is not an array: ${typeof roster}`);
      }
      claimed = Array.isArray(roster) ? roster.map(String) : [];
    } else {
      return failClosed('no claim supplied — pass --claim a,b,c or --envelope <verdict_quality.json>. The instrument cannot attest a claim it was never given.');
    }

    // An empty roster is not a passing council — fail closed (converged HIGH).
    if (claimed.length === 0) {
      return failClosed('resolved claim is EMPTY — a review that claims no voices is not a passing council; refuse.');
    }

    // A scope is REQUIRED (converged HIGH): the whole history is meaningless.
    if (a.last === 0 && !a.since && !a.allHistory) {
      return failClosed('no scope — pass --last N or --since <ts> to scope to THIS review (attesting against the whole MODELINV history lets a stale dispatch prove a current council). Pass --all-history to override deliberately.');
    }

    if (!existsSync(a.invoke)) {
      return failClosed(`MODELINV chain not found: ${a.invoke} — cannot evaluate the claim, so refuse.`);
    }

    const raw = readRawEntries(a.invoke);
    const scoped = scopeEntries(raw, { last: a.last, since: a.since });

    // A corrupt line WITHIN the attestation window is tampering/loss of evidence
    // — fail closed rather than attest on a partial window (converged MED).
    if (scoped.some((e) => e === null)) {
      return failClosed('corrupt MODELINV line within the attestation window — evidence may be tampered or truncated; refuse.');
    }

    const result = attestVoices({
      claimed, entries: scoped,
      requireCli: a.requireCli,
      requireFamilies: a.requireFamilies,
      callingPrimitive: a.primitive,
    });
    if (a.allHistory) {
      result.scope_warning = 'UNSCOPED (--all-history) — attested against the full MODELINV chain; a stale dispatch can prove a current claim.';
    }

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.verdict === 'ATTESTED' ? 0 : 2);
  } catch (e) {
    // Any unexpected fault refuses — the gate never throws past itself.
    return failClosed(`internal fault (${e && e.message ? e.message : e}) — fail closed.`);
  }
}

// Only run main() when invoked directly, not when imported by the test suite.
const _invoked = process.argv[1] || '';
if (import.meta.url === `file://${_invoked}` || import.meta.url.endsWith(_invoked)) main();
