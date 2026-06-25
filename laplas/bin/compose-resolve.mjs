#!/usr/bin/env node
// compose-resolve.mjs — S3.3 the /compose driver CLI. Given a bare goal (and a module for the
// roster), prints the driver decision the /compose executor branches on:
//   { mode:'fanout', items:[…emitter-shaped…], gate_batch_max, stall_s } |
//   { mode:'single', goal, fallback_reason } |
//   { mode:'refuse', refusal_reason, exit }
// The pre-supplied-items[] bypass (D10) lives in the executor: if items[] were already passed,
// it never calls this CLI, so the existing RFC #35 path is byte-for-byte unchanged.
//
// Thin glue over the unit-tested resolveComposeItems; the real LLM call is the (runtime-only)
// claude provider. Exits nonzero on `refuse` so the "do not run" branch is shell-checkable.
import { resolveComposeItems } from '../lib/compose-items.mjs';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
// `--goal -` reads the goal from STDIN, so skills/compose/SKILL.md can PIPE an untrusted
// goal rather than interpolate it into the shell argv (S3.3 audit MEDIUM-1, bead qb4).
let goal = get('--goal');
if (goal === '-') goal = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const modulePath = get('--module');
if (goal == null) { console.error('compose-resolve: --goal <str> (or --goal - to read the goal from stdin) required'); process.exit(2); }

const { defaultProvider } = await import('../lib/claude-provider.mjs');
const decision = await resolveComposeItems({ goal, modulePath, provider: defaultProvider });
console.log(JSON.stringify(decision));
process.exit(decision.mode === 'refuse' ? (decision.exit || 1) : 0);
