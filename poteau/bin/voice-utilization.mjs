#!/usr/bin/env node
/**
 * voice-utilization.mjs — the SENSE sibling of voice-attestation (poteau G4.5).
 *
 * voice-attestation ENFORCES: did THIS review dispatch the voices it claims?
 * voice-utilization SENSES: across the MODELINV chain, are the paid
 * subscriptions actually being used — or is everything single-family claude?
 * It turns the operator's intuition ("we don't use codex/gemini/cursor as much
 * as we should") into numbers, so the under-utilization is visible and the
 * climb is watchable as routing is fixed.
 *
 * The killer metric is the TRANSPORT split: transport=cli means a real
 * subscription CLI (codex/cursor/claude-headless) was used; transport=http
 * means an API key. A family that is 90% http is barely touching its
 * subscription.
 *
 * args:   --invoke <path>   (default .run/model-invoke.jsonl)
 *         --last N | --since <ts>   (scope; default = whole chain)
 *         --floor <pct>     (under-utilization threshold, default 5)
 *         --json            (machine-readable)
 * exit:   0 always (a sensor surfaces; it does not gate — voice-attestation gates).
 *
 * Zero-dep. Reuses familyOf/scopeEntries from voice-attestation (one parser).
 */
import { readFileSync, existsSync } from 'node:fs';
import { familyOf, scopeEntries } from './voice-attestation.mjs';

/**
 * @param {(object|null)[]} entries  MODELINV records
 * @param {{floorPct?:number}} [o]
 * @returns summary { totalDispatches, byFamily, byTransport, byPrimitive,
 *                    topFamily, topFamilySharePct, underutilized }
 */
