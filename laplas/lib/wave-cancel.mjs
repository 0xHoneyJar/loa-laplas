// wave-cancel.mjs — the unified DAG wave loop (S4.4 + the folded S3.4/x7l).
//
// TWO behaviours the old emitter loop (segment-emitter.py) did NOT have, in ONE
// place so they cannot drift between the kit and the emitted runtime:
//
//   B7 / S3.4 (DEPENDENCY_FAILED stranding): a failed item strands only its
//     transitive DEPENDENTS — independent items in the same and later waves still
//     run. The old loop failed the WHOLE dag on the first wave failure (x7l).
//     Pure control flow; NO timers; ALWAYS in force.
//
//   B11+D13 / S4.4 (cooperative cancel + bounded drain): when a leaf stalls, the
//     not-yet-started siblings in its wave are cooperatively SKIPPED (signal), the
//     in-flight siblings are DRAINED, and any still-running after the drain DEADLINE
//     is ABANDONED — the wave still emits a typed result, no indefinite hang, no
//     zombie. Already-completed siblings' receipts are preserved.
//
// SEPARATION OF CONCERNS (why this primitive is pure and fully unit-testable):
//   * the PRIMITIVE takes the cancel `signal` and the drain `deadline` as INJECTED
//     inputs — it reads no clock and arms no timer. Cooperative-skip, drain-abandon,
//     and receipt-preservation are therefore exercised deterministically in tests by
//     flipping `signal` and resolving `deadline` by hand.
//   * the emitter owns the ONE integration-only piece: wiring per-leaf stall timers
//     (setTimeout, IF the Workflow sandbox provides it — Date.now is banned and
//     setTimeout is unverified there) to FLIP the signal and resolve the deadline.
//     When the sandbox has no timers, the emitter passes a signal that never flips
//     and no deadline, so this loop degrades GRACEFULLY to B7-stranding-only.
//
// The block between >>>INLINE / <<<INLINE is extracted VERBATIM by
// segment-emitter.py (_inline_block) into the workflow preamble — it is therefore
// global-free: every dependency arrives through opts.

// >>>INLINE wave-cancel (single source — segment-emitter.py emits this block verbatim)
// cancellableWave(thunks, opts) -> { results, cancelled, drained }
//   opts:
//     parallelFn(thunks)  — runs thunks concurrently, resolves when all settle
//                           (the emitter passes boundedParallel bound by gate_batch_max)
//     signal = { cancelled } — cooperative cancel; a not-yet-started thunk seeing
//                           cancelled===true SKIPS (no tokens, no zombie). The emitter
//                           flips this from a per-leaf stall timer; the driver flips it
//                           from stall-watch. Absent ⇒ never cancels.
//     deadline           — a Promise; when it resolves, stop AWAITING in-flight thunks
//                           and emit (the bounded drain / D13 hard-kill). Absent ⇒ wait
//                           for natural completion (no wall-clock bound).
async function cancellableWave(thunks, opts) {
  const { parallelFn, signal = { cancelled: false }, deadline = null } = opts;
  const n = thunks.length;
  const out = new Array(n).fill(undefined); // settled results; SURVIVES abandonment of parallelFn
  const settled = new Array(n).fill(false);

  const wrapped = thunks.map((thunk, i) => async () => {
    if (signal.cancelled) { // cooperative skip — this sibling never starts
      out[i] = { __wave_cancelled: true, index: i };
      settled[i] = true;
      return out[i];
    }
    let r;
    try { r = await Promise.resolve().then(thunk); }
    catch (e) { r = { __wave_thrown: true, index: i, error: (e && e.message) ? e.message : String(e) }; }
    out[i] = r;
    settled[i] = true;
    return r;
  });

  const ran = Promise.resolve().then(() => parallelFn(wrapped)).then(() => "__complete");
  const outcome = deadline
    ? await Promise.race([ran, Promise.resolve().then(() => deadline).then(() => "__drain_deadline")])
    : await ran;

  // anything not settled when the deadline won the race is an abandoned laggard
  // (we cannot abort the promise — we stop awaiting it; the runtime concurrency cap
  // reclaims the slot). It still gets a TYPED result, never a silent gap.
  for (let i = 0; i < n; i++) if (!settled[i]) out[i] = { __drain_timeout: true, index: i };
  return { results: out, cancelled: signal.cancelled, drained: outcome === "__drain_deadline" };
}

// runDag(waves, opts) -> { itemResults, failed, stranded, stalled, drained }
//   waves: id-bearing items in Kahn layers (deps always in earlier waves)
//   opts (in addition to cancellableWave's): runItem(it, done) -> result
//   The cancel `signal`/`deadline` are per-CALL here; the emitter builds a fresh
//   pair per wave (a stall in wave w cancels only wave w's in-flight siblings).
async function runDag(waves, opts) {
  const { runItem, makeWaveCancel } = opts;
  const itemResults = {}; // id -> result (preserved receipts across ALL waves)
  const failed = {};      // id -> { reason, detail? }
  const stranded = {};    // id -> { reason: "DEPENDENCY_FAILED", failed_dep }
  const stalled = [];
  let drained = false;

  for (let w = 0; w < waves.length; w++) { // NO early abort — every wave is visited (B7)
    const wave = waves[w];
    const toRun = [];
    for (const it of wave) {
      // strand iff a DIRECT dependency died; Kahn layering makes this transitively
      // correct (a stranded item is itself "dead" for its own dependents next wave).
      const deadDep = (it.depends_on || []).find((d) => failed[d] || stranded[d]);
      if (deadDep) { stranded[it.id] = { reason: "DEPENDENCY_FAILED", failed_dep: deadDep }; continue; }
      toRun.push(it);
    }
    if (!toRun.length) continue; // whole wave stranded; INDEPENDENT later waves still run

    // a fresh cancel signal + drain deadline for THIS wave (emitter wires the timers;
    // tests inject a controllable pair; absent ⇒ { signal:{cancelled:false} }).
    const wc = makeWaveCancel ? makeWaveCancel(toRun) : { signal: { cancelled: false }, deadline: null };
    const thunks = toRun.map((it) => () => runItem(it, itemResults, wc.signal));
    let wave_out;
    try { wave_out = await cancellableWave(thunks, { ...opts, signal: wc.signal, deadline: wc.deadline }); }
    finally { if (wc.cleanup) wc.cleanup(); } // release the wave's timers (emitter wiring); no-op in tests
    if (wave_out.drained) drained = true;

    for (let i = 0; i < toRun.length; i++) {
      const id = toRun[i].id;
      const r = wave_out.results[i];
      // the staller and any laggard are abandoned at the drain deadline and recorded as
      // stalled — cancellableWave reports a stall ONLY via __drain_timeout (the deadline is
      // the single trigger; there is no separate __wave_stalled sentinel).
      if (r && r.__drain_timeout) { failed[id] = { reason: "drain_timeout" }; stalled.push(id); continue; }
      if (r && r.__wave_cancelled) { failed[id] = { reason: "wave_cancelled" }; continue; } // skipped sibling ⇒ its dependents strand
      if (r && r.__wave_thrown) { failed[id] = { reason: "threw", detail: r }; continue; }
      if (r === null) { failed[id] = { reason: "operator_skip" }; continue; }
      if (r && r.__stage_failed) { failed[id] = { reason: r.error || "stage_failed", detail: r }; continue; }
      itemResults[id] = r; // success — receipt preserved
    }
  }
  return { itemResults, failed, stranded, stalled, drained };
}
// <<<INLINE wave-cancel

export { cancellableWave, runDag };
