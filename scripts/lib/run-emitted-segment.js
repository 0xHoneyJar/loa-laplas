#!/usr/bin/env node
/**
 * run-emitted-segment.js — dry-run an emitted Form C segment with SCRIPTED agent
 * responses, no token spend. Emulates the Claude Code Workflow runtime wrap (the
 * same wrap workflow-syntax-check.js uses) and stubs agent()/parallel()/log()/phase().
 *
 * agent() returns the response keyed by its opts.agentType (a fixed per-construct
 * response, so retries are deterministic), or null if no key matches (operator-skip).
 * A response of the literal string "__THROW__" makes agent() throw (to exercise the
 * sync-throw / sentinel path).
 *
 * Usage:
 *   run-emitted-segment.js <emitted.workflow.js> '<responsesByAgentTypeJSON>' ['<argsJSON>']
 * Prints the segment's return value as JSON. Exit 0 on success, 1 on harness error.
 */
const fs = require("fs");

const file = process.argv[2];
if (!file) { console.error("usage: run-emitted-segment.js <file> <responsesJSON> [argsJSON]"); process.exit(2); }
const responses = JSON.parse(process.argv[3] || "{}");
const args = JSON.parse(process.argv[4] || "{}");

const src = fs.readFileSync(file, "utf8")
  .replace(/export const /g, "const ")
  .replace(/export default /g, "");

const agent = async (prompt, opts) => {
  const k = opts && opts.agentType;
  if (k && Object.prototype.hasOwnProperty.call(responses, k)) {
    const r = responses[k];
    if (r === "__THROW__") throw new Error("scripted throw for " + k);
    return r;
  }
  return null; // no scripted response → operator-skip
};
// parallel/pipeline stubs (the iterating/sequential bodies don't use them, but the
// emitted boundedParallel definition references parallel()).
const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));
const pipeline = async () => { throw new Error("pipeline not stubbed in this harness"); };
const log = () => {};
const phase = () => {};
const budget = { total: null, spent: () => 0, remaining: () => Infinity };
const workflow = async () => null;

(async () => {
  const fn = new Function(
    "args", "agent", "parallel", "pipeline", "log", "phase", "budget", "workflow",
    '"use strict";\nreturn (async () => {\n' + src + "\n})();"
  );
  const out = await fn(args, agent, parallel, pipeline, log, phase, budget, workflow);
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error("HARNESS ERROR: " + (e && e.message ? e.message : String(e))); process.exit(1); });