export function summarizeUtilization(entries, { floorPct = 5 } = {}) {
  const byFamily = {};     // fam -> { count, cli, http }
  const byTransport = {};  // transport -> count
  const byPrimitive = {};  // calling_primitive -> count
  const failByFamily = {}; // fam -> failure count (from models_failed)
  let totalDispatches = 0;

  for (const e of entries) {
    const p = (e && typeof e === 'object' && e.payload) ? e.payload : null;
    if (!p) continue;
    const transport = p.transport || 'unknown';
    const primitive = p.calling_primitive || 'unknown';
    for (const m of (p.models_succeeded || [])) {
      const fam = familyOf(m);
      const f = byFamily[fam] || (byFamily[fam] = { count: 0, cli: 0, http: 0 });
      f.count += 1;
      if (transport === 'cli') f.cli += 1;
      else if (transport === 'http') f.http += 1;
      byTransport[transport] = (byTransport[transport] || 0) + 1;
      byPrimitive[primitive] = (byPrimitive[primitive] || 0) + 1;
      totalDispatches += 1;
    }
    // Failures (models_failed[] = {model, ...}) — for dead-voice detection.
    for (const fe of (p.models_failed || [])) {
      const id = fe && typeof fe === 'object' ? fe.model : fe;
      const fam = familyOf(id);
      failByFamily[fam] = (failByFamily[fam] || 0) + 1;
    }
  }

  // Shares + under-utilization.
  let topFamily = null, topCount = -1;
  const underutilized = [];
  for (const [fam, f] of Object.entries(byFamily)) {
    const pct = totalDispatches ? (f.count / totalDispatches) * 100 : 0;
    f.sharePct = Math.round(pct * 10) / 10;
    if (f.count > topCount) { topCount = f.count; topFamily = fam; }
    if (pct < floorPct) underutilized.push(fam);
  }
  const topFamilySharePct = totalDispatches
    ? Math.round((topCount / totalDispatches) * 100) : 0;

  // Voice health: a family is DEAD if it has failures and ~never succeeds
  // (gemini-shaped — IneligibleTierError every time); DEGRADED if it fails a
  // lot but sometimes succeeds; HEALTHY otherwise. Auto-surfaces a broken voice
  // from the data rather than hardcoding which one is dead.
  const health = [];
  const deadVoices = [];
  const fams = new Set([...Object.keys(byFamily), ...Object.keys(failByFamily)]);
  for (const fam of fams) {
    const succeeded = byFamily[fam]?.count || 0;
    const failed = failByFamily[fam] || 0;
    let status = 'HEALTHY';
    if (failed > 0 && succeeded === 0) { status = 'DEAD'; deadVoices.push(fam); }
    else if (failed > 0 && failed >= succeeded) status = 'DEGRADED';
    health.push({ family: fam, succeeded, failed, status });
  }
  health.sort((a, b) => b.failed - a.failed);

  return {
    totalDispatches, byFamily, byTransport, byPrimitive,
    topFamily, topFamilySharePct, underutilized, health, deadVoices,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { invoke: '.run/model-invoke.jsonl', last: 0, since: null, floor: 5, json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--invoke') a.invoke = argv[++i];
    else if (k === '--last') a.last = parseInt(argv[++i], 10) || 0;
    else if (k === '--since') a.since = argv[++i];
    else if (k === '--floor') a.floor = parseFloat(argv[++i]) || 5;
    else if (k === '--json') a.json = true;
  }
  return a;
}

function bar(pct, width = 24) {
  const n = Math.round((pct / 100) * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}

function render(s, floor) {
  const L = [];
  L.push(`MODELINV utilization · ${s.totalDispatches} dispatches`);
  L.push('─'.repeat(54));
  if (s.totalDispatches === 0) return L.concat('(no dispatches in scope)').join('\n');
  L.push('by provider family (share · subscription[cli]/api[http]):');
  const fams = Object.entries(s.byFamily).sort((a, b) => b[1].count - a[1].count);
  for (const [fam, f] of fams) {
    const flag = s.underutilized.includes(fam) ? '  ⚠ under-utilized' : '';
    L.push(`  ${fam.padEnd(10)} ${String(f.sharePct).padStart(5)}%  ${bar(f.sharePct)}  cli:${f.cli} http:${f.http}${flag}`);
  }
  const cli = s.byTransport.cli || 0, http = s.byTransport.http || 0;
  const cliPct = s.totalDispatches ? Math.round((cli / s.totalDispatches) * 100) : 0;
  L.push('');
  L.push(`transport: ${cliPct}% cli (subscription) · ${100 - cliPct}% http (API)  [cli=${cli} http=${http}]`);
  L.push(`top family: ${s.topFamily} (${s.topFamilySharePct}% — single-family dominance)`);
  if (s.underutilized.length) {
    L.push(`under-utilized (<${floor}%): ${s.underutilized.join(', ')}`);
  }
  const unhealthy = s.health.filter((h) => h.status !== 'HEALTHY');
  if (unhealthy.length) {
    L.push('');
    L.push('voice health:');
    for (const h of unhealthy) {
      const mark = h.status === 'DEAD' ? '☠' : '⚠';
      L.push(`  ${mark} ${h.family.padEnd(10)} ${h.status}  (succeeded:${h.succeeded} failed:${h.failed})`);
    }
    if (s.deadVoices.length) L.push(`  → dead voice(s) burning retries in the chain: ${s.deadVoices.join(', ')}`);
  }
  return L.join('\n');
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!existsSync(a.invoke)) {
    process.stdout.write(`(no MODELINV chain at ${a.invoke})\n`);
    process.exit(0);
  }
  const raw = readFileSync(a.invoke, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } });
  const scoped = scopeEntries(raw, { last: a.last, since: a.since });
  const s = summarizeUtilization(scoped, { floorPct: a.floor });
  process.stdout.write((a.json ? JSON.stringify(s, null, 2) : render(s, a.floor)) + '\n');
  process.exit(0);
}

const _invoked = process.argv[1] || '';
if (import.meta.url === `file://${_invoked}` || import.meta.url.endsWith(_invoked)) main();
