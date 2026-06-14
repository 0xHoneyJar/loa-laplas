// decompose-core.test.mjs — Sprint 1 (decompose-bridge): the deterministic routing
// core + roster contract. Every AC from sprint.md Sprint 1 is walked here. Pure, no LLM.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { relPolicy } from "../lib/rel-policy.mjs";
import { gateCoverage, gateBlind } from "../lib/gate-coverage.mjs";
import { centrality, highCentrality } from "../lib/centrality.mjs";
import { deriveRouting, resolveDomain } from "../lib/derive-routing.mjs";
import { dagValidate } from "../lib/dag-validate.mjs";
import { rosterFromParty } from "../lib/roster.mjs";
import { N_MAX_ITEMS } from "../lib/constants.mjs";

// ── shared fixtures ──
const dungeon = { rooms: [{ id: "review", covers_domains: ["code"] }] };
const party = { members: [
  { role: "impl", seat: "work", tier: "sonnet", kind: "agent" },
  { role: "rev", seat: "council", tier: "opus", kind: "agent" },
] };
const roster = rosterFromParty(party).roster;
const ctx = { dungeon, party, roster, rel: "casual", run_mode: "interactive" };

// a minimal ROUTED item for the structural dagValidate cases
const ri = (id, { depends_on = [], role = "impl", domain = "code", conf = 1 } = {}) =>
  ({ id, task: "t", depends_on, role, domain, decomposition_confidence: conf });

// ───────────────────────── AC-S1.1 — rel-policy ─────────────────────────
test("AC-S1.1 — casual/automated → summon_approval 'auto'; competitive/automated → 'fail'", () => {
  assert.equal(relPolicy("casual", "automated").summon_approval, "auto");
  assert.equal(relPolicy("competitive", "automated").summon_approval, "fail");
  // interactive keeps the human-gated terminal
  assert.equal(relPolicy("competitive", "interactive").summon_approval, "break_glass");
  // unknown REL → the safer (competitive) posture
  assert.equal(relPolicy("bogus").gate_density, "dense");
});

// ───────────────────────── AC-S1.2 — gate-coverage ─────────────────────────
test("AC-S1.2 — declared covers_domains; undeclared gate covers room domain ONLY, never '*'", () => {
  const cov = gateCoverage(dungeon, party);
  assert.equal(gateBlind("code", cov), false);     // covered
  assert.equal(gateBlind("contracts", cov), true);  // not covered → gate-blind
  // undeclared gate (no covers_domains) falls back to its room's declared domain only
  const cov2 = gateCoverage({ rooms: [{ id: "g", domain: "design" }] }, {});
  assert.equal(gateBlind("design", cov2), false);
  assert.equal(gateBlind("anything-else", cov2), true); // never a wildcard
  // a gate with NO domain at all covers nothing → everything gate-blind
  const cov3 = gateCoverage({ rooms: [{ id: "g" }] }, {});
  assert.equal(gateBlind("code", cov3), true);
});

// ───────────────────────── AC-S1.4 — opus surgical (G-3 unit) ─────────────────────────
test("AC-S1.4 — opus iff gate_blind OR high_centrality; gate-covered low-centrality leaf → tier_default", () => {
  // gate-covered, low-centrality, role allows opus → stays at tier_default (sonnet)
  const covered = deriveRouting([{ id: "a", task: "t", role: "rev", domain_hint: "code" }], ctx)[0];
  assert.equal(covered.gate_coverage, true);
  assert.equal(covered.tier, "sonnet");

  // gate-blind leaf (domain not covered), role allows opus → opus
  const blind = deriveRouting([{ id: "b", task: "t", role: "rev", domain_hint: "contracts" }], ctx)[0];
  assert.equal(blind.gate_coverage, false);
  assert.equal(blind.tier, "opus");

  // high-centrality node even though gate-covered → opus (b,c depend on a)
  const dag = deriveRouting([
    { id: "a", task: "t", role: "rev", domain_hint: "code" },
    { id: "b", task: "t", role: "rev", domain_hint: "code", depends_on: ["a"] },
    { id: "c", task: "t", role: "rev", domain_hint: "code", depends_on: ["a"] },
  ], ctx);
  const a = dag.find((x) => x.id === "a");
  assert.equal(highCentrality({ id: "a" }, dag), true);
  assert.equal(centrality({ id: "a" }, dag), 2);
  assert.equal(a.tier, "opus");
});

// ───────────────────────── AC-S1.7b — tier_ceiling clamp ─────────────────────────
test("AC-S1.7b — a leaf that wants opus but role tier_ceiling=sonnet → clamped", () => {
  // gate-blind leaf with role 'impl' (tier_ceiling sonnet) → wants opus, clamped to sonnet
  const it = deriveRouting([{ id: "x", task: "t", role: "impl", domain_hint: "contracts" }], ctx)[0];
  assert.equal(it.tier, "sonnet");
  assert.equal(it.tier_clamped, true);
});

