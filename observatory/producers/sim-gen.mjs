#!/usr/bin/env node
// sim-gen — the Observatory's FORWARD MODEL of the consumption gradient.
//
//   node sim-gen.mjs [--seed 7] [--greed 0.5] [--discipline 0.5] [--rooms 6] [--out f]
//
// A deterministic, seeded simulation of a party working a run: rooms METER
// (working burns the enrage clock for diminishing quality), gates are FREE
// (presenting costs nothing but risks the verdict). The policy knobs are the
// game design question made executable:
//   greed       0..1 — how long the agent keeps reading past "good enough"
//   discipline  0..1 — how early it presents a checkpoint instead of pushing
// The gradient lesson is structural, not prose: a greedy policy floods clocks
// and meets the reaper; a disciplined one ships CHECKPOINTs; the winning play
// is the substrate's own doctrine — present at the gate before the flood.
// Same seed → byte-identical LevelData (obs-level/1) → asson golden vectors.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLevel, defaultLevel, validateEpisodeLine, SCHEMA, CONTRACT_REV } from "../contract/level-contract.mjs";
import { POLICIES, policyNames } from "./policies.mjs";

// JCS-flavored digest (S3.1): sha256 over sorted-key, no-whitespace JSON.
// Our packets are flat string/int objects — sorted JSON.stringify IS RFC 8785
// canonical form for them. Producer and verifier agree by spec (IMP-004/006).
const jcsDigest = (obj) => {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return "sha256:" + createHash("sha256").update(sorted).digest("hex");
};

// rev 2: gates are DECLARED data joined from the hardness manifest (SDD §3.4).
// Reading a checked-in file is deterministic; the vectors pin manifest+sim together.
const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(here, "../contract/hardness-manifest.json"), "utf8"));
const GATE_NAMES = Object.keys(MANIFEST.gates);
const gateFor = i => {
  const name = GATE_NAMES[i % GATE_NAMES.length];
  const g = MANIFEST.gates[name];
  return { name, hardness: g.hardness, mechanism: g.mechanism, help: g.help, ...(g.teaches ? { teaches: g.teaches } : {}) };
};

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const SEED = Number(opt("seed", 7));
const GREED = Math.max(0, Math.min(1, Number(opt("greed", .5))));
const DISC = Math.max(0, Math.min(1, Number(opt("discipline", .5))));
const NROOMS = Math.max(2, Math.min(12, Number(opt("rooms", 6))));
// §3.3-amendment (S3.1): --stuck N plants a QUALITY WALL at room N (not a hang —
// returns plateau below every present threshold; the real failure mode, S1.4).
const STUCK = Number.isInteger(Number(opt("stuck", NaN))) ? Number(opt("stuck")) : -1;
// FR-C (S4): --policy <name> seats a pure decision function at every room.
// Registry-only by contract (SDD-B1/B7) — obs.mjs enforces it at the door too.
const POLICY_NAME = opt("policy", null);
if (POLICY_NAME !== null && !POLICIES[POLICY_NAME]) {
  console.error(`✗ unknown policy '${POLICY_NAME}' — registry: ${policyNames().join(", ")} (registry-only; file paths are a refused surface)`);
  process.exit(2);
}
const EPISODE_OUT = opt("episode-out", null);
const TICK_CAP = 40;  // the harness bound (SP-B8): the SIM enforces it; the test proves it fires

