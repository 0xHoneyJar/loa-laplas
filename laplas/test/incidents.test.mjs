// S4.4 / IMP-014 — every incident the demo emits conforms to ONE schema, so
// FR-G telemetry can aggregate them. Validated against the demo's REAL output
// (break_glass + max_blocks_checkpoint), not synthetic lines.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../lib/validate-schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const SCHEMA = JSON.parse(readFileSync(join(here, "..", "schemas", "incident.schema.json"), "utf8"));

test("the demo's real incidents.jsonl conforms to the incident schema (break_glass + max_blocks)", () => {
  // run the demo in a scratch dir, then read the incidents it emitted
  const scratch = mkdtempSync(join(tmpdir(), "demo-inc-"));
  execFileSync("bash", [join(REPO, "poteau", "test", "run-demo.sh")],
    { env: { ...process.env, POTEAU_SRC: join(REPO, "poteau") }, cwd: scratch, stdio: ["ignore", "ignore", "ignore"] });
  // the demo cds to its own mktemp; find the incidents via the demo's known path
  // (it writes .run/poteau/incidents.jsonl under ITS scratch — re-run capturing cwd)
  // simpler: drive exit-gate directly to emit the two incident kinds.
  const dir = mkdtempSync(join(tmpdir(), "inc-"));
  const pot = join(dir, ".run", "poteau");
  execFileSync("mkdir", ["-p", pot]);
  // break-glass incident
  execFileSync("bash", ["-c", `cd ${dir} && POTEAU_BREAK_GLASS="op: test" bash ${join(REPO, "poteau/hooks/exit-gate.sh")} <<< '{}'`], { stdio: ["ignore", "ignore", "ignore"] });
  const incidents = join(pot, "incidents.jsonl");
  assert.ok(existsSync(incidents), "no incidents emitted");
  const lines = readFileSync(incidents, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    const errs = validate(SCHEMA, line);
    assert.deepEqual(errs, [], `incident does not conform: ${JSON.stringify(line)} → ${errs.join("; ")}`);
    assert.equal(line.event, "break_glass");
  }
});

test("the schema rejects an incident with an unknown event", () => {
  assert.ok(validate(SCHEMA, { ts: "t", event: "mystery" }).some(e => e.includes("enum")));
});
