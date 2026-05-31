#!/usr/bin/env node
/**
 * workflow-syntax-check.js — offline validator for an emitted Form C workflow.
 *
 * The live Workflow runtime wraps the script body (top-level await + top-level
 * `return` are legal there), so a bare `node --check` on the module would reject
 * the top-level `return`. This checker emulates the runtime wrap: it strips the
 * `export ` keywords and parses the body inside an async Function via `new
 * Function(...)`, which throws on a syntax error WITHOUT executing anything.
 *
 * It also enforces what the runtime enforces / the build requires:
 *   - DETERMINISM GUARD: the runtime greps source for `Date` / `Math.random` and
 *     aborts. Fail here if the emitted source contains either.
 *   - meta export present.
 *   - a typed failure sentinel (__stage_failed) present (failure != bare null).
 *
 * Usage:  workflow-syntax-check.js <emitted.workflow.js>
 * Exit:   0 ok · 1 syntax/guard failure · 64 usage.
 */
const fs = require("fs");

function fail(msg) {
  console.error("workflow-syntax-check: FAIL — " + msg);
  process.exit(1);
}

const path = process.argv[2];
if (!path) {
  console.error("usage: workflow-syntax-check.js <file>");
  process.exit(64);
}
const src = fs.readFileSync(path, "utf8");

// 1. Determinism guard (matches the runtime's source-text grep).
if (/\bDate\b/.test(src)) fail("emitted source contains `Date` (runtime determinism guard would abort)");
if (/Math\s*\.\s*random/.test(src)) fail("emitted source contains `Math.random` (runtime determinism guard would abort)");

// 2. meta export present.
if (!/export\s+const\s+meta\s*=/.test(src)) fail("missing `export const meta = ...`");

// 3. typed failure sentinel present (failure must not be a bare null).
if (!/__stage_failed/.test(src)) fail("missing `__stage_failed` sentinel (a failed stage must be typed, never bare null)");

// 4. Parse the body as the runtime would (strip exports; wrap in async Function).
//    `new Function` compiles + throws SyntaxError on malformed source, but does
//    NOT run the body (we never invoke the returned function).
const body = src.replace(/export\s+const\s+/g, "const ").replace(/export\s+default\s+/g, "");
try {
  // eslint-disable-next-line no-new-func
  new Function(
    "args", "agent", "parallel", "pipeline", "log", "phase", "budget", "workflow",
    '"use strict";\nreturn (async () => {\n' + body + "\n})();"
  );
} catch (e) {
  fail("syntax error: " + (e && e.message ? e.message : String(e)));
}

console.log("workflow-syntax-check: OK — " + path);
process.exit(0);