// ───────────────────────── AC-S1.5 — determinism ─────────────────────────
test("AC-S1.5 — identical inputs → byte-identical items[] (stable order, sorted deps)", () => {
  const raw = [
    { id: "b", task: "t", role: "impl", domain_hint: "code", depends_on: ["a"] },
    { id: "a", task: "t", role: "impl", domain_hint: "code" },
  ];
  const one = JSON.stringify(deriveRouting(raw, ctx));
  const two = JSON.stringify(deriveRouting(raw.map((x) => ({ ...x })), ctx));
  assert.equal(one, two);
  // depends_on is sorted in the routed output
  const multi = deriveRouting([
    { id: "z", task: "t", role: "impl", domain_hint: "code", depends_on: ["c", "a", "b"] },
    { id: "a", task: "t", role: "impl", domain_hint: "code" },
    { id: "b", task: "t", role: "impl", domain_hint: "code" },
    { id: "c", task: "t", role: "impl", domain_hint: "code" },
  ], ctx);
  assert.deepEqual(multi.find((x) => x.id === "z").depends_on, ["a", "b", "c"]);
});

// ───────────────────────── AC-S1.6 — the typed-outcome fixture table ─────────────────────────
test("AC-S1.6 — every structural/routing case yields the exact typed outcome", () => {
  // cycle
  assert.deepEqual(pick(dagValidate([ri("a", { depends_on: ["b"] }), ri("b", { depends_on: ["a"] })], roster)), { type: "fail", code: "CYCLE" });
  // dangling dep
  assert.deepEqual(pick(dagValidate([ri("a", { depends_on: ["ghost"] })], roster)), { type: "fail", code: "DANGLING_DEP" });
  // duplicate id
  assert.deepEqual(pick(dagValidate([ri("a"), ri("a")], roster)), { type: "fail", code: "DUP_ID" });
  // role not in roster
  assert.deepEqual(pick(dagValidate([ri("a", { role: "ghost" })], roster)), { type: "fail", code: "ROLE_MISS" });
  // multi-valued / unresolved domain → refusal
  assert.deepEqual(pick(dagValidate([ri("a", { domain: null })], roster)), { type: "refusal", refusal_reason: "DOMAIN_AMBIGUOUS" });
  // below confidence floor → serial
  assert.deepEqual(pick(dagValidate([ri("a", { conf: 0 }), ri("b", { conf: 0 })], roster)), { type: "serial", fallback_reason: "LOW_CONFIDENCE" });
  // zero items → serial (§0.1: LLM_EMPTY — the goal still runs single-context)
  assert.deepEqual(pick(dagValidate([], roster)), { type: "serial", fallback_reason: "LLM_EMPTY" });
  // over the bounds → fail
  const tooMany = Array.from({ length: N_MAX_ITEMS + 1 }, (_, i) => ri(`n${i}`));
  assert.deepEqual(pick(dagValidate(tooMany, roster)), { type: "fail", code: "BOUNDS" });
  // happy path → dag
  const ok = dagValidate([ri("a"), ri("b", { depends_on: ["a"] })], roster);
  assert.equal(ok.type, "dag");
  assert.equal(ok.decomposition_confidence, 1);
});

// ───────────────────────── AC-S1.7 — roster contract ─────────────────────────
test("AC-S1.7 — empty/malformed roster → exit 6", () => {
  assert.deepEqual(trim(rosterFromParty({ members: [] })), { ok: false, exit: 6 });
  assert.deepEqual(trim(rosterFromParty({})), { ok: false, exit: 6 });
  assert.deepEqual(trim(rosterFromParty({ members: [{ role: "x", tier: "gpt9" }] })), { ok: false, exit: 6 });
  // valid → roles mapped, role is the key, member tier is the ceiling
  const r = rosterFromParty(party);
  assert.equal(r.ok, true);
  assert.deepEqual(r.roster.roles.find((x) => x.id === "impl").tier_ceiling, "sonnet");
});

// ─── AC-S1.7 regression — the repo's own canonical good fixture must load ───
// (party-good.json has a tier:"external" council member and a HITL operator
// with no role — the exact shape that exit-6'd before this fix.)
test("AC-S1.7 regression — party-good.json loads: 4 agent roles, HITL operator skipped", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const good = JSON.parse(readFileSync(join(here, "fixtures", "party-good.json"), "utf8"));
  const res = rosterFromParty(good);
  assert.equal(res.ok, true);
  const ids = res.roster.roles.map((x) => x.id).sort();
  assert.deepEqual(ids, ["auditor", "reviewer-a", "reviewer-b", "scribe"]);
  // the HITL operator seat is NOT a routable role
  assert.equal(res.roster.roles.some((x) => x.id === "operator"), false);
  // the external council voice is accepted (no clamp) — tier_ceiling carried through
  assert.equal(res.roster.roles.find((x) => x.id === "reviewer-b").tier_ceiling, "external");
});

test("resolveDomain — single resolves, empty/multi unresolved", () => {
  assert.equal(resolveDomain("code"), "code");
  assert.equal(resolveDomain("code,contracts"), null);
  assert.equal(resolveDomain("  "), null);
  assert.equal(resolveDomain(undefined), null);
});

// helpers
function pick(r) { return r.type === "fail" ? { type: r.type, code: r.code } : r.type === "refusal" ? { type: r.type, refusal_reason: r.refusal_reason } : { type: r.type, fallback_reason: r.fallback_reason }; }
function trim(r) { return { ok: r.ok, exit: r.exit }; }
