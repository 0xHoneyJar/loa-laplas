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

  // Boundary-integrity check (B10). A goal can collide with the sentinel two ways:
  //   (1) it contains our unguessable id (astronomically unlikely, checked anyway);
  //   (2) it contains sentinel tag syntax (`<goal …>` / `</goal>`). The id makes the
  //       OPENING tag unforgeable — but the CLOSING tag is not id-bound, so a literal
  //       `</goal>` would break the goal OUT of the envelope into the worker's instruction
  //       surface (the invariant only calls text *inside* the span data). The closing tag
  //       is the collision that matters. Either → security hard-block (exit 4). Reject, not
  //       escape: a legitimate goal almost never carries literal goal-tags, and reject is
  //       fail-closed (no second decode contract to keep in sync).
  if (text.includes(id) || /<\/?goal(\s|>|\/)/i.test(text)) {
    return { type: 'refusal', refusal_reason: 'SANITIZE_REJECT', exit: 4, detail: 'sentinel boundary collision' };
  }
  return { type: 'ok', id, wrapped: `<goal id="${id}">${text}</goal>` };
}
