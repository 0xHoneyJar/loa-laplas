// S4.2 (C10) — the minimal stall_s watchdog.
// AC-S4.2 (§0.5 "progress"): the timer resets on the leaf's OWN tool/output event,
// not on a sibling's; no progress for stall_s → the stall fires.
// Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStallWatch } from "../lib/stall-watch.mjs";

// a deterministic injected clock — the watchdog reads time ONLY through clock.now().
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("AC-S4.2 — a leaf with no progress for stall_s fires the stall", () => {
  const clock = fakeClock();
  const w = makeStallWatch({ stallMs: 1000, clock });
  w.start("A");
  assert.equal(w.stalled("A"), false);
  clock.advance(999);
  assert.equal(w.stalled("A"), false, "just under stall_s is not yet a stall");
  clock.advance(1);
  assert.equal(w.stalled("A"), true, "at exactly stall_s the stall fires");
});

test("AC-S4.2 — progress resets ONLY the leaf's OWN timer, never a sibling's", () => {
  const clock = fakeClock();
  const w = makeStallWatch({ stallMs: 1000, clock });
  w.start("A");
  w.start("B");
  clock.advance(999);
  w.progress("A");          // A emits its own event — A's timer resets, B's does NOT
  clock.advance(2);         // A: 2ms since reset; B: 1001ms since start
  assert.equal(w.stalled("A"), false, "A reset on its own event — not stalled");
  assert.equal(w.stalled("B"), true, "B got no progress — a chatty sibling must NOT mask B's stall");
  assert.deepEqual(w.stalledIds(), ["B"]);
});

test("progress on a finished/unknown leaf is a no-op (never resurrects a disarmed timer)", () => {
  const clock = fakeClock();
  const w = makeStallWatch({ stallMs: 100, clock });
  w.start("A");
  w.done("A");
  w.progress("A");          // A is disarmed — this must not re-add it
  clock.advance(1000);
  assert.equal(w.stalled("A"), false);
  assert.deepEqual(w.pending(), []);
});

test("makeStallWatch refuses a missing clock (Date.now is banned in emitted workflows)", () => {
  assert.throws(() => makeStallWatch({ stallMs: 100 }), /clock\.now/);
  assert.throws(() => makeStallWatch({ clock: { now: () => 0 } }), /stallMs/);
});
