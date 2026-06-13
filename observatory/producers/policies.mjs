// policies — the agent seats, as PURE DECISION FUNCTIONS (SDD §3.5, IMP-005).
// decide({quality, clock, params}) → "read" | "present" | "clew"
//
// The behavioral contract (IMP-003, conformance-tested):
//   pure  — same state → same action (no RNG, no ambient reads, no memory)
//   total — every state in [0,1]×[0,1] returns an action from the enum
//   bounded — 'terminating' is not decidable for arbitrary functions (SP-B8);
//             the SIM enforces the tick cap and the test verifies the cap fires.
//
// Divergence claims are testable against these functions, not vibes:
//   greedy → reads past the need, floods clocks, meets the reaper
//   disciplined → presents well before the wall, ships CHECKPOINTs
//   stuck → models the quality-wall failure mode (S1.4): keeps reading while
//           progress exists, testifies (clew) at the plateau — per §3.3-amendment
//           the WALL is in the world, not the policy; this policy is honest
//           about recognizing it.

export const ACTIONS = ["read", "present", "clew"];

export const POLICIES = {
  greedy: {
    doc: "reads past the need; presents only when quality is undeniable or the wall is here",
    params: { presentAt: .8, panicAt: .96 },
    decide: ({ quality, clock, params }) =>
      quality >= params.presentAt || clock >= params.panicAt ? "present" : "read",
  },
  disciplined: {
    doc: "presents well before the flood; good-enough beats perfect-too-late",
    params: { presentAt: .55, panicAt: .6 },
    decide: ({ quality, clock, params }) =>
      quality >= params.presentAt || clock >= params.panicAt ? "present" : "read",
  },
  stuck: {
    doc: "honest at the wall: reads while progress exists, drops the clew at the plateau",
    params: { presentAt: .72, plateauGain: .02 },
    decide: ({ quality, clock, params, lastGain = Infinity }) =>
      quality >= params.presentAt ? "present"
      : lastGain <= params.plateauGain ? "clew"
      : "read",
  },
};

export const policyNames = () => Object.keys(POLICIES);
