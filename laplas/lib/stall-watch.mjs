// stall-watch.mjs — C10 minimal stall watchdog (S4.2, Flatline-SDD B1).
//
// The §0.5 "progress" definition made operational: a leaf is *progressing* while
// it emits its OWN progress-bearing events (a tool call, an output token). A leaf
// that emits nothing for `stall_s` wall-seconds has stalled. The watchdog is
// per-leaf: one leaf's progress NEVER resets another leaf's timer (the bug a
// wave-global timer would have — a chatty sibling masking a silent stall).
//
// This is the *minimal* P1 trigger (the SDD is explicit: Phase 1.5 enriches this
// into full loiter telemetry; Phase 1 needs only the trigger). It reads time via
// an injected `clock.now()` so it is deterministic under test AND usable at any
// layer that HAS progress events (the runner/driver). The emitted Form-C workflow
// cannot read a clock (Date.now is banned in Workflow scripts) and has no
// intra-leaf progress feed, so it uses the setTimeout-race trigger in
// wave-cancel.mjs instead — this module is the canonical watchdog the
// progress-aware layers share.
//
//   const w = makeStallWatch({ stallMs, clock });
//   w.start(id);        // leaf entered the wave (arms its timer)
//   w.progress(id);     // the leaf's OWN event — resets ONLY its timer
//   w.stalled(id);      // true iff (now - lastOwnEvent) >= stallMs
//   w.done(id);         // leaf finished (disarms)
//   w.stalledIds();     // every currently-stalled, still-pending leaf

export function makeStallWatch({ stallMs, clock } = {}) {
  if (!(stallMs > 0)) throw new Error("makeStallWatch: stallMs must be a positive number of ms");
  if (!clock || typeof clock.now !== "function") throw new Error("makeStallWatch: clock.now() is required (Date.now is banned in emitted workflows; inject the clock)");
  const last = new Map(); // id -> timestamp of its last OWN progress event

  const touch = (id) => last.set(id, clock.now());

  return {
    start(id) { touch(id); },
    // A leaf's own tool/output event resets ONLY that leaf's timer. progress() on
    // an unknown/finished id is a no-op (never resurrects a disarmed leaf).
    progress(id) { if (last.has(id)) touch(id); },
    stalled(id) {
      const t = last.get(id);
      return t != null && (clock.now() - t) >= stallMs;
    },
    done(id) { last.delete(id); },
    pending() { return [...last.keys()]; },
    stalledIds() {
      const now = clock.now();
      return [...last.entries()].filter(([, t]) => (now - t) >= stallMs).map(([id]) => id);
    },
  };
}
