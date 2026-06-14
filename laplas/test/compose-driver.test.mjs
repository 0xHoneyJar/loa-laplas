// compose-driver.test.mjs — Sprint 3 S3.3: the /compose driver decision (resolveComposeItems).
// Mocked provider (Flatline D8); asserts the bare-goal→items branch AND the pre-supplied-items
// bypass (RFC #35 unchanged, Flatline D10). S3.4 (emitter gate-cap) is separate.
// Run: node --test laplas/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveComposeItems } from '../lib/compose-items.mjs';

const roster = { roles: [
  { id: 'impl', domain: null, tier_ceiling: 'sonnet' },
  { id: 'rev', domain: null, tier_ceiling: 'opus' },
] };
const ctx = { dungeon: { rooms: [{ id: 'r', covers_domains: ['code', 'contracts'] }] }, party: {}, rel: 'casual', run_mode: 'interactive' };
const cleanSpawn = () => ({ status: 0, stdout: '{"score":0.1}', error: null });
const fast = { retries: 0, backoff_ms: 0 };
const prov = (s) => async () => s;
const base = { roster, ctx, sanitizeSpawn: cleanSpawn, retry: fast };

// ───────────────────────── D10 — pre-supplied items bypass the decomposer ─────────────────────────
test('S3.3 (D10) — a pre-supplied items[] bypasses the decomposer entirely (RFC #35 unchanged)', async () => {
  // An oversized goal WOULD refuse (exit 7) if decomposed — proving bypass means the goal is
  // never even consulted when items are supplied.
  const r = await resolveComposeItems({ goal: 'x'.repeat(99_999), items: [{ id: 'x', task: 't' }], ...base });
  assert.equal(r.mode, 'bypass');
  assert.equal(r.decomposed, false);
  assert.deepEqual(r.items, [{ id: 'x', task: 't' }]); // passed through untouched
});

// ───────────────────────── bare goal → decompose branch ─────────────────────────
test('S3.3 — a bare multi-domain goal → fanout with emitter-shaped items', async () => {
  const split = '[{"id":"a","task":"impl X","role":"impl","domain_hint":"code","depends_on":[]},' +
                '{"id":"b","task":"review Y","role":"rev","domain_hint":"contracts","depends_on":[]}]';
  const r = await resolveComposeItems({ goal: 'do X and Y', provider: prov(split), ...base });
  assert.equal(r.mode, 'fanout');
  assert.equal(r.decomposed, true);
  assert.equal(r.items.length, 2);
  // emitter item shape: {id, task, depends_on, intelligence_tier}
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['depends_on', 'id', 'intelligence_tier', 'task']);
  assert.ok(r.rel_policy, 'fanout carries rel_policy for the emitter gate-cap');
  // S3.4 config touch: gate_batch_max is surfaced flat for the driver to pass as args.gate_batch_max
  assert.equal(r.gate_batch_max, 8, 'casual rel → gate_batch_max 8 (the emitter wave batch width)');
});

test('S3.3 — tier mapping: an opus-routed (central) leaf maps to intelligence_tier "deep", never downgraded', async () => {
  // a is central (b,c depend on it) + role rev (opus ceiling) + known domain → routed opus.
  const split = '[{"id":"a","task":"t","role":"rev","domain_hint":"code","depends_on":[]},' +
                '{"id":"b","task":"t","role":"rev","domain_hint":"code","depends_on":["a"]},' +
                '{"id":"c","task":"t","role":"rev","domain_hint":"code","depends_on":["a"]}]';
  const r = await resolveComposeItems({ goal: 'g', provider: prov(split), ...base });
  assert.equal(r.mode, 'fanout');
  const a = r.items.find((i) => i.id === 'a');
  assert.equal(a.intelligence_tier, 'deep', 'opus leaf must map to deep, not silently fall back to sonnet');
  const b = r.items.find((i) => i.id === 'b');
  assert.equal(b.intelligence_tier, 'cheap', 'a covered low-centrality leaf stays cheap (sonnet)');
});

test('S3.3 — an indivisible goal → single (no fan-out); a refused goal → refuse (do not run)', async () => {
  const single = await resolveComposeItems({ goal: 'g', provider: prov('   '), ...base }); // empty → serial
  assert.equal(single.mode, 'single');
  assert.equal(single.fallback_reason, 'LLM_EMPTY');

  const refused = await resolveComposeItems({ goal: 'g', provider: () => { throw new Error('down'); }, ...base });
  assert.equal(refused.mode, 'refuse');
  assert.equal(refused.refusal_reason, 'LLM_FAILURE');
  assert.equal(refused.exit, 5);
});
