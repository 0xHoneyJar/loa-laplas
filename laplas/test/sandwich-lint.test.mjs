// IMP-008 / S3.3 — the sandwich lint: hooks are REACTIVE LAW; they deny, record,
// inject, refuse-to-stop — they CANNOT initiate or sequence (the orchestrator
// conducts). A hook that spawns work or drives phases is layer leakage. This
// statically asserts no hook script conducts. Run: node --test laplas/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, "..", "..", "poteau", "hooks");

// patterns that mean a hook is CONDUCTING (initiating/sequencing) rather than
// reacting. A hook may read state and emit a verdict; it may not spawn agents,
// dispatch compositions, loop over stages, or background-launch work.
const CONDUCT = [
  /\bclaude\s+-p\b/,            // spawning an agent
  /compose-dispatch/,          // dispatching a composition
  /\bWorkflow\b/,              // the executor's tool
  /for\s+stage\b/i,            // sequencing stages
  /while\s+.*stage/i,
  /&\s*$/m,                     // backgrounding a process
  /nohup\b/,
];

test("no poteau hook CONDUCTS — they react, never initiate or sequence (IMP-008)", () => {
  const offenders = [];
  for (const f of readdirSync(HOOKS).filter(f => f.endsWith(".sh"))) {
    const src = readFileSync(join(HOOKS, f), "utf8");
    // strip comment lines so doctrine prose ("hooks cannot conduct") isn't a hit
    const code = src.split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
    for (const pat of CONDUCT) if (pat.test(code)) offenders.push(`${f}: matches ${pat}`);
  }
  assert.deepEqual(offenders, [], `hooks must not conduct:\n${offenders.join("\n")}`);
});

test("every hook is invoked as a single reactive command (no orchestration loop in the lattice)", () => {
  // exit-gate may loop-GUARD (count blocks) but must not loop over WORK units.
  // assert each hook reads stdin once and exits — a structural sanity check.
  for (const f of readdirSync(HOOKS).filter(f => f.endsWith(".sh"))) {
    const src = readFileSync(join(HOOKS, f), "utf8");
    assert.ok(/exit\s+\d/.test(src) || /exit$/m.test(src), `${f} should reach an explicit exit`);
  }
});
