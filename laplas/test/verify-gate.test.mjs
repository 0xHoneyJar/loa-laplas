// S3.4b: verify-gate --poteau, adoption-aligned (T4) + the #7 benchmark.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const VERIFY = join(REPO, "scripts", "compose-verify-run.sh");

// build a minimal-but-real compiled+executed run dir under a temp base, then
// optionally arm it with a poteau receipt chain. Returns {base, runId}.
function makeRun({ poteau = "none" } = {}) {
  const base = mkdtempSync(join(tmpdir(), "vg-"));
  const runId = "20260613-aaaaaa";
  const dir = join(base, runId);
  mkdirSync(join(dir, "envelopes"), { recursive: true });
  writeFileSync(join(dir, "form-c-manifest.json"), JSON.stringify({ run_id: runId, segments: ["s1"], created_by: "test" }));
  mkdirSync(join(dir, "workflows"), { recursive: true });
  writeFileSync(join(dir, "workflows", "comp.segment-1.workflow.js"), "// seg");
  writeFileSync(join(dir, "orchestrator.jsonl"),
    JSON.stringify({ run_id: runId, event: "form_c.manifest", timestamp: "2026-06-13T00:00:00Z" }) + "\n" +
    JSON.stringify({ run_id: runId, event: "seg", timestamp: "2026-06-13T00:00:01Z" }) + "\n");
  writeFileSync(join(dir, "envelopes", "e1.json"), JSON.stringify({ from: "a", to: "b", verdict: "APPROVED" }));

  // poteau side lives at REPO/.run/poteau/<runId> (the script anchors there)
  const pot = join(REPO, ".run", "poteau", runId);
  rmSync(pot, { recursive: true, force: true });
  if (poteau !== "none") {
    mkdirSync(pot, { recursive: true });
    writeFileSync(join(pot, "run-state.json"), JSON.stringify({ run_id: runId, gate_index: 1 }));
    if (poteau === "good") {
      const r1 = { receipt: { run_id: runId, gate_index: 0, prev_receipt_hash: null }, receipt_hash: "h1" };
      const r2 = { receipt: { run_id: runId, gate_index: 1, prev_receipt_hash: "h1" }, receipt_hash: "h2" };
      writeFileSync(join(pot, "receipts.jsonl"), JSON.stringify(r1) + "\n" + JSON.stringify(r2) + "\n");
    } else if (poteau === "broken-chain") {
      const r1 = { receipt: { run_id: runId, gate_index: 0, prev_receipt_hash: null }, receipt_hash: "h1" };
      const r2 = { receipt: { run_id: runId, gate_index: 1, prev_receipt_hash: "WRONG" }, receipt_hash: "h2" };
      writeFileSync(join(pot, "receipts.jsonl"), JSON.stringify(r1) + "\n" + JSON.stringify(r2) + "\n");
    }
    // "armed-no-receipts" leaves run-state but writes no receipts.jsonl
  }
  return { base, runId, pot };
}
function verify(base, runId) {
  try {
    const out = execFileSync("bash", [VERIFY, runId, "--poteau", "--json", "--base-dir", base], { encoding: "utf8" });
    return { code: 0, ...JSON.parse(out) };
  } catch (e) { return { code: e.status, ...(JSON.parse(e.stdout || "{}")) }; }
}

test("#7 benchmark — an UNARMED run verifies legacy with governance:unarmed (never a late trap)", () => {
  const { base, runId, pot } = makeRun({ poteau: "none" });
  const v = verify(base, runId);
  rmSync(pot, { recursive: true, force: true });
  assert.equal(v.verdict, "valid_run");
  assert.equal(v.governance, "unarmed");
});

test("an ARMED run with a clean receipt chain → valid_run, governance:armed", () => {
  const { base, runId, pot } = makeRun({ poteau: "good" });
  const v = verify(base, runId);
  rmSync(pot, { recursive: true, force: true });
  assert.equal(v.verdict, "valid_run");
  assert.equal(v.governance, "armed");
});

test("an ARMED run that emitted NO receipts → broken_run (#7: governed path abandoned mid-run)", () => {
  const { base, runId, pot } = makeRun({ poteau: "armed-no-receipts" });
  const v = verify(base, runId);
  rmSync(pot, { recursive: true, force: true });
  assert.equal(v.verdict, "broken_run");
});

test("IMP-011 — a broken/spliced receipt chain → broken_run", () => {
  const { base, runId, pot } = makeRun({ poteau: "broken-chain" });
  const v = verify(base, runId);
  rmSync(pot, { recursive: true, force: true });
  assert.equal(v.verdict, "broken_run");
});
