// roster.mjs — the party roster contract (SDD §4.1 / sprint S1.7). Source: the
// party manifest referenced by module.json. Bridges the existing party.members
// shape ({role, seat, tier, kind}) to the routing roster {roles:[{id,domain,tier_ceiling}]}.
// A role is the routing key; a member's declared tier is the role's tier_ceiling.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The real party tier vocabulary: haiku/sonnet/opus + 'external' (a non-Anthropic
// council voice — proven by party-good.json). Genuine typos ('gpt9') still reject.
const TIERS = new Set(['haiku', 'sonnet', 'opus', 'external']);
// Tier rank for picking the MOST RESTRICTIVE (lowest-rank) ceiling when a role
// seats several members. external is opus-rank (no opus clamp). null = no ceiling.
const TIER_RANK = { haiku: 0, sonnet: 1, opus: 2, external: 2 };
const tierRank = (t) => (t == null ? Infinity : TIER_RANK[t] ?? 1);

export function rosterFromParty(party = {}) {
  const members = party.members ?? [];
  if (!members.length) return { ok: false, exit: 6, error: 'ROSTER_INVALID: party has no members' };
  const byRole = new Map(); // role id → role entry; Map preserves first-seen (stable) order
  for (const m of members) {
    if (m.kind === 'hitl') continue; // operator seats are not routable agent roles — skip
    if (!m.role) return { ok: false, exit: 6, error: 'ROSTER_INVALID: a member has no role' };
    if (m.tier && !TIERS.has(m.tier)) {
      return { ok: false, exit: 6, error: `ROSTER_INVALID: unknown tier '${m.tier}' for role '${m.role}'` };
    }
    const prev = byRole.get(m.role);
    if (!prev) {
      byRole.set(m.role, { id: m.role, domain: m.domain ?? null, tier_ceiling: m.tier ?? null });
    } else if (tierRank(m.tier) < tierRank(prev.tier_ceiling)) {
      // a role may seat several members (e.g. a council); keep the most restrictive ceiling
      prev.tier_ceiling = m.tier ?? null;
    }
  }
  const roles = [...byRole.values()];
  if (!roles.length) return { ok: false, exit: 6, error: 'ROSTER_INVALID: no agent roles' };
  return { ok: true, roster: { roles } };
}

export function loadRoster(modulePath) {
  let party;
  try {
    const mod = JSON.parse(readFileSync(modulePath, 'utf8'));
    party = JSON.parse(readFileSync(join(dirname(modulePath), mod.party), 'utf8'));
  } catch (e) {
    return { ok: false, exit: 6, error: `ROSTER_INVALID: ${e.message}` };
  }
  return rosterFromParty(party);
}
