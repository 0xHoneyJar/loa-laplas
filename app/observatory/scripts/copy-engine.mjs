#!/usr/bin/env node
// Build-time engine copy (SDD §5): single source = observatory/engine/.
// public/observatory/ is a build artifact — NEVER hand-edited, gitignored.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "observatory", "engine", "game.html");
const destDir = join(here, "..", "public", "observatory");
mkdirSync(destDir, { recursive: true });
copyFileSync(src, join(destDir, "game.html"));
console.log(`engine ▸ copied ${src} → public/observatory/game.html`);
