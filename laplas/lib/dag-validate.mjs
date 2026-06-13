// dag-validate.mjs — structural + routing validation over ROUTED items. Returns a
// typed outcome (sprint §0.1/§0.2). SDD C8.
//
// Typed outcomes:
//   { type:'dag',     items, decomposition_confidence }   → exit 0
//   { type:'serial',  fallback_reason }                   → exit 0 (safe degradation)
//   { type:'refusal', refusal_reason, detail }            → driver handles (no runnable item)
//   { type:'fail',    code, detail }                      → structural; the S3 binary → exit 3
//
// The role-hallucination retry hook is a no-op here (a ROLE_MISS fails straight to
// 'fail'); S3 wraps this with bounded retry-with-feedback before the hard exit.
import { N_MAX_ITEMS, CONFIDENCE_FLOOR } from './constants.mjs';

const fail = (code, detail = '') => ({ type: 'fail', code, detail });
const refusal = (refusal_reason, detail = '') => ({ type: 'refusal', refusal_reason, detail });
const serial = (fallback_reason) => ({ type: 'serial', fallback_reason });

export function dagValidate(items, roster, opts = {}) {
  const floor = opts.confidence_floor ?? CONFIDENCE_FLOOR;

  // bounds
  if (!Array.isArray(items) || items.length === 0) return serial('LLM_EMPTY');
  if (items.length > N_MAX_ITEMS) return fail('BOUNDS', `${items.length} > ${N_MAX_ITEMS}`);

  // duplicate ids
  const ids = items.map((i) => i.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup != null) return fail('DUP_ID', dup);

  // dangling deps
  const idset = new Set(ids);
  for (const it of items) {
    for (const d of it.depends_on ?? []) {
      if (!idset.has(d)) return fail('DANGLING_DEP', `${it.id}→${d}`);
    }
  }

  // cycle
  const cyc = findCycle(items);
  if (cyc) return fail('CYCLE', cyc.join('→'));

  // role ↔ roster (S1: no retry; S3 adds bounded retry-with-feedback first)
  const roles = new Set((roster?.roles ?? []).map((r) => r.id));
  for (const it of items) if (!roles.has(it.role)) return fail('ROLE_MISS', it.role);

  // one-room-one-domain: an unresolved (null) domain is ambiguous ⇒ unsafe to route
  for (const it of items) if (it.domain == null) return refusal('DOMAIN_AMBIGUOUS', it.id);

  // confidence floor (deterministic mean) → serial fallback
  const conf = items.reduce((s, it) => s + (it.decomposition_confidence ?? 0), 0) / items.length;
  if (conf < floor) return serial('LOW_CONFIDENCE');

  return { type: 'dag', items, decomposition_confidence: conf };
}

function findCycle(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(items.map((i) => [i.id, WHITE]));
  const stack = [];
  let cycle = null;
  const dfs = (id) => {
    color.set(id, GRAY); stack.push(id);
    for (const d of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(d)) continue;
      if (color.get(d) === GRAY) { cycle = stack.slice(stack.indexOf(d)).concat(d); return true; }
      if (color.get(d) === WHITE && dfs(d)) return true;
    }
    color.set(id, BLACK); stack.pop(); return false;
  };
  for (const i of items) if (color.get(i.id) === WHITE && dfs(i.id)) break;
  return cycle;
}