// mulberry32 — tiny seeded RNG; determinism is the contract
function rng(seed) { let a = seed >>> 0; return () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(SEED);
const pick = arr => arr[Math.floor(R() * arr.length)];

const TASKS = ["Grounding Pass", "Schema Forge", "Verdict Loom", "Custody Ledger", "Drift Sweep",
  "Seam Audit", "Budget Sluice", "Token Mill", "Handoff Kiln", "Proof Cellar", "Clew Press", "Gate Argument"];
const CASTS = [["noether", "noether"], ["the-arcade", "arcade"], ["protocol", "proto"], ["gecko", "gecko"],
  ["vocabulary-bank", "vocab"], ["the-easel", "easel"], ["k-hole", "khole"], ["artisan", "artisan"]];
const PAYLOADS = ["typed handoff", "sealed contract", "grounded findings", "verdict packet",
  "custody chain", "distilled brief", "attested build", "golden vectors"];
const BADGES = ["✚", "»", "⚷", "◔", "❡", "◉", "✦", "⟁"];

// ── the simulation: one party, NROOMS tasks, the gradient decides the story ──
const rooms = [], envelopes = [], seams = [];
const usedTasks = new Set(), usedCasts = new Set();
for (let i = 0; i < NROOMS; i++) {
  let t; do { t = pick(TASKS); } while (usedTasks.has(t) && usedTasks.size < TASKS.length); usedTasks.add(t);
  let c; do { c = pick(CASTS); } while (usedCasts.has(c[0]) && usedCasts.size < CASTS.length); usedCasts.add(c[0]);
  rooms.push({ id: i, name: t, construct: c[0], spr: c[1], gx: i % 4, gy: Math.floor(i / 4), live: 0 });
}
rooms.forEach((r, i) => { if (r.gy % 2 === 1) r.gx = 3 - (i % 4); });

let reapedAt = -1;
const clews = [];
const episode = [];
let globalTick = 0;
const r2 = (x) => Math.round(x * 100) / 100;
// ── FR-C: the policy plays every room — episode JSONL is the conformance surface ──
const playRoom = (i) => {
  const pol = POLICIES[POLICY_NAME];
  const difficulty = .3 + R() * .6;
  const wall = i === STUCK ? .25 + R() * .08 : 1;  // only the stuck room is walled; elsewhere returns diminish toward 1
  let q = 0, clock = 0, lastGain = Infinity, action = "read";
  for (let t = 0; t < TICK_CAP; t++) {
    action = pol.decide({ quality: q, clock, params: pol.params, lastGain });
    episode.push({ episode_id: `ep-${POLICY_NAME}-${SEED}`, tick: globalTick++,
      actor: rooms[i].construct, action,
      observation_digest: jcsDigest({ seed: SEED, room: i, tick: t, quality: r2(q), clock: r2(clock) }) });
    if (action !== "read") break;
    clock += .07 + R() * .05;
    lastGain = q < wall ? (.16 + R() * .1) * (wall - q) : 0;
    q += lastGain;
    if (clock >= 1) { action = "flood"; break; }  // the cap the world enforces
  }
  rooms[i].live = Math.min(1, r2(clock));
  seams.push([i, i + 1]);
  if (action === "present") {
    const verdict = q >= .72 ? "APPROVED" : q >= .45 ? "EMITTED" : "REJECTED";
    const payload = pick(PAYLOADS);
    envelopes.push({ from: i, to: i + 1, payload, keepers: difficulty > .75 ? 3 : difficulty > .55 ? 2 : 1,
      verdict, wave: i, gate: gateFor(i),
      gateline: verdict === "APPROVED" ? `LEGBA turns the key on <i>${payload}</i>… it holds.`
        : verdict === "EMITTED" ? `the packet <i>${payload}</i> passes, seal unread — emitted, not attested.`
        : `LEGBA bars the door — quality ${Math.round(q * 100)}% does not clear the bar.`,
      transform: { badge: BADGES[i % BADGES.length],
        line: `<b>${rooms[i + 1].construct}</b> receives ${payload} — quality ${Math.round(q * 100)}%` } });
    return;
  }
  // clew (voluntary testimony) or flood/cap (watchdog drops it — SP-B8 in the world)
  const voluntary = action === "clew";
  if (!voluntary) rooms[i].live = 1;
  let divergence = 0;
  for (let j = envelopes.length - 1; j >= 0; j--)
    if (envelopes[j].verdict === "APPROVED" || envelopes[j].verdict === "CHECKPOINT") { divergence = j; break; }
  const packet = { run_id: `play-${POLICY_NAME}-${SEED}`, room: i, divergence, routing: "heal",
    dropped_by: voluntary ? "agent" : "watchdog", ...(voluntary ? {} : { trigger: "budget" }),
    clock: r2(clock), quality: r2(q) };
  clews.push({ room: i, divergence, routing: "heal", dropped_by: packet.dropped_by,
    ...(voluntary ? {} : { trigger: "budget" }), packet_digest: jcsDigest(packet) });
  envelopes.push({ from: i, to: i + 1, payload: "distress packet", keepers: 1,
    verdict: "IMPASSE", wave: i, gate: gateFor(i),
    gateline: voluntary
      ? `the envelope presents empty-handed — quality walled at ${Math.round(q * 100)}%. the agent drops the thread.`
      : `the flood takes the chamber — the watchdog drops the thread. ◷ budget spent, quality ${Math.round(q * 100)}%.`,
    transform: { badge: "◈", line: `routed onward — <b>${rooms[i + 1].construct}</b> receives the testimony` } });
};
for (let i = 0; i < NROOMS - 1; i++) {
  if (POLICY_NAME) { playRoom(i); continue; }
  // ── the stuck room (S3.1): a quality wall. Distress is a legal, rendered move. ──
  if (i === STUCK) {
    const wall = .25 + R() * .08;              // returns asymptote — below every present bar
    const plateauAt = wall * (.04 + .1 * DISC); // discipline recognizes futility sooner
    let q = 0, clock = 0, gain = Infinity;
    const voluntary = DISC >= .5;              // discipline testifies at the plateau
    while (clock < 1) {
      clock += .07 + R() * .05;
      gain = (.16 + R() * .1) * (wall - q); q += gain;   // asymptote: the wall
      if (voluntary && gain <= plateauAt) break;         // the testimony beat
    }
    if (!voluntary) { clock = 1; }             // the grind: burns to the flood
    rooms[i].live = voluntary ? Math.min(1, Math.round(clock * 100) / 100) : 1;
    // divergence = last ATTESTED junction (APPROVED/CHECKPOINT) — EMITTED passed
    // unattested and cannot anchor the thread. None attested → the entrance (0).
    let divergence = 0;
    for (let j = envelopes.length - 1; j >= 0; j--)
      if (envelopes[j].verdict === "APPROVED" || envelopes[j].verdict === "CHECKPOINT") { divergence = j; break; }
    const packet = {
      run_id: `sim-seed-${SEED}`, room: i, divergence, routing: "heal",
      dropped_by: voluntary ? "agent" : "watchdog",
      ...(voluntary ? {} : { trigger: "budget" }),
      clock: Math.round(clock * 100) / 100, quality: Math.round(q * 100) / 100,
    };
    clews.push({ room: i, divergence, routing: "heal",
      dropped_by: packet.dropped_by, ...(voluntary ? {} : { trigger: "budget" }),
      packet_digest: jcsDigest(packet) });
    seams.push([i, i + 1]);
    envelopes.push({ from: i, to: i + 1, payload: "distress packet", keepers: 1,
      verdict: "IMPASSE", wave: i, gate: gateFor(i),
      gateline: voluntary
        ? `the envelope presents empty-handed — quality walled at ${Math.round(q * 100)}%. the agent drops the thread.`
        : `the flood takes the chamber — the watchdog drops the thread. ◷ budget spent, quality ${Math.round(q * 100)}%.`,
      transform: { badge: "◈", line: `routed onward — <b>${rooms[i + 1].construct}</b> receives the testimony` } });
    continue;
  }
  const difficulty = .3 + R() * .6;            // how much reading the task truly needs
  // work loop: each tick burns clock, buys diminishing quality
  let q = 0, clock = 0;
  const presentAt = Math.min(.95, difficulty * (.7 + .5 * GREED));  // greed reads past the need
  const panicAt = .55 + .4 * (1 - DISC);       // discipline presents well before the wall
  while (q < presentAt && clock < panicAt && clock < 1) {
    clock += .07 + R() * .05;                  // rooms METER
    q += (.16 + R() * .1) * (1 - q);           // diminishing returns — the loiter trap
  }
  let verdict, loiter = false;
  if (clock >= 1 || (clock >= panicAt && q < .35 && GREED > .7)) {   // flooded: the reaper's hop
    rooms[i].live = 1; reapedAt = i; verdict = "CHECKPOINT";
  } else {
    rooms[i].live = Math.round(clock * 100) / 100;
    verdict = q >= .72 ? "APPROVED" : q >= .45 ? "EMITTED" : (R() < .6 ? "REJECTED" : "EMITTED");
  }
  seams.push([i, i + 1]);
  const keepers = difficulty > .75 ? 3 : difficulty > .55 ? 2 : 1;   // stakes set the panel
  const payload = pick(PAYLOADS);
  const GATELINE = {
    APPROVED: `LEGBA turns the key on <i>${payload}</i>… it holds.`,
    CHECKPOINT: `the checkpoint presents <i>${payload}</i>… accepted. the work survives its author.`,
    EMITTED: `the packet <i>${payload}</i> passes, seal unread — emitted, not attested.`,
    REJECTED: `LEGBA bars the door — quality ${Math.round(q * 100)}% does not clear the bar.`,
  }[verdict];
  envelopes.push({ from: i, to: i + 1, payload, keepers, verdict, wave: i,
    loiter: reapedAt === i ? undefined : undefined,
    gateline: GATELINE,
    gate: gateFor(i),
    transform: { badge: BADGES[i % BADGES.length],
      line: `<b>${rooms[i + 1].construct}</b> receives ${payload} — quality ${Math.round(q * 100)}%` } });
  if (reapedAt === i) {
    // the flood: the NEXT room hosts the loiter→reap→salvage arc (renderer law: live≥1 attests)
    envelopes[envelopes.length - 1].verdict = "APPROVED";
    envelopes[envelopes.length - 1].loiter = true;
    rooms[i + 1].live = 1;
    if (i + 2 <= NROOMS - 1) {
      seams.push([i + 1, i + 2]);
      envelopes.push({ from: i + 1, to: i + 2, payload: "checkpoint · what the reaper left",
        keepers: 1, verdict: "CHECKPOINT", pale: true, wave: i + 1,
        gateline: "the checkpoint presents at the gate… accepted.",
        gate: gateFor(i + 1),
        transform: { badge: "✓", line: `<b>${rooms[i + 2].construct}</b> takes the salvage` } });
      i++; // the salvage hop consumed the next leg
    }
    reapedAt = -2; // only one reap arc per sim run (the renderer renders one reaper)
  }
}
if (!rooms[NROOMS - 1].live) rooms[NROOMS - 1].live = Math.round((.2 + R() * .3) * 100) / 100;

const level = defaultLevel({
  schema: SCHEMA, id: POLICY_NAME ? `play-${POLICY_NAME}-${SEED}` : `sim-${SEED}`,
  name: POLICY_NAME ? `the rehearsal seat — ${POLICY_NAME} plays (seed ${SEED})`
    : `the gradient, played (greed ${GREED} · discipline ${DISC})`,
  meta: { run_id: POLICY_NAME ? `play-${POLICY_NAME}-${SEED}` : `sim-seed-${SEED}`,
    generated_at: POLICY_NAME ? `play:${POLICY_NAME}:${SEED}${STUCK >= 0 ? `:stuck${STUCK}` : ""}` : `sim:${SEED}:${GREED}:${DISC}${STUCK >= 0 ? `:stuck${STUCK}` : ""}`,
    contract_rev: CONTRACT_REV,
    enrage_s: 300, sources: { simulator: "sim-gen.mjs", seed: SEED,
      ...(POLICY_NAME ? { policy: POLICY_NAME } : { greed: GREED, discipline: DISC }),
      ...(STUCK >= 0 ? { stuck: STUCK } : {}) } },
  rooms, seams, envelopes, ...(clews.length ? { clews } : {}),
});
// FR-C: the episode is validated line-by-line BEFORE it leaves (the teeth)
if (POLICY_NAME && episode.length) {
  for (const [li, line] of episode.entries()) {
    const ev = validateEpisodeLine(line);
    if (!ev.ok) { console.error(`✗ episode line ${li} violates the schema:`); ev.errors.forEach(e => console.error("  · " + e)); process.exit(2); }
  }
  const jsonl = episode.map(l => JSON.stringify(l)).join("\n") + "\n";
  if (EPISODE_OUT) { writeFileSync(EPISODE_OUT, jsonl); console.error(`episode ▸ ${EPISODE_OUT} (${episode.length} ticks, schema-valid)`); }
  else console.error(`episode: ${episode.length} ticks, schema-valid (pass --episode-out to keep it)`);
}
const v = validateLevel(level);
if (!v.ok) { console.error("✗ sim emitted an invalid level:"); v.errors.forEach(e => console.error("  · " + e)); process.exit(2); }
const json = JSON.stringify(level, null, 1);
const out = opt("out");
if (out) { writeFileSync(out, json); console.error(`wrote ${out}`); } else console.log(json);
console.error(`sim: ${rooms.length} rooms · ${envelopes.length} hops · verdicts ${envelopes.map(e => e.verdict[0]).join("")} · ${level.rooms.some(r => r.live >= 1) ? "REAP arc" : "clean run"}`);
