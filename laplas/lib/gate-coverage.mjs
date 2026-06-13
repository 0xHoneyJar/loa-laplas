// gate-coverage.mjs — gate_blind derived from the composition's OWN manifests
// (operator-signed: per-composition, no global registry). SDD C5 / sprint S1.2.
//
// Back-compat (Flatline-SDD B2): an undeclared gate covers its room's/seat's
// declared domain ONLY — never ['*']. A gate with no domain at all covers the
// empty set, so undeclared-domain leaves stay gate-blind → opus. The failure mode
// is over-provision (opus where maybe unneeded), never under-gate (cheap where
// unverifiable).
export function gateCoverage(dungeon = {}, party = {}) {
  const covered = new Set();
  const add = (entry) => {
    if (Array.isArray(entry.covers_domains)) for (const d of entry.covers_domains) covered.add(d);
    else if (entry.domain) covered.add(entry.domain); // back-compat: declared domain only
  };
  for (const room of dungeon.rooms ?? []) add(room);
  for (const m of party.members ?? []) if (m.seat === 'council' || m.seat === 'review') add(m);
  return covered;
}

export function gateBlind(domain, coverage) {
  return !coverage.has(domain);
}
