// stall-exit.mjs — C10 Phase-1 stall exit (S4.3, FR-4.5).
//
// stallExit(named_gap, run_mode) is the terminal decision once a leaf has stalled
// and (in Phase 1) no summon has resolved it. It is run_mode-aware because the two
// runtimes have opposite correct behaviours:
//
//   interactive → SURFACE the named_gap and ESCALATE to the operator (the kaironic
//                 boundary). Never auto-proceed; the operator decides.
//   automated   → FAIL THE ITEM LOUD: a `stalled_no_summon` incident (IMP-014
//                 schema) + the named_gap + a re-quest recommendation, and a
//                 NONZERO exit. Never a silent retry / re-queue / block — a headless
//                 /simstim or cron run must see the stall, not hang or pretend.
//
// This module runs at the driver layer (real Node, not the emitted Workflow
// script), so Date is available; `ts` is still injectable for deterministic tests.

export const STALLED_NO_SUMMON = "stalled_no_summon"; // incident event (IMP-014 enum)
export const STALL_EXIT_CODE = 3;                     // nonzero, matches the P601 role-exhaustion class

export function stallExit(named_gap, run_mode = "automated", opts = {}) {
  if (!named_gap || !named_gap.item_id) throw new Error("stallExit: a named_gap with item_id is required");

  if (run_mode === "interactive") {
    // Kaironic boundary: hand the named_gap to the operator, do NOT proceed.
    return {
      action: "escalate",
      auto_proceed: false,
      exit_code: 0, // control returns to the operator; not a hard process failure
      named_gap,
      surface: `Leaf '${named_gap.item_id}' stalled — missing ${named_gap.missing_role}. ${named_gap.recommendation}. Operator decides.`,
      options: ["summon", "re-quest", "abort"],
    };
  }

  // automated: fail loud. The incident is the durable, aggregatable record (FR-G).
  const incident = {
    ts: opts.ts || new Date().toISOString(),
    event: STALLED_NO_SUMMON,
    actor: "watchdog",
    reason: `leaf '${named_gap.item_id}' stalled; missing_role=${named_gap.missing_role}; no summon available in automated run`,
    named_gap,
    recommendation: "re-quest",
  };
  if (opts.run_id) incident.run_id = opts.run_id; // omit when absent — a present `undefined` fails the schema's string type

  return {
    action: "fail_loud",
    auto_proceed: false, // explicit: never a silent re-queue
    exit_code: STALL_EXIT_CODE,
    named_gap,
    incident,
  };
}
