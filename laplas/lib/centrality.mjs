// centrality.mjs — a node's downstream blast radius: how many items transitively
// depend on it. A load-bearing node (many dependents) earns opus because its
// correctness gates the most downstream work. SDD C6 / sprint S1.3.
import { CENTRALITY_THRESHOLD } from './constants.mjs';

export function centrality(item, items) {
  const directDependents = (id) => items.filter((it) => (it.depends_on ?? []).includes(id));
  const seen = new Set();
  const visit = (id) => {
    for (const dep of directDependents(id)) {
      if (!seen.has(dep.id)) { seen.add(dep.id); visit(dep.id); }
    }
  };
  visit(item.id);
  return seen.size; // transitive downstream dependents
}

export function highCentrality(item, items) {
  return centrality(item, items) >= CENTRALITY_THRESHOLD;
}
