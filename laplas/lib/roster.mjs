// roster.mjs — the party roster contract (SDD §4.1 / sprint S1.7). Source: the
// party manifest referenced by module.json. Bridges the existing party.members
// shape ({role, seat, tier, kind}) to the routing roster {roles:[{id,domain,tier_ceiling}]}.
// A role is the routing key; a member's declared tier is the role's tier_ceiling.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TIERS = new Set(['haiku', 'sonnet', 'opus']);

export function rosterFromParty(party = {}) {
  const members = party.members ?? [];
  if (!members.length) return { ok: false, exit: 6, error: 'ROSTER_INVALID: party has no members' };
  const roles = [];
  const seen = new Set();
  for (const m of members) {
    if (!m.role) return { ok: false, exit: 6, error: 'ROSTER_INVALID: a member has no role' };
    if (m.tier && !TIERS.has(m.tier)) {
      return { ok: false, exit: 6, error: `ROSTER_INVALID: unknown tier '${m.tier}' for role '${m.role}'` };
    }
    if (seen.has(m.role)) continue; // a role may seat several members (e.g. a council); dedupe on the key
    seen.add(m.role);
    roles.push({ id: m.role, domain: m.domain ?? null, tier_ceiling: m.tier ?? null });
  }
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
