// S4: council-run.sh seats >=2 voices → the gatekeeper's P204 (which blocked the
// worked example's green path in S3) now CLEARS — #30's runtime half, end to end.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const COUNCIL = join(REPO, "scripts", "council-run.sh");
const SEEDER = join(here, "..", "lib", "seed-runstate.mjs");
const GK = join(REPO, "poteau", "bin", "poteau-gatekeeper.mjs");
const MODULE = join(REPO, "modules", "code-implement-and-review", "module.json");

function seed() {
  const out = join(mkdtempSync(join(tmpdir(), "c-")), "rs.json");
  execFileSync(process.execPath, [SEEDER, MODULE, out], { env: { ...process.env, POTEAU_RUN_ID: "c" }, stdio: ["ignore", "ignore", "ignore"] });
  return JSON.parse(readFileSync(out, "utf8"));
}
function council(packetObj, mock, minVoices = 2, runId = "c", gateIndex = 0) {
  const dir = mkdtempSync(join(tmpdir(), "cr-"));
  const pkt = join(dir, "pkt.json"); writeFileSync(pkt, JSON.stringify(packetObj));
  // C-REPLAY freshness: pass the run_id + gate_index so the reviewer signs the same
  // council subject the gatekeeper recomputes from the run-state.
  const out = execFileSync("bash", [COUNCIL, "--task-ref", packetObj.task_ref, "--packet", pkt, "--min-voices", String(minVoices), "--providers", "claude,codex,gemini", "--run-id", runId, "--gate-index", String(gateIndex)],
    { env: { ...process.env, COUNCIL_RUN_MOCK: JSON.stringify(mock) }, encoding: "utf8" });
  return JSON.parse(out);
}
function judge(run_state, packet) {
  try { return JSON.parse(execFileSync(process.execPath, [GK], { input: JSON.stringify({ run_state, packet }), encoding: "utf8", cwd: mkdtempSync(join(tmpdir(), "gk-")) })); }
  catch (e) { return JSON.parse(e.stdout); }
}

test("S4.1 — council-run seats 2 distinct voices, receipts bind task_ref + packet_hash", () => {
  const rs = seed();
  const pkt = { verdict: "APPROVED", rationale: "# construct-rooms-substrate — done", task_ref: rs.task_ref, conformance: { in_scope: true } };
  const c = council(pkt, { claude: "APPROVED", codex: "APPROVED" });
  assert.equal(c.voices, 2);
  assert.ok(c.council_receipts.every(r => r.task_ref === rs.task_ref && r.packet_hash.startsWith("sha256:")));
  assert.equal(new Set(c.council_receipts.map(r => r.provider)).size, 2); // distinct providers
});

test("S4.2 #30 runtime — council receipts CLEAR P204 (the worked example's green path opens)", () => {
  const rs = seed(); // worked example: review_routing.council=true, min_voices=2
  const base = { verdict: "APPROVED", rationale: "# construct-rooms-substrate — objectives met within scope", task_ref: rs.task_ref, conformance: { in_scope: true } };
  // before: no council receipts → P204 (proven in benchmarks.test.mjs)
  assert.equal(judge(rs, base).code, "P204");
  // after: attach the council's receipts → G4 clears, receipt minted. The council
  // signs the subject bound to THIS run+gate (rs.run_id / rs.gate_index).
  const c = council(base, { claude: "APPROVED", codex: "APPROVED" }, 2, rs.run_id, rs.gate_index);
  const withCouncil = { ...base, council_receipts: c.council_receipts };
  const v = judge(rs, withCouncil);
  assert.ok(v.pass === true, `expected pass, got ${JSON.stringify(v)}`);
  assert.match(v.receipt_hash, /^sha256:/);
});

test("S4.1 T6 — a single seated voice on a 2-voice surface hard-fails (exit 4), names the dead provider", () => {
  const rs = seed();
  const pkt = { verdict: "APPROVED", rationale: "x", task_ref: rs.task_ref, conformance: { in_scope: true } };
  let code = 0, stderr = "";
  try {
    execFileSync("bash", [COUNCIL, "--task-ref", rs.task_ref, "--packet", (() => { const p = join(mkdtempSync(join(tmpdir(), "u-")), "p.json"); writeFileSync(p, JSON.stringify(pkt)); return p; })(), "--min-voices", "2", "--providers", "claude,codex"],
      { env: { ...process.env, COUNCIL_RUN_MOCK: JSON.stringify({ claude: "APPROVED" }) }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { code = e.status; stderr = e.stderr; }
  assert.equal(code, 4);
  assert.match(stderr, /codex/);
  assert.match(stderr, /silent downgrade|#30/);
});
