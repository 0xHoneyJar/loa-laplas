// compose-items.mjs — S3.3 the /compose driver decision (driver, Flatline D10). Turns a bare
// goal into the emitter's args.items[] via decompose.mjs, OR — when items are already supplied
// — bypasses the decomposer ENTIRELY so the existing RFC #35 path is byte-for-byte unchanged.
// The branch on decompose's typed result IS the contract:
//   dag     → { mode:'fanout', items, rel_policy }   the emitter waves them (G-1)
//   serial  → { mode:'single', goal }                one context, no fan-out
//   refusal → { mode:'refuse', … }                   surface to the operator; do NOT run
//
// The /compose driver (skills/compose) calls this BEFORE handing args to the emitted workflow.
import { decompose } from '../bin/decompose.mjs';

// decompose's `tier` is a MODEL name; the emitter keys leaf models by an `intelligence_tier`
// vocabulary (tiny/cheap/mid/deep/max). Map across, or the emitter's `|| "sonnet"` fallback
// would silently DOWNGRADE an opus leaf to sonnet (a G-3 violation in the wrong direction).
const TIER_TO_INTELLIGENCE = { haiku: 'tiny', sonnet: 'cheap', opus: 'deep', fable: 'max', external: 'cheap' };

const toEmitterItem = (it) => ({
  id: it.id,
  task: it.task,
  depends_on: it.depends_on ?? [],
  intelligence_tier: TIER_TO_INTELLIGENCE[it.tier] ?? 'cheap',
});

export async function resolveComposeItems({ goal, items, ...opts } = {}) {
  // D10 rollout safety: pre-supplied items bypass the decomposer ENTIRELY — the goal is never
  // even looked at, so the RFC #35 path is unchanged for existing callers.
  if (Array.isArray(items) && items.length) return { mode: 'bypass', items, decomposed: false };

  const { result, exit } = await decompose(goal, opts);
  if (!result) return { mode: 'refuse', exit, refusal_reason: 'VALIDATION_FAIL', detail: `dagValidate failed (exit ${exit})` };
  if (result.type === 'dag') {
    // The driver passes `gate_batch_max` into the emitted workflow's args (S3.4): the DAG
    // fan-out batches each wave by it (casual 8 / competitive 4). `stall_s` rides the same
    // way (S4.4): the emitted wave loop's per-wave stall watchdog reads it. Both surfaced
    // flat so the driver doesn't have to reach into rel_policy.
    return {
      mode: 'fanout',
      items: result.items.map(toEmitterItem),
      rel_policy: result.rel_policy,
      gate_batch_max: result.rel_policy?.gate_batch_max,
      stall_s: result.rel_policy?.stall_s,
      decomposed: true,
    };
  }
  if (result.type === 'serial') {
    return { mode: 'single', goal, fallback_reason: result.fallback_reason, decomposed: true };
  }
  return { mode: 'refuse', exit, refusal_reason: result.refusal_reason, detail: result.detail };
}
