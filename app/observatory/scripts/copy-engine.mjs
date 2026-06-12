#!/usr/bin/env node
// Build-time asset copy (SDD §5): single source = observatory/.
// public/observatory/ + vendor/observatory/ are build artifacts — NEVER
// hand-edited, gitignored. The vendor copy is what serverless bundles run
// (/api/sim spawns vendor/observatory/producers/sim-gen.mjs).
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { existsSync } from "node:fs";
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "observatory");
// On Vercel only app/observatory is uploaded — the copies travel WITH the
// upload (.vercelignore keeps them); skip the copy when the source is absent.
if (!existsSync(src)) {
  console.log("source tree absent (deployed build) — using uploaded copies");
  process.exit(0);
}
const pub = join(here, "..", "public", "observatory");
const vnd = join(here, "..", "vendor", "observatory");

mkdirSync(pub, { recursive: true });
copyFileSync(join(src, "engine", "game.html"), join(pub, "game.html"));
console.log("engine ▸ public/observatory/game.html");

for (const [dir, files] of [
  ["producers", ["sim-gen.mjs", "policies.mjs"]],
  ["contract", ["level-contract.mjs", "hardness-manifest.json"]],
]) {
  mkdirSync(join(vnd, dir), { recursive: true });
  for (const f of files) copyFileSync(join(src, dir, f), join(vnd, dir, f));
}
console.log("producers+contract ▸ vendor/observatory/ (serverless bundle source)");
