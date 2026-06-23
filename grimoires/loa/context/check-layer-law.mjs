#!/usr/bin/env node
// check-layer-law.mjs — the executable twin of layer-law.yaml.
//
// Makes "The Loa Stack" a COHERENCE MONITOR rather than a diagram: it probes the
// real repos and reports CONFORMS / GAP / VIOLATION against the Descent Law.
// Agreement = silence; gaps = honest drift. Speaks the STATUS|SIGNAL|MISMATCH tile
// dialect (byte-compatible with settle's detector + estate-coherence) on purpose —
// the map that describes the substrate speaks the substrate's language.
//
//   node grimoires/loa/context/check-layer-law.mjs
//
// Zero deps (node builtins only). Candidate seed — refine the edge probes as the
// wiring matures. It under-claims by design: it reports what it can actually see.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const expand = (p) => p.replace(/^~(?=\/)/, homedir());

// --- minimal parse of the `repos:` block from the manifest (no yaml dep) -------
function parseRepos(manifestPath) {
  const lines = readFileSync(manifestPath, "utf8").split("\n");
  const repos = {};
  let inRepos = false;
  for (const line of lines) {
    if (/^repos:\s*$/.test(line)) { inRepos = true; continue; }
    if (inRepos) {
      if (/^\S/.test(line)) break; // next top-level key ends the block
      const m = line.match(/^\s+([A-Za-z0-9_-]+):\s*(\[.*\])\s*$/);
      if (m) repos[m[1]] = JSON.parse(m[2]).map(expand);
    }
  }
  return repos;
}

const firstExisting = (paths) => paths.find((p) => existsSync(p)) ?? null;

// Layer depth (deepest first). Lower depth must not depend (in code) on higher.
const DEPTH = { loa: 0, "loa-laplas": 1, "loa-freeside": 2 };

function grepCount(root, pattern, globs) {
  // count code references to `pattern`, excluding node_modules / docs / config-only dirs.
  try {
    const inc = globs.map((g) => `--include='${g}'`).join(" ");
    const out = execSync(
      `grep -rIl ${inc} -e '${pattern}' ${root} 2>/dev/null ` +
        // exclude non-code: deps, docs, build, git, orchestration config (compositions),
        // and planning artifacts (grimoires) — a doc NAMING a layer is not a code dependency.
        `| grep -vE 'node_modules|/docs/|/dist/|/\\.git/|compositions/|/grimoires/' | head -50`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const results = [];
const record = (law, verdict, detail) => results.push({ law, verdict, detail });

const repos = parseRepos(join(HERE, "layer-law.yaml"));
const resolved = Object.fromEntries(
  Object.entries(repos).map(([name, paths]) => [name, firstExisting(paths)]),
);

// --- LAW 1: kernel_mount — every layer mounts loa (.claude/loa) ----------------
for (const [name, root] of Object.entries(resolved)) {
  if (!root) { record("kernel_mount", "GAP", `${name}: repo not found locally`); continue; }
  const mounts = existsSync(join(root, ".claude", "loa"));
  if (name === "loa") {
    record("kernel_mount", "CONFORMS", `loa: is the kernel (${root})`);
  } else {
    record("kernel_mount", mounts ? "CONFORMS" : "VIOLATION",
      `${name}: ${mounts ? "mounts .claude/loa" : "does NOT mount the kernel"}`);
  }
}

// --- LAW 2: downward_only — no lower layer depends (in code) on a higher one ----
// Check loa (depth 0) for code refs to laplas/freeside, and laplas (1) → freeside.
const upwardChecks = [
  { lower: "loa", higher: ["laplas", "freeside"] },
  { lower: "loa-laplas", higher: ["freeside"] },
];
for (const { lower, higher } of upwardChecks) {
  const root = resolved[lower];
  if (!root) continue;
  for (const h of higher) {
    const hits = grepCount(root, h, ["*.ts", "*.mjs", "*.js"]);
    if (hits.length === 0) {
      record("downward_only", "CONFORMS", `${lower} has no code dependency on '${h}' ✓`);
    } else {
      record("downward_only", "VIOLATION",
        `${lower} (depth ${DEPTH[lower]}) references higher layer '${h}' in ${hits.length} file(s) — inspect: ${hits[0]}`);
    }
  }
}

// --- LAW 3: enforcement_from_below — is laplas wired BENEATH freeside? ----------
const fs = resolved["loa-freeside"];
if (fs) {
  const installed = ["loa-laplas", "laplas", "poteau", "legba"].some((n) =>
    existsSync(join(fs, ".claude", "constructs", "packs", n)));
  const invoked = grepCount(fs, "poteau\\|legba\\|loa-laplas", ["*.sh", "*.mjs", "*.ts"])
    .filter((f) => !f.includes("/grimoires/")); // exclude this brief + docs
  if (installed || invoked.length > 0) {
    record("enforcement_from_below", "CONFORMS",
      `laplas is wired beneath freeside (${installed ? "installed" : `invoked in ${invoked.length} file(s)`})`);
  } else {
    record("enforcement_from_below", "GAP",
      "freeside agents do NOT run under laplas brakes (laplas not installed/invoked) — the under-consumption gap. settle's descent closes this for one principle.");
  }
}

// --- crosscut: constructs present at each layer --------------------------------
for (const [name, root] of Object.entries(resolved)) {
  if (!root) continue;
  const packsDir = join(root, ".claude", "constructs", "packs");
  const n = existsSync(packsDir) ? readdirSync(packsDir).length : 0;
  record("constructs_crosscut", n > 0 ? "CONFORMS" : "GAP", `${name}: ${n} construct packs installed`);
}

// --- report --------------------------------------------------------------------
const byVerdict = (v) => results.filter((r) => r.verdict === v);
const violations = byVerdict("VIOLATION");
const gaps = byVerdict("GAP");

console.log("\n  The Loa Stack — layer-law coherence check");
console.log("  " + "─".repeat(64));
for (const r of results) {
  const glyph = { CONFORMS: "✓", GAP: "○", VIOLATION: "✗" }[r.verdict];
  console.log(`  ${glyph} [${r.law}] ${r.detail}`);
}
console.log("  " + "─".repeat(64));

const status = violations.length > 0 ? "VIOLATION" : gaps.length > 0 ? "DRIFT" : "ok";
const tile = `STATUS=${status}|SIGNAL=layer-law|VIOLATION=${violations.length}|GAP=${gaps.length}`;
console.log(`  ${tile}\n`);

// Coherence-monitor discipline: gaps are honest drift (exit 0, surface it);
// a VIOLATION of downward-only is a real inversion (exit 1, fail-closed).
process.exit(violations.length > 0 ? 1 : 0);
