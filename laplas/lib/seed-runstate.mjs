// seed-runstate.mjs — the dispatcher's gate-0 seeder (SDD §4.4, S3.1).
//
// After laplas-ready passes, derive the ARMED contract from the module's quest
// and write it into run-state so poteau's gatekeeper (P201 task-match, P203
// H1-echo, P204 council) has a REAL armed task to judge against — closing the
// gap between "the demo proves the mechanism on a fixture" and "the mechanism
// fires in a live compose run" (#29/#31, the wiring half).
//
//   node seed-runstate.mjs <module.json> <run-state-out.json>
//
// Legacy defaults (IMP-004, fail-closed on the load-bearing field):
//   no objectives (task literals)  → exit 3 REFUSE (an armed run with no task
//                                     cannot be gated against the task — #29)
//   no review_routing              → non-council, recorded
//   no mandated_reads              → empty set, recorded
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { extractH1 } from "./extract-h1.mjs";

const jcs = (v) => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
const sha = (s) => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");

const [modPath, outPath] = process.argv.slice(2);
if (!modPath || !outPath) { console.error("usage: seed-runstate.mjs <module.json> <out.json>"); process.exit(64); }

const base = dirname(modPath);
const mod = JSON.parse(readFileSync(modPath, "utf8"));
const quest = JSON.parse(readFileSync(join(base, mod.quest), "utf8"));

// task = the quest's objectives (the literals the work + gate stages judge against)
const objectives = quest.objectives ?? [];
if (objectives.length === 0) {
  console.error("P-SEED-NO-TASK (IMP-004): quest has no objectives — an armed run with no task literals cannot be judged AGAINST THE TASK (#29). Add objectives[] or do not arm.");
  process.exit(3);
}
const task = { module: mod.name, objectives };

// mandated_reads: re-extract each H1 MECHANICALLY at seed time (the producer and
// the gatekeeper must agree on the SAME literal — IMP-004/006). A declared h1
// that no longer matches the file's actual H1 is a stale contract → refuse.
const mandated_reads = [];
for (const r of quest.mandated_reads ?? []) {
  const actual = extractH1(r.path);
  if (!actual) { console.error(`P-SEED-READ-NO-H1: mandated read "${r.path}" has no extractable H1 — a read that cannot echo cannot be proven (#31).`); process.exit(3); }
  if (r.h1 && r.h1 !== actual) { console.error(`P-SEED-STALE-READ: "${r.path}" declares h1 "${r.h1}" but the file's actual H1 is "${actual}". Update the quest or the doc — the gate echoes the REAL H1.`); process.exit(3); }
  mandated_reads.push({ path: r.path, h1: actual });
}

const review_routing = quest.review_routing ?? { council: false };

const runState = {
  run_id: process.env.POTEAU_RUN_ID ?? "unarmed",
  armed_at: new Date().toISOString(),
  gate_index: 0,
  stop_blocks: 0,
  task,
  task_ref: sha(jcs(task)),
  mandated_reads,
  review_routing,
};
writeFileSync(outPath, JSON.stringify(runState, null, 2));
console.error(`seeded run-state: task_ref=${runState.task_ref.slice(0, 22)}… · ${mandated_reads.length} mandated read(s) · council=${review_routing.council === true}`);
console.log(runState.task_ref);
