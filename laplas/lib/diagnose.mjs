// diagnose.mjs — C9 GECKO sense (S4.1). When a leaf stalls, GECKO's diagnose
// looks at the stalled item and emits a `named_gap`: the missing capability, the
// evidence, and a bounded recommendation a stall-exit can act on. Phase 1 ships
// the *minimal* sense — a structural read of the stalled leaf, not full loiter
// telemetry (that is FR-5 / Phase 1.5). The shape is the stable FR-3↔FR-4.5↔FR-5
// interface (schemas/named-gap.schema.json), so the richer Phase-1.5 sensor can
// drop in behind the same contract.
//
//   diagnose(stalledLeaf, opts) -> named_gap   (schema-valid; missing_role non-empty)

// A stalled leaf names the role it could not satisfy. The role IS the missing
// capability — a leaf that stalled on its own task is, by definition, missing the
// competence that task demanded. We never emit an empty missing_role (the schema
// floor): an unlabelled leaf degrades to a named-but-generic specialist so FR-5
// attribution still has a key to aggregate on.
const FALLBACK_ROLE = "unknown-specialist";

export function diagnose(stalledLeaf = {}, opts = {}) {
  const item_id = stalledLeaf.id || opts.item_id || "unknown-item";
  const missing_role = (stalledLeaf.role && String(stalledLeaf.role).trim())
    || (opts.missing_role && String(opts.missing_role).trim())
    || FALLBACK_ROLE;

  // recommendation is bounded to what a Phase-1 stall-exit can DO: re-quest the
  // item, summon the missing role, or escalate. summon is only recommended when
  // the policy permits it — an automated competitive run cannot summon (no
  // operator, summon_approval:'fail'), so we recommend escalate instead of
  // recommending an action the exit cannot take.
  const summon_allowed = opts.summon_allowed !== false; // default: summonable
  const recommendation = summon_allowed ? `summon:${missing_role}` : "escalate";

  const stall_s = opts.stall_s;
  const evidence = `leaf '${item_id}' produced no progress-bearing event for `
    + (stall_s != null ? `${stall_s}s (rel_policy.stall_s)` : "the stall window")
    + (stalledLeaf.task ? `; stalled task: ${String(stalledLeaf.task).slice(0, 120)}` : "");

  // Phase-1 confidence is a fixed, honest telemetry value — the minimal sense is a
  // structural inference, not a measured loiter signal. Phase 1.5 will compute this
  // from real per-leaf telemetry (FR-5). We do not fabricate precision we lack.
  const confidence = typeof opts.confidence === "number" ? opts.confidence : 0.5;

  return { item_id, missing_role, evidence, recommendation, confidence };
}
