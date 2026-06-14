// S4.3 (C10) — the Phase-1 stall exit (FR-4.5).
// AC-S4.3: automated + stall → fail-loud STALLED_NO_SUMMON + named_gap, nonzero, no
//          silent re-queue; interactive + stall → escalation, no auto-proceed.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../lib/validate-schema.mjs";
import { stallExit, STALLED_NO_SUMMON, STALL_EXIT_CODE } from "../lib/stall-exit.mjs";
import { diagnose } from "../lib/diagnose.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const INCIDENT_SCHEMA = JSON.parse(readFileSync(join(here, "..", "schemas", "incident.schema.json"), "utf8"));
const NAMED_GAP_SCHEMA = JSON.parse(readFileSync(join(here, "..", "schemas", "named-gap.schema.json"), "utf8"));

const gapFor = (id) => diagnose({ id, role: "specialist" }, { stall_s: 90 });

test("AC-S4.3 — automated + stall → fail-loud stalled_no_summon, nonzero, named_gap carried, no auto-proceed", () => {
  const gap = gapFor("item-7");
  const r = stallExit(gap, "automated", { ts: "2026-06-14T00:00:00Z", run_id: "run-x" });
  assert.equal(r.action, "fail_loud");
  assert.equal(r.auto_proceed, false, "an automated stall must NEVER silently re-queue/proceed");
  assert.ok(r.exit_code !== 0, "nonzero exit");
  assert.equal(r.exit_code, STALL_EXIT_CODE);
  assert.equal(r.incident.event, STALLED_NO_SUMMON);
  assert.equal(r.incident.recommendation, "re-quest");
  // the incident conforms to the IMP-014 incident schema (so FR-G telemetry aggregates it)
  assert.deepEqual(validate(INCIDENT_SCHEMA, r.incident), [], `incident not schema-valid: ${JSON.stringify(r.incident)}`);
  // and the named_gap it carries is itself schema-valid
  assert.deepEqual(validate(NAMED_GAP_SCHEMA, r.incident.named_gap), []);
});

test("AC-S4.3 — interactive + stall → escalation to the operator, no auto-proceed", () => {
  const gap = gapFor("item-7");
  const r = stallExit(gap, "interactive");
  assert.equal(r.action, "escalate");
  assert.equal(r.auto_proceed, false, "interactive stall surfaces to the operator — never auto-proceeds");
  assert.equal(r.exit_code, 0, "control returns to the operator; not a hard process failure");
  assert.ok(Array.isArray(r.options) && r.options.length > 0);
  assert.ok(/stalled/i.test(r.surface));
});

test("the incident schema now admits stalled_no_summon (and still rejects an unknown event)", () => {
  assert.deepEqual(validate(INCIDENT_SCHEMA, { ts: "t", event: STALLED_NO_SUMMON }), []);
  assert.ok(validate(INCIDENT_SCHEMA, { ts: "t", event: "mystery" }).some((e) => e.includes("enum")));
});

test("stallExit refuses a malformed named_gap (load-bearing field, fail-closed)", () => {
  assert.throws(() => stallExit({}, "automated"), /item_id/);
});
