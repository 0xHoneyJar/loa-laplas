// Proves the bridgebuilder PR-review findings are fixed (the review found these;
// the fix ships with the test). Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GK = join(here, "..", "..", "poteau", "bin", "poteau-gatekeeper.mjs");

// run the gatekeeper in an isolated cwd so receipt writes are sandboxed
function judge(input) {
  const cwd = mkdtempSync(join(tmpdir(), "gkf-"));
  let out, exitCode = 0;
  try { out = execFileSync(process.execPath, [GK], { input: JSON.stringify(input), encoding: "utf8", cwd }); }
  catch (e) { out = e.stdout; exitCode = e.status; }
  return { cwd, exitCode, ...JSON.parse(out) };
}
const conformingPacket = (rs) => ({
  verdict: "APPROVED", rationale: "done within scope", task_ref: rs.task_ref ?? null,
  conformance: { in_scope: true },
});

test("[high fix] an armed run mints receipts RUN-SCOPED at .run/poteau/<run_id>/receipts.jsonl", () => {
  const rs = { run_id: "rid-xyz", armed_at: "2026-06-13T00:00:00Z", gate_index: 0 };
  const r = judge({ run_state: rs, packet: { verdict: "APPROVED", rationale: "x" } });
  assert.equal(r.pass, true);
  assert.ok(existsSync(join(r.cwd, ".run/poteau/rid-xyz/receipts.jsonl")), "receipts not run-scoped");
  assert.ok(!existsSync(join(r.cwd, ".run/poteau/receipts.jsonl")), "flat chain must NOT exist (the bug)");
  const rec = JSON.parse(readFileSync(join(r.cwd, ".run/poteau/rid-xyz/receipts.jsonl"), "utf8").trim());
  assert.equal(rec.receipt.run_id, "rid-xyz");
});

test("[high fix] a run-state with NO run_id REFUSES P500 — never mints an 'unarmed' receipt", () => {
  const r = judge({ run_state: { gate_index: 0 }, packet: { verdict: "APPROVED", rationale: "x" } });
  assert.equal(r.exitCode, 5);
  assert.equal(r.pass, false);
  assert.equal(r.refusal.includes("run_id"), true);
  assert.ok(!existsSync(join(r.cwd, ".run/poteau/unarmed/receipts.jsonl")), "must not mint an 'unarmed' chain");
});

test("[medium fix] IMP-011 — a receipt predating armed_at is refused P500", () => {
  // armed_at far in the FUTURE → the mint's ts (now) predates it → refuse
  const rs = { run_id: "rid-future", armed_at: "2099-01-01T00:00:00Z", gate_index: 0 };
  const r = judge({ run_state: rs, packet: { verdict: "APPROVED", rationale: "x" } });
  assert.equal(r.exitCode, 5);
  assert.match(r.refusal, /IMP-011|predates/);
});

test("custody still fails closed on malformed stdin (P500, exit 5)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gkf-"));
  let code = 0, out = "";
  try { execFileSync(process.execPath, [GK], { input: "not json {{{", encoding: "utf8", cwd }); }
  catch (e) { code = e.status; out = e.stdout; }
  assert.equal(code, 5);
  assert.match(JSON.parse(out).code, /P500/);
});
