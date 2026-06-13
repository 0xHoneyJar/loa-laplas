// S2.3 acceptance: each of P601–P606 refuses with the fix NAMED, isolated.
// Starts from the worked example (all-agree), mutates one field per case.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const READY = join(here, "..", "bin", "laplas-ready.mjs");
const MOD = join(here, "..", "..", "modules", "code-implement-and-review");
const good = (n) => JSON.parse(readFileSync(join(MOD, `${n}.json`), "utf8"));

// write a module dir with the given (possibly mutated) manifests, run ready, return {code, refusals}
function ready({ quest = good("quest"), party = good("party"), dungeon = good("dungeon") } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "laplas-ready-"));
  writeFileSync(join(dir, "module.json"), JSON.stringify({ name: "t", quest: "quest.json", party: "party.json", dungeon: "dungeon.json" }));
  writeFileSync(join(dir, "quest.json"), JSON.stringify(quest));
  writeFileSync(join(dir, "party.json"), JSON.stringify(party));
  writeFileSync(join(dir, "dungeon.json"), JSON.stringify(dungeon));
  try {
    execFileSync(process.execPath, [READY, join(dir, "module.json")], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, refusals: [] };
  } catch (e) {
    let parsed = { refusals: [] };
    try { parsed = JSON.parse(e.stderr); } catch {}
    return { code: e.status, refusals: parsed.refusals ?? [] };
  }
}
const has = (refusals, code) => refusals.find(r => r.code === code);

test("the worked example is all-agree (baseline passes)", () => {
  assert.equal(ready().code, 0);
});

test("P601 — role required but party lacks it; refusal names recruit-or-re-quest", () => {
  const party = good("party"); party.members = party.members.filter(m => m.role !== "implementer");
  const r = has(ready({ party }).refusals, "P601");
  assert.ok(r, "P601 not raised"); assert.match(r.refusal, /Recruit|re-quest/i);
});

test("P602 — tool required but dungeon lacks it; refusal names the loadout fix", () => {
  const dungeon = good("dungeon"); dungeon.tools = [];
  const r = has(ready({ dungeon }).refusals, "P602");
  assert.ok(r); assert.match(r.refusal, /Daemonheim|loadout|provision/i);
});

test("P603 — council under-staffed; refusal names #30 + add voices", () => {
  // code-implement-and-review is council:false now (compose-speed S1, single opus gate);
  // assert an explicit council mandate so the under-staffed check has something to bite.
  const quest = good("quest"); quest.review_routing = { council: true, min_voices: 2 };
  const party = good("party"); // S1 staffs ONE council seat (reviewer) — under the min of 2
  const r = has(ready({ quest, party }).refusals, "P603");
  assert.ok(r); assert.match(r.refusal, /add voices|#30|council/i);
});

test("P604 — gate keys to a room the dungeon lacks; refusal names the keying fix", () => {
  const dungeon = good("dungeon"); dungeon.rooms = dungeon.rooms.filter(rm => rm.id !== "review");
  const r = has(ready({ dungeon }).refusals, "P604");
  assert.ok(r); assert.match(r.refusal, /unreachable|keying/i);
});

test("P605 — competitive quest in a casual dungeon; refusal names run-competitive-or-downgrade", () => {
  const dungeon = good("dungeon"); dungeon.rel = "casual";
  const r = has(ready({ dungeon }).refusals, "P605");
  assert.ok(r); assert.match(r.refusal, /competitive|downgrade/i);
});

test("P606 — HITL gate with no operator seat; refusal names the missing seat", () => {
  const party = good("party"); party.members = party.members.filter(m => m.kind !== "hitl");
  const r = has(ready({ party }).refusals, "P606");
  assert.ok(r); assert.match(r.refusal, /operator is a party slot|add the seat/i);
});

test("module-bad fires ALL six (the reference's combined fixture)", () => {
  const codes = new Set(ready({
    quest: { name: "q", version: "1.0.0", rel: "competitive",
      requires: { roles: ["ghost"], tools: ["nonexistent-cli"] },
      review_routing: { council: true, min_voices: 2 },
      gates: [{ id: "g", room: "void", hitl: "operator-approval" }] },
    party: { name: "p", members: [{ role: "scribe", seat: "work", tier: "haiku", kind: "agent" }] },
    dungeon: { name: "d", rel: "casual", tools: [], rooms: [{ id: "only" }] },
  }).refusals.map(r => r.code));
  for (const c of ["P601", "P602", "P603", "P604", "P605", "P606"]) assert.ok(codes.has(c), `${c} missing`);
});
