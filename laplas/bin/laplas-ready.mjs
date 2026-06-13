#!/usr/bin/env node
/**
 * laplas-ready.mjs — the ready check. The MMO raid lobby for agentic ceremonies:
 * comp checked, consumables checked, lockout checked — THEN the instance portal opens.
 *
 * A module is three preparations, prepared separately, validated TOGETHER:
 *   QUEST   — the what: objectives, mandated reads, gate contracts, REL, requirements
 *             ("an adventure for 4–6 characters of levels 5–7" — the cover declares
 *              the party it presumes)
 *   PARTY   — the who: roles, model tiers, council voices, HITL slots, bind setups
 *   DUNGEON — the where: rooms graph, provisioned tools (the veve'd allowlist —
 *             Daemonheim rule: you use what's provisioned), REL posture, budgets
 *
 * Half of all historical failures were ceremonies that should never have started
 * (#29/#31 quest-prep, #30/#40 party-prep, #7 dungeon-prep). The ready check is
 * where they die now: at the door, cheaply, with a P-code that teaches — instead of
 * at hour two, expensively, in a transcript.
 *
 * usage: node laplas-ready.mjs <module.json>     (module references the 3 manifests)
 * exit:  0 ready (receipt written) · 2 refused (every refusal names the fix) ·
 *        5 internal (custody: fail closed)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const jcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(jcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');

const refusals = [];
const refuse = (code, teach) => refusals.push({ code, refusal: teach });

let mod, quest, party, dungeon;
try {
  const modPath = process.argv[2];
  mod = JSON.parse(readFileSync(modPath, 'utf8'));
  const base = dirname(modPath);
  quest = JSON.parse(readFileSync(join(base, mod.quest), 'utf8'));
  party = JSON.parse(readFileSync(join(base, mod.party), 'utf8'));
  dungeon = JSON.parse(readFileSync(join(base, mod.dungeon), 'utf8'));
} catch (e) {
  console.error(JSON.stringify({ code: 'P600', refusal: 'module or manifest unreadable: ' + e.message + ' — a module references quest, party, and dungeon by path; all three must resolve. Custody fails closed.' }));
  process.exit(5);
}

// ── L1 · P601: the cover rule — quest declares the party it requires ──
const partyRoles = new Set((party.members ?? []).map(m => m.role));
for (const role of quest.requires?.roles ?? [])
  if (!partyRoles.has(role))
    refuse('P601', `quest "${quest.name}" requires role "${role}"; party "${party.name}" provides [${[...partyRoles].join(', ')}]. Recruit the role or re-quest — the cover says 4–6 characters for a reason.`);

// ── L2 · P602: Daemonheim rule — you use what the dungeon provisions ──
const provisioned = new Set(dungeon.tools ?? []);
for (const tool of quest.requires?.tools ?? [])
  if (!provisioned.has(tool))
    refuse('P602', `quest requires tool "${tool}"; dungeon "${dungeon.name}" provisions [${[...provisioned].join(', ')}]. Add the veve'd CLI to the dungeon loadout or choose a dungeon that carries it — nothing enters Daemonheim.`);

// ── L3 · P603: council comp — declared review surfaces must be staffable ──
if (quest.review_routing?.council === true) {
  const voices = (party.members ?? []).filter(m => m.seat === 'council').length;
  const min = quest.review_routing.min_voices ?? 2;
  if (voices < min)
    refuse('P603', `quest mandates a council of >=${min}; party seats ${voices} council voice(s). Under-recruited review is issue #30 wearing a party hat — add voices or the ceremony does not start.`);
}

// ── L4 · P604: every quest gate's room must exist in the dungeon graph ──
const rooms = new Set((dungeon.rooms ?? []).map(r => r.id));
for (const gate of quest.gates ?? [])
  if (!rooms.has(gate.room))
    refuse('P604', `quest gate "${gate.id}" keys to room "${gate.room}", which dungeon "${dungeon.name}" does not contain ([${[...rooms].join(', ')}]). An unreachable gate is an unfinishable quest — fix the keying.`);

// ── L5 · P605: REL compatibility — a competitive quest cannot run in a casual dungeon ──
const relRank = { casual: 0, competitive: 1 };
if ((relRank[quest.rel] ?? 1) > (relRank[dungeon.rel] ?? 0))
  refuse('P605', `quest declares REL "${quest.rel}" but dungeon posture is "${dungeon.rel}". Competitive ceremonies need armed gates, recorder on, lexicon in force — run it in a competitive dungeon or downgrade the quest deliberately (and record why).`);

// ── L6 · P606: HITL slots — operator gates need an operator seat ──
const hitlSlots = new Set((party.members ?? []).filter(m => m.kind === 'hitl').map(m => m.slot));
for (const gate of quest.gates ?? [])
  if (gate.hitl && !hitlSlots.has(gate.hitl))
    refuse('P606', `quest gate "${gate.id}" invokes HITL slot "${gate.hitl}"; party seats none. The operator is a party slot, not ambient magic — add the seat or remove the invocation.`);

if (refusals.length) {
  console.error(JSON.stringify({ ready: false, refusals }, null, 2));
  process.exit(2);
}

// ── ready receipt: hash of all three manifests, bound together ──
const receipt = {
  receipt_kind: 'laplas_ready', laplas_version: '0.1.0',
  module: mod.name ?? 'unnamed',
  quest_hash: sha(jcs(quest)), party_hash: sha(jcs(party)), dungeon_hash: sha(jcs(dungeon)),
  rel: quest.rel ?? 'competitive',
  ts: new Date().toISOString(),
};
mkdirSync('.run/poteau', { recursive: true });
writeFileSync('.run/poteau/ready.json', JSON.stringify({ receipt, receipt_hash: sha(jcs(receipt)) }, null, 2));
console.log(JSON.stringify({ ready: true, receipt_hash: sha(jcs(receipt)) }));
