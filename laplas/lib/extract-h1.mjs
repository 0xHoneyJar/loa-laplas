// extract-h1.mjs — the mandated-read H1 extractor (IMP-007).
//
// proof-of-grounding (#31) keys on a document's literal H1. THIS repo's docs
// open with YAML frontmatter (`---\n…\n---`) — a naive "first `# ` line" would
// either miss the title or grab a `# ` that lives INSIDE the frontmatter block.
// The contract: skip a leading frontmatter fence if present, THEN take the first
// ATX H1 (`# `). The dispatcher (run-state seeds) and laplas-ready use this one
// function so producer and gate agree on the same literal (IMP-004/006).
import { readFileSync } from "node:fs";

export function extractH1FromText(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  // skip a leading YAML frontmatter block: first non-empty line is exactly '---'
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.trim() === "---") {
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j < lines.length) i = j + 1; // consumed the closing fence
  }
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) return `# ${m[1]}`; // normalized to the canonical "# Title" form
  }
  return null;
}

export function extractH1(path) {
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch { return null; }
  return extractH1FromText(text);
}

// CLI: node extract-h1.mjs <path>  → prints the H1 or exits 1 (H1-less = refuse,
// not silence — the dispatcher turns this into a compile-time P-code, SDD §4.4).
if (import.meta.url === `file://${process.argv[1]}`) {
  const h1 = extractH1(process.argv[2]);
  if (!h1) { console.error(`P-READ-NO-H1: ${process.argv[2]} has no ATX H1 — a mandated read must have a title to echo`); process.exit(1); }
  console.log(h1);
}
