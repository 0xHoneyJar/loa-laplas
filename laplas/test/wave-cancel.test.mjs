// S4.4 (+ the folded S3.4/x7l) — the unified DAG wave loop.
// AC-S4.4: cancel → no zombie workers, completed receipts preserved; a worker
//          ignoring cancel is killed after the drain timeout; timeout-during-drain
//          still emits a typed result.
// B7 (x7l): a failed item strands only its transitive DEPENDENTS; independent items
//           still complete (the old loop failed the WHOLE dag on first wave failure).
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cancellableWave, runDag } from "../lib/wave-cancel.mjs";
import { diagnose } from "../lib/diagnose.mjs";
import { stallExit } from "../lib/stall-exit.mjs";
import { validate } from "../lib/validate-schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const INCIDENT_SCHEMA = JSON.parse(readFileSync(join(here, "..", "schemas", "incident.schema.json"), "utf8"));
const NAMED_GAP_SCHEMA = JSON.parse(readFileSync(join(here, "..", "schemas", "named-gap.schema.json"), "utf8"));

const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const never = () => new Promise(() => {});
// mirrors the emitter's boundedParallel: concurrent, resolves when all settle.
const allParallel = async (thunks) => Promise.all(thunks.map((t) => t()));
// width=1 → strictly sequential (lets a leaf flip the signal BEFORE its siblings start).
const seqParallel = async (thunks) => { const out = []; for (const t of thunks) out.push(await t()); return out; };

// --- cancellableWave: the S4.4 primitive (signal + deadline injected) ---

test("normal completion preserves every receipt; no cancel, no drain", async () => {
  const r = await cancellableWave([() => "a", () => "b", () => "c"], { parallelFn: allParallel });
  assert.deepEqual(r.results, ["a", "b", "c"]);
  assert.equal(r.cancelled, false);
  assert.equal(r.drained, false);
});

test("AC-S4.4 — cooperative cancel: a stall skips not-yet-started siblings, the completed receipt survives", async () => {
  const signal = { cancelled: false };
  const thunks = [
    () => { signal.cancelled = true; return "A-done"; }, // A completes, then signals a stall
    () => "B-should-not-run",
    () => "C-should-not-run",
  ];
  const r = await cancellableWave(thunks, { parallelFn: seqParallel, signal });
  assert.equal(r.results[0], "A-done", "the already-completed sibling's receipt is preserved");
  assert.deepEqual(r.results[1], { __wave_cancelled: true, index: 1 }, "not-yet-started sibling is cooperatively skipped (no zombie)");
  assert.deepEqual(r.results[2], { __wave_cancelled: true, index: 2 });
  assert.equal(r.cancelled, true);
});

test("AC-S4.4 — a worker that ignores cancel is abandoned at the drain deadline; the wave still emits a typed result (no hang)", async () => {
  // two workers never resolve; the drain deadline fires → both abandoned, typed, bounded.
  const r = await cancellableWave([never, never], { parallelFn: allParallel, deadline: delay(5) });
  assert.equal(r.drained, true);
  assert.deepEqual(r.results[0], { __drain_timeout: true, index: 0 });
  assert.deepEqual(r.results[1], { __drain_timeout: true, index: 1 });
});

test("drain preserves a sibling that DID finish before the deadline, abandons only the laggard", async () => {
  const r = await cancellableWave(
    [() => delay(1, "fast"), never],
    { parallelFn: allParallel, deadline: delay(30) },
  );
  assert.equal(r.results[0], "fast", "the finished receipt is kept");
  assert.deepEqual(r.results[1], { __drain_timeout: true, index: 1 }, "only the laggard is abandoned");
  assert.equal(r.drained, true);
});

// --- runDag: the B7 stranding (folded S3.4 / x7l) ---

const ok = (it) => ({ output: it.id });
const boom = { __stage_failed: true, error: "boom" };

test("B7 — a failed item strands only its dependents; an independent item in the SAME wave still completes (no whole-dag abort)", async () => {
  const waves = [[{ id: "A" }, { id: "C" }], [{ id: "B", depends_on: ["A"] }]];
  const runItem = (it) => (it.id === "A" ? boom : ok(it));
  const r = await runDag(waves, { runItem, parallelFn: allParallel });
  assert.deepEqual(r.itemResults.C, { output: "C" }, "C is independent of A — it MUST complete even though A failed in the same wave");
  assert.equal(r.itemResults.A, undefined);
  assert.equal(r.itemResults.B, undefined, "B depends on the failed A — not run");
  assert.equal(r.failed.A.reason, "boom");
  assert.deepEqual(r.stranded.B, { reason: "DEPENDENCY_FAILED", failed_dep: "A" });
});

test("B7 — stranding is transitive; the independent branch survives end to end", async () => {
  const waves = [
    [{ id: "A" }, { id: "C" }],
    [{ id: "B", depends_on: ["A"] }, { id: "D", depends_on: ["C"] }],
    [{ id: "E", depends_on: ["B"] }],
  ];
  const runItem = (it) => (it.id === "A" ? boom : ok(it));
  const r = await runDag(waves, { runItem, parallelFn: allParallel });
  assert.deepEqual(Object.keys(r.itemResults).sort(), ["C", "D"], "the C→D branch is independent of A and completes");
  assert.equal(r.failed.A.reason, "boom");
  assert.equal(r.stranded.B.reason, "DEPENDENCY_FAILED");
  assert.equal(r.stranded.E.reason, "DEPENDENCY_FAILED", "E depends on the stranded B — transitively stranded");
  assert.equal(r.stranded.E.failed_dep, "B");
});

// --- the full Phase-1 stall path composes (S4.2 watchdog → S4.4 drain → S4.1 diagnose → S4.3 exit) ---

test("FR-4.5 stall path — a drained leaf flows diagnose → named_gap → stallExit(automated) → fail-loud incident", async () => {
  const waves = [[{ id: "slow", role: "builder", task: "long build" }]];
  const runItem = () => never();
  const makeWaveCancel = () => ({ signal: { cancelled: false }, deadline: delay(5) });
  const r = await runDag(waves, { runItem, parallelFn: allParallel, makeWaveCancel });
  assert.equal(r.drained, true);
  assert.deepEqual(r.stalled, ["slow"], "the abandoned leaf is recorded as stalled, not silently dropped");

  // the driver turns that stall into the FR-3↔FR-4.5 interface and a loud exit:
  const stalledLeaf = waves[0].find((it) => it.id === r.stalled[0]);
  const gap = diagnose(stalledLeaf, { stall_s: 90 });
  assert.deepEqual(validate(NAMED_GAP_SCHEMA, gap), [], "named_gap must be schema-valid");
  assert.ok(gap.missing_role.length > 0);

  const exit = stallExit(gap, "automated", { ts: "2026-06-14T00:00:00Z" });
  assert.equal(exit.action, "fail_loud");
  assert.ok(exit.exit_code !== 0);
  assert.equal(exit.incident.event, "stalled_no_summon");
  assert.deepEqual(validate(INCIDENT_SCHEMA, exit.incident), [], "the stall incident must conform to IMP-014");
});
