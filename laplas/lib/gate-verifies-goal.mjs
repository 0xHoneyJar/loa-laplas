// gate-verifies-goal.mjs — S2.4 the gate-verifies-goal contract (C11). The gate trusts
// what it can VERIFY, not what the worker REPORTS. A worker can always return
// {success:true}; the gate accepts it only when the output is bound to the exact sentinel
// id the gate issued (S2.1). A success self-report carrying a different — or missing —
// sentinel is the signature of a worker that answered an *injected* goal, or a plain task
// mismatch. Either way it is caught here, before the result is believed.
export function gateVerifiesGoal(issued = {}, claim = {}) {
  if (!issued.sentinelId) return { verified: false, reason: 'NO_ISSUED_SENTINEL' };
  if (claim.sentinelId !== issued.sentinelId) {
    return {
      verified: false,
      reason: 'SENTINEL_MISMATCH',
      detail: `issued ${issued.sentinelId}, output ${claim.sentinelId ?? 'none'}`,
    };
  }
  if (claim.success !== true) return { verified: false, reason: 'NOT_SUCCESS' };
  return { verified: true };
}
