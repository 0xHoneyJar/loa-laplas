// opus-predicate.mjs — opus IFF gate_blind(domain) OR high_centrality(node).
// Computed from schema fields (deterministic, not LLM-judged). SDD C7 / sprint S1.4.
import { gateBlind } from './gate-coverage.mjs';
import { highCentrality } from './centrality.mjs';

const TIER_RANK = { haiku: 0, sonnet: 1, opus: 2 };
const tierRank = (t) => TIER_RANK[t] ?? 1;

export function opusPredicate(item, coverage, items) {
  return gateBlind(item.domain, coverage) || highCentrality(item, items);
}

// Place the leaf's tier, then clamp to the role's tier_ceiling if the roster sets
// one (Flatline-sprint D5). Returns { tier, clamped }.
export function placeTier(item, coverage, items, tier_default, tier_ceiling = null) {
  let tier = opusPredicate(item, coverage, items) ? 'opus' : tier_default;
  let clamped = false;
  if (tier_ceiling && tierRank(tier) > tierRank(tier_ceiling)) {
    tier = tier_ceiling;
    clamped = true;
  }
  return { tier, clamped };
}
