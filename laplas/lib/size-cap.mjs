// size-cap.mjs — S2.0 the entry size cap (Flatline B1). The earliest gate on the
// untrusted goal: reject anything over GOAL_MAX_BYTES *before* it can reach the
// sentinel wrap, the injection detector, or the LLM. An unbounded goal is an
// unbounded-work DoS; the cap turns it into a typed refusal at the door (exit 7).
//
// Byte length, not character length — a multibyte goal must not slip a char cap.
import { GOAL_MAX_BYTES } from './constants.mjs';

export function checkSize(goal, max = GOAL_MAX_BYTES) {
  const bytes = Buffer.byteLength(String(goal ?? ''), 'utf8');
  if (bytes > max) {
    return { type: 'refusal', refusal_reason: 'GOAL_TOO_LARGE', exit: 7, detail: `${bytes} > ${max} bytes` };
  }
  return { type: 'ok', bytes };
}
