// sanitize-goal.mjs — S2.2 the injection-detector boundary (Flatline B2-CRIT, B3).
// Runs the untrusted goal past injection-detect.sh and bands the raw score:
//   score ≥ BLOCK_SCORE            → hard block      (SANITIZE_REJECT, exit 4)
//   CONTAIN_SCORE ≤ score < block  → proceed CONTAINED (advisory; S2.2b locks the floor)
//   score < CONTAIN_SCORE          → clean
//
// Two non-negotiables from Flatline, both asserted by tests:
//   B3 — the goal reaches the detector via STDIN only; it never appears in argv.
//   B2 — the detector runs under a hard DETECTOR_TIMEOUT_MS wall-clock. A detector that
//        does not answer in time is fail-CLOSED: block (DETECTOR_TIMEOUT, exit 4), never
//        proceed. A hung detector must never become a bypass. EVERY non-clean outcome
//        (timeout, crash, unparseable output) fails closed.
//
// The detector exits 0 for both PASS and DETECTED — the numeric score is the signal, so
// we run it at --threshold 0 and band the score ourselves.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DETECTOR_TIMEOUT_MS } from './constants.mjs';

export const BLOCK_SCORE = 0.7;   // ≥ this → hard block
export const CONTAIN_SCORE = 0.4; // ≥ this (and below block) → proceed under containment

const DEFAULT_DETECTOR = fileURLToPath(new URL('../../.claude/scripts/injection-detect.sh', import.meta.url));
const reject = (refusal_reason, detail) => ({ type: 'refusal', refusal_reason, exit: 4, detail });

export function sanitizeGoal(goal, opts = {}) {
  const detector = opts.detector ?? DEFAULT_DETECTOR;
  const timeoutMs = opts.timeoutMs ?? DETECTOR_TIMEOUT_MS;
  const spawn = opts.spawn ?? spawnSync; // injectable boundary (Flatline D8) — also the B3 test seam
  const text = String(goal ?? '');

  // B3: goal on stdin (`input`); argv carries only the threshold flag, never the goal.
  const res = spawn(detector, ['--threshold', '0'], {
    input: text, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 20,
  });

  // B2: timeout → fail-closed. spawnSync flags ETIMEDOUT and SIGTERM-kills the child.
  if (res?.error?.code === 'ETIMEDOUT' || res?.signal === 'SIGTERM') {
    return reject('DETECTOR_TIMEOUT', `detector exceeded ${timeoutMs}ms`);
  }

  // Parse the score regardless of exit status (both bands exit 0). No score → fail-closed.
  let score = NaN;
  try { score = Number(JSON.parse(res?.stdout ?? '').score); } catch { /* unparseable → fail-closed below */ }
  if (res?.error || !Number.isFinite(score)) {
    return reject('SANITIZE_REJECT', `detector unavailable or unparseable: ${res?.error?.message ?? 'bad output'}`);
  }

  if (score >= (opts.blockScore ?? BLOCK_SCORE)) return reject('SANITIZE_REJECT', `injection score ${score}`);
  if (score >= (opts.containScore ?? CONTAIN_SCORE)) return { type: 'ok', contained: true, score };
  return { type: 'ok', contained: false, score };
}
