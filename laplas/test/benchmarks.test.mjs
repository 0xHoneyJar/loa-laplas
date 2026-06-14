// S3.4 issue benchmarks on REAL seeded run-state (not the demo's hand-built
// fixture): the gatekeeper judges against the contract the dispatcher seeds
// from the worked example's quest. Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const SEEDER = join(here, "..", "lib", "seed-runstate.mjs");
const GK = join(REPO, "poteau", "bin", "poteau-gatekeeper.mjs");
const MODULE = join(REPO, "modules", "code-implement-and-review", "module.json");

// seed run-state from the worked example, into a tmp file, return the parsed state
function seed() {
  const out = join(mkdtempSync(join(tmpdir(), "bench-")), "rs.json");
  execFileSync(process.execPath, [SEEDER, MODULE, out], { env: { ...process.env, POTEAU_RUN_ID: "bench" }, stdio: ["ignore", "ignore", "ignore"] });
  return JSON.parse(readFileSync(out, "utf8"));
}
function judge(run_state, packet) {
  try {
    const out = execFileSync(process.execPath, [GK], { input: JSON.stringify({ run_state, packet }), encoding: "utf8", cwd: mkdtempSync(join(tmpdir(), "gk-")) });
    return JSON.parse(out);
  } catch (e) { return JSON.parse(e.stdout); }
}

test("the seeder derives a real armed contract (task_ref + reads + routing)", () => {
  const rs = seed();
  assert.match(rs.task_ref, /^sha256:[0-9a-f]{64}$/);
  assert.ok(rs.task.objectives.length >= 1);
  assert.match(rs.mandated_reads[0].h1, /^# \S/); // mechanically extracted, well-formed H1 (repo-name-agnostic: CI checks out as a different dir name)
  // compose-speed S1 redesign: code-implement-and-review is now a single opus gate
  // (review_routing.council=false), not a 2-voice council — the seeder derives that.
  assert.equal(rs.review_routing.council, false);
});

test("#29 benchmark — wrong task_ref is refused P201 (the gate sees the task)", () => {
  const rs = seed();
  const v = judge(rs, { verdict: "APPROVED", rationale: "looks fine", task_ref: "sha256:wrong", conformance: { in_scope: true } });
  assert.equal(v.code, "P201");
});

test("#29 — missing in_scope assertion is refused P202", () => {
  const rs = seed();
  const v = judge(rs, { verdict: "APPROVED", rationale: rs.mandated_reads[0].h1, task_ref: rs.task_ref });
  assert.equal(v.code, "P202");
});

test("#31 benchmark — rationale missing the mandated read's H1 echo is refused P203", () => {
  const rs = seed();
  const v = judge(rs, { verdict: "APPROVED", rationale: "done, no echo of any read", task_ref: rs.task_ref, conformance: { in_scope: true } });
  assert.equal(v.code, "P203");
});

test("#30 benchmark — council-mandated surface refuses a single-voice packet P204", () => {
  const rs = seed();
  // code-implement-and-review is now council:false (compose-speed S1); this benchmark
  // exercises the council-MANDATE-refuses path, so assert an explicit council contract.
  rs.review_routing = { council: true, min_voices: 2 };
  // task + read + scope all correct; the ONLY remaining gate is the council
  const v = judge(rs, { verdict: "APPROVED", rationale: `${rs.mandated_reads[0].h1} — objectives met within scope`, task_ref: rs.task_ref, conformance: { in_scope: true } });
  assert.equal(v.code, "P204");
});

test("IMP-004 — a quest with no objectives cannot arm (seeder exit 3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "noobj-"));
  const q = JSON.parse(readFileSync(join(REPO, "modules/code-implement-and-review/quest.json"), "utf8"));
  delete q.objectives;
  writeFileSync(join(dir, "quest.json"), JSON.stringify(q));
  copyFileSync(join(REPO, "modules/code-implement-and-review/party.json"), join(dir, "party.json"));
  copyFileSync(join(REPO, "modules/code-implement-and-review/dungeon.json"), join(dir, "dungeon.json"));
  writeFileSync(join(dir, "module.json"), JSON.stringify({ name: "t", quest: "quest.json", party: "party.json", dungeon: "dungeon.json" }));
  let code = 0;
  try { execFileSync(process.execPath, [SEEDER, join(dir, "module.json"), join(dir, "rs.json")], { stdio: ["ignore", "ignore", "ignore"] }); }
  catch (e) { code = e.status; }
  assert.equal(code, 3);
});
