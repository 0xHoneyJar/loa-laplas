// split-goal.mjs — C2 / S3.1. The ONE LLM call in the bridge: a goal → a raw-item DAG
// (§0.3). The model call sits behind a PROVIDER INTERFACE (Flatline D8) so tests mock it
// deterministically and the real sonnet wiring is swappable without touching this logic.
// The model's self-confidence is telemetry; the gating confidence is computed downstream (S1).
//
// Typed outcomes (sprint §0.1/§0.2):
//   { type:'raw',    items:[<raw-item>…] }                       → caller derives + validates
//   { type:'serial', fallback_reason:'LLM_EMPTY'|'INDIVISIBLE' } → safe single-context (exit 0)
//   { type:'fail',   code:'LLM_FAILURE', detail }                → S3 binary → exit 5
//
// Provider contract: `provider(prompt: string) => Promise<string>` returning the model's raw
// text. A throw = a provider/transport failure (retryable, then exit 5). A successful call
// returning empty/non-JSON is NOT a failure — the model "ran" and declined or fumbled, which
// degrades to serial (LLM_EMPTY / INDIVISIBLE), never exit 5.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate } from './validate-schema.mjs';
import { SPLIT_RETRY } from './constants.mjs';

const RAW_ITEM_SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schemas/raw-item.schema.json', import.meta.url)), 'utf8'),
);

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// Strip ```json fences / leading prose, then take the first balanced [...] or {...} block.
export function stripFences(text) {
  const s = String(text ?? '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : s).trim();
  const arr = body.indexOf('[');
  const obj = body.indexOf('{');
  const start = arr === -1 ? obj : obj === -1 ? arr : Math.min(arr, obj);
  return start === -1 ? body : body.slice(start).trim();
}

// Parse → { ok:true, items } | { ok:false, error }. Empty output ≡ no split → items:[].
function parseItems(raw) {
  const text = stripFences(raw);
  if (!text) return { ok: true, items: [] };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: `non-JSON: ${e.message}` }; }
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (items == null) return { ok: false, error: 'no items array in model output' };
  for (let i = 0; i < items.length; i++) {
    const errs = validate(RAW_ITEM_SCHEMA, items[i], `items[${i}]`);
    if (errs.length) return { ok: false, error: errs[0] };
  }
  return { ok: true, items };
}

// Build the decomposition prompt. Roles are listed so the model picks valid ones (fewer
// hallucinations); `feedback` is the (already-sanitized, see decompose.mjs B4) correction
// appended on a ROLE_RETRY.
export function buildPrompt(goal, opts = {}) {
  const roles = opts.roles ?? [];
  return [
    'Decompose the GOAL into a minimal DAG of subtasks. Output ONLY a JSON array; each item:',
    '{"id","task","depends_on":[],"role","domain_hint","confidence"}. No prose, no code fences.',
    roles.length ? `Valid roles: [${roles.join(', ')}]. Use ONLY these role ids.` : '',
    'If the goal is indivisible, output []. Keep ids short and unique.',
    opts.feedback ? `CORRECTION (previous attempt): ${opts.feedback}` : '',
    `\nGOAL:\n${goal}`,
  ].filter(Boolean).join('\n');
}

export async function splitGoal(goal, opts = {}) {
  const provider = opts.provider;
  if (typeof provider !== 'function') return { type: 'fail', code: 'LLM_FAILURE', detail: 'no provider configured' };
  const { retries, backoff_ms } = opts.retry ?? SPLIT_RETRY;
  const prompt = buildPrompt(goal, opts);

  let parseErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    let raw;
    try {
      raw = await provider(prompt);
    } catch (e) {
      if (attempt >= retries) return { type: 'fail', code: 'LLM_FAILURE', detail: `provider error: ${e.message}` };
      await sleep(backoff_ms); continue;
    }
    const parsed = parseItems(raw);
    if (parsed.ok) {
      return parsed.items.length === 0
        ? { type: 'serial', fallback_reason: 'LLM_EMPTY' }
        : { type: 'raw', items: parsed.items };
    }
    parseErr = parsed.error;
    if (attempt < retries) await sleep(backoff_ms);
  }
  // Provider ran but never produced a valid split → safe degrade (not a transport failure).
  return { type: 'serial', fallback_reason: 'INDIVISIBLE', detail: parseErr };
}
