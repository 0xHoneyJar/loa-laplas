#!/usr/bin/env node
// decompose.mjs — C1 / S3.2. The decomposer binary: wires the deterministic core (S1) and the
// security boundary (S2) around the one LLM call (S3.1) into a single typed result.
//
// Pipeline (sprint S3.2):  loadRoster → size-cap → sanitize → split → derive → dagValidate
//                          → typed emit.
//
// Exit matrix (§0.2):  0 dag|serial · 3 dagValidate fail/refusal (after ROLE_RETRY) ·
//                      4 security hard-block · 5 LLM failure · 6 roster invalid · 7 size cap.
//
// Role-hallucination is corrected with bounded retry-with-feedback (ROLE_RETRY); the feedback
// is stripped to the role-id charset BEFORE it re-enters the LLM (Flatline B4), and a retry
// returning a structurally-different DAG (different id-set) is rejected (Flatline D9).
//
// `decompose()` is provider-injected for deterministic tests (Flatline D8); the binary main()
// wires the real sonnet provider. The /compose DRIVER wiring (S3.3) + emitter gate-cap (S3.4)
// are a separate, higher-blast-radius step — NOT in this module.
import { fileURLToPath } from 'node:url';
import { loadRoster } from '../lib/roster.mjs';
import { checkSize } from '../lib/size-cap.mjs';
import { sanitizeGoal } from '../lib/sanitize-goal.mjs';
import { splitGoal } from '../lib/split-goal.mjs';
import { deriveRouting } from '../lib/derive-routing.mjs';
import { dagValidate } from '../lib/dag-validate.mjs';
import { relPolicy } from '../lib/rel-policy.mjs';
import { ROLE_RETRY } from '../lib/constants.mjs';

const refusal = (refusal_reason, detail) => ({ type: 'refusal', refusal_reason, detail });
const spanItem = (goal) => ({ id: 'span', task: String(goal), depends_on: [] });

// B4: strip a hallucinated role to the role-id charset before it re-enters the prompt.
function safeFeedback(badRole, validRoles) {
  const safe = String(badRole ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || '(empty)';
  return `the role "${safe}" is not in the roster; use ONLY one of [${validRoles.join(', ')}]`;
}

export async function decompose(goal, opts = {}) {
  // 1. roster (or exit 6)
  const rosterRes = opts.roster ? { ok: true, roster: opts.roster }
    : opts.modulePath ? loadRoster(opts.modulePath)
    : { ok: false, error: 'ROSTER_INVALID: no roster or modulePath' };
  if (!rosterRes.ok) return { result: refusal('ROSTER_INVALID', rosterRes.error), exit: 6 };
  const roster = rosterRes.roster;

  // 2. size cap (exit 7) — earliest, before any detector or LLM work
  const size = checkSize(goal);
  if (size.type === 'refusal') return { result: refusal('GOAL_TOO_LARGE', size.detail), exit: 7 };

  // 3. sanitize — detector via stdin, fail-closed (exit 4)
  const san = sanitizeGoal(goal, { spawn: opts.sanitizeSpawn, detector: opts.detector, timeoutMs: opts.detectorTimeoutMs });
  if (san.type === 'refusal') return { result: refusal(san.refusal_reason, san.detail), exit: 4 };

  // 4. split → derive → validate, with bounded ROLE_RETRY-with-feedback
  const ctx = { ...(opts.ctx ?? {}), roster };
  const policy = relPolicy(ctx.rel, ctx.run_mode);
  const roleIds = roster.roles.map((r) => r.id);
  const roleRetry = opts.roleRetry ?? ROLE_RETRY;
  let feedback = null;
  let firstIdSet = null;

  for (let attempt = 0; attempt <= roleRetry; attempt++) {
    const split = await splitGoal(goal, { provider: opts.provider, roles: roleIds, feedback, retry: opts.retry });
    if (split.type === 'fail') return { result: refusal('LLM_FAILURE', split.detail), exit: 5 };
    if (split.type === 'serial') return { result: { type: 'serial', items: [spanItem(goal)], fallback_reason: split.fallback_reason }, exit: 0 };

    // split.type === 'raw' — D9: a retry must keep the SAME id-set (no different-shaped DAG)
    const idSet = split.items.map((i) => i.id).slice().sort().join('');
    if (firstIdSet == null) firstIdSet = idSet;
    else if (idSet !== firstIdSet) return { result: null, exit: 3, stderr: 'P602: retry DAG id-set differs from original (D9)' };

    const routed = deriveRouting(split.items, ctx);
    const v = dagValidate(routed, roster);
    if (v.type === 'dag') return { result: { type: 'dag', items: v.items, rel_policy: policy, decomposition_confidence: v.decomposition_confidence }, exit: 0 };
    if (v.type === 'serial') return { result: { type: 'serial', items: [spanItem(goal)], fallback_reason: v.fallback_reason }, exit: 0 };
    if (v.type === 'refusal') return { result: refusal(v.refusal_reason, v.detail), exit: 3 };

    // v.type === 'fail' — ROLE_MISS retries with sanitized feedback; all else is structural
    if (v.code === 'ROLE_MISS' && attempt < roleRetry) { feedback = safeFeedback(v.detail, roleIds); continue; }
    return { result: null, exit: 3, stderr: `P601: dagValidate ${v.code} (${v.detail})` };
  }
  return { result: null, exit: 3, stderr: 'P601: ROLE_RETRY exhausted (persistent role hallucination)' };
}

// ── binary entrypoint ──
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const goal = get('--goal');
  const modulePath = get('--module');
  if (goal == null) { console.error('P600: --goal <str> required'); process.exit(5); }
  const { defaultProvider } = await import('../lib/claude-provider.mjs');
  const { result, exit, stderr } = await decompose(goal, { modulePath, provider: defaultProvider });
  if (stderr) console.error(stderr);
  if (result) console.log(JSON.stringify(result));
  process.exit(exit);
}
