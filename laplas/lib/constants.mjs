// constants.mjs — the §0.4 pinned constants (sprint plan, Flatline-sprint response).
// Single source; imported by the S1 deterministic core AND the S3 binary so the
// thresholds can never drift between layers.
export const CONFIDENCE_FLOOR = 0.6;        // default DAG confidence floor → below ⇒ serial
export const GOAL_MAX_BYTES = 16384;        // entry size cap → over ⇒ exit 7 (S2)
export const DETECTOR_TIMEOUT_MS = 2000;    // injection-detect.sh wall-clock (S2)
export const N_MAX_ITEMS = 16;              // dagValidate upper bound
export const CENTRALITY_THRESHOLD = 2;      // highCentrality fires at ≥ this
export const GATE_LATENCY_BOUND = 0.25;     // gate wall-clock ≤ 25% of wave time (G-6, S3)
export const SPLIT_RETRY = { retries: 1, backoff_ms: 2000 };  // split-goal (S3)
export const ROLE_RETRY = 2;                // role-hallucination retry-with-feedback (S3)
export const DEFAULT_STALL_S = 90;          // stall watchdog fallback when rel_policy.stall_s absent (S4, casual default)
export const STALL_DRAIN_TIMEOUT_MS = 5000; // wave-cancel bounded drain (Flatline-SDD D13): a sibling ignoring cancel is abandoned after this, the wave still emits a typed result
