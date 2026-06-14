// sentinel.mjs — S2.1 the goal boundary (C11, Flatline B10). Wrap the untrusted goal
// in a per-call random-UUID-tagged envelope so the worker — and the gate — can tell the
// trusted goal span from anything the goal *contains*. The UUID is fresh on every call:
// an attacker cannot pre-close, or forge, a boundary tag they cannot predict.
//
//   <goal id="{uuid}">{the untrusted goal, verbatim}</goal>
//
// The gate (S2.4) later checks that worker output is bound to this exact id.
import { randomUUID } from 'node:crypto';

export function sentinelWrap(goal, opts = {}) {
  const text = String(goal ?? '');
  const id = opts.uuid ?? randomUUID(); // opts.uuid is a test seam only

  // Collision check (B10): the goal must not already contain our boundary id. With a v4
  // UUID this is astronomically unlikely — but "unlikely" is not "impossible", and a
  // boundary the goal can name is no boundary at all. Detected → security hard-block.
  if (text.includes(id)) {
    return { type: 'refusal', refusal_reason: 'SANITIZE_REJECT', exit: 4, detail: 'sentinel id collision' };
  }
  return { type: 'ok', id, wrapped: `<goal id="${id}">${text}</goal>` };
}
