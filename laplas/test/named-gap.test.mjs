// S4.1 (C9) — named_gap schema + GECKO diagnose sense.
// AC-S4.1: diagnose on a stalled fixture → schema-valid named_gap, non-empty missing_role.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../lib/validate-schema.mjs";
import { diagnose } from "../lib/diagnose.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(here, "..", "schemas", "named-gap.schema.json"), "utf8"));

test("AC-S4.1 — diagnose on a stalled leaf → schema-valid named_gap, non-empty missing_role", () => {
  const stalledLeaf = { id: "item-3", task: "write the migration", role: "db-migrator" };
  const gap = diagnose(stalledLeaf, { stall_s: 90 });
  assert.deepEqual(validate(SCHEMA, gap), [], `named_gap not schema-valid: ${JSON.stringify(gap)}`);
  assert.equal(gap.item_id, "item-3");
  assert.ok(gap.missing_role.length > 0, "missing_role must be non-empty");
  assert.equal(gap.missing_role, "db-migrator");
});

test("a stalled leaf with NO role still yields a non-empty missing_role (the schema floor)", () => {
  const gap = diagnose({ id: "x" }); // no role, no task
  assert.deepEqual(validate(SCHEMA, gap), []);
  assert.ok(gap.missing_role.length > 0);
  assert.equal(gap.missing_role, "unknown-specialist");
});

test("recommendation honours summon availability — no summon ⇒ escalate, not an action the exit can't take", () => {
  const summonable = diagnose({ id: "y", role: "auditor" });
  assert.equal(summonable.recommendation, "summon:auditor");
  const cannot = diagnose({ id: "y", role: "auditor" }, { summon_allowed: false });
  assert.equal(cannot.recommendation, "escalate");
  // both must remain schema-valid (recommendation pattern: re-quest|escalate|summon:<role>)
  assert.deepEqual(validate(SCHEMA, summonable), []);
  assert.deepEqual(validate(SCHEMA, cannot), []);
});

test("the schema rejects an empty missing_role and a malformed recommendation", () => {
  assert.ok(validate(SCHEMA, { item_id: "a", missing_role: "", recommendation: "escalate" }).some((e) => e.includes("minLength")));
  assert.ok(validate(SCHEMA, { item_id: "a", missing_role: "r", recommendation: "summon" }).length > 0, "bare 'summon' (no :role) must fail the recommendation pattern");
});
