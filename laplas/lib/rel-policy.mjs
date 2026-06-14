// rel-policy.mjs — REL compiles to a computable policy struct (SDD C4 / sprint S1.1).
// One source (REL), many derived knobs. run_mode-aware: an automated run NEVER
// resolves summon_approval to an interactive terminal (Flatline-PRD DISPUTED-1) —
// REL must not compile to a headless deadlock.
const POLICIES = {
  casual:      { tier_default: 'sonnet', gate_density: 'sparse', gate_batch_max: 8, confidence_floor: 0.5, stall_s: 90, summon_generosity: 'generous', summon_approval: 'auto' },
  competitive: { tier_default: 'sonnet', gate_density: 'dense',  gate_batch_max: 4, confidence_floor: 0.7, stall_s: 45, summon_generosity: 'tight',    summon_approval: 'break_glass' },
};

export function relPolicy(rel, run_mode = 'interactive') {
  const base = POLICIES[rel] ?? POLICIES.competitive; // unknown REL → the safer (stricter) posture
  const p = { ...base };
  if (run_mode === 'automated') {
    // no operator present: casual auto-grants within budget; competitive fails loud —
    // never 'break_glass'/operator-wait, which would hang a headless /simstim or cron run.
    p.summon_approval = (rel === 'casual') ? 'auto' : 'fail';
  }
  return p;
}
