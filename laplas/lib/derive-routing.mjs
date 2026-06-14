// derive-routing.mjs — turn raw items into routed items: resolve domain, compute
// centrality + gate_coverage, place tier, attach confidences. Deterministic; the
// model's self-confidence is carried as telemetry, the GATING confidence is computed
// (Flatline-SDD B7). SDD C3 / sprint S1.5.
import { relPolicy } from './rel-policy.mjs';
import { gateCoverage, gateBlind } from './gate-coverage.mjs';
import { centrality } from './centrality.mjs';
import { placeTier } from './opus-predicate.mjs';

// A single domain resolves to itself; empty or multi-valued is unresolved (→ ambiguous).
export function resolveDomain(hint) {
  if (typeof hint !== 'string') return null;
  const v = hint.trim();
  if (!v || /[,;|]/.test(v)) return null; // empty or multi-valued ⇒ unresolved
  return v;
}

export function deriveRouting(rawItems, ctx = {}) {
  const { dungeon = {}, party = {}, rel = 'competitive', run_mode = 'interactive', roster = null } = ctx;
  const policy = relPolicy(rel, run_mode);
  const coverage = gateCoverage(dungeon, party);
  const known = knownDomains(coverage, roster);
  const ceilingOf = (role) => roster?.roles?.find((r) => r.id === role)?.tier_ceiling ?? null;

  return rawItems.map((it) => {
    const domain = resolveDomain(it.domain_hint);
    const cent = centrality(it, rawItems);
    const gate_covered = domain != null && !gateBlind(domain, coverage);
    const { tier, clamped } = placeTier({ ...it, domain }, coverage, rawItems, policy.tier_default, ceilingOf(it.role));
    return {
      id: it.id,
      task: it.task,
      depends_on: [...(it.depends_on ?? [])].sort(),
      role: it.role,
      domain,
      centrality: cent,
      gate_coverage: gate_covered,
      tier,
      tier_clamped: clamped,
      // deterministic gating signal: 1 iff the domain resolved to a known composition
      // domain; 0 otherwise. NOT the model's self-report.
      decomposition_confidence: domain != null && known.has(domain) ? 1 : 0,
      model_confidence: typeof it.confidence === 'number' ? it.confidence : null, // telemetry only (B7)
    };
  });
}

function knownDomains(coverage, roster) {
  const s = new Set(coverage);
  for (const r of roster?.roles ?? []) if (r.domain) s.add(r.domain);
  return s;
}
