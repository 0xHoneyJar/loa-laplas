// Redaction + share walls (S5.1/S5.3 — SP-B7, IMP-011, SP-B2).
// Run: node --test observatory/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLevel, defaultLevel, redactLevel, assertShareable, isSameOriginRef } from "../contract/level-contract.mjs";

// fixture with SENSITIVE-LOOKING strings (SP-B7: keys, repo names, emails, paths)
const SENSITIVE = [
  "sk-ant-api03-FAKEFAKEFAKEFAKE",
  "ghp_FAKEtokenFAKEtokenFAKEtoken",
  "0xHoneyJar/secret-internal-repo",
  "beatselysian@gmail.com",
  "/Users/zksoju/Documents/GitHub/construct-rooms-substrate",
  "AKIAFAKEAWSKEYFAKE",
];
const fixture = () => defaultLevel({
  schema: "obs-level/1", id: "real-run-20260612", name: `run touching ${SENSITIVE[2]}`,
  meta: { contract_rev: 2, enrage_s: 300, generated_at: "2026-06-12T20:00:00Z",
    sources: { runDir: SENSITIVE[4], audit: ".run/audit.jsonl", apiKey: SENSITIVE[0] } },
  rooms: [
    { id: 0, name: "Key Vault", construct: SENSITIVE[1].slice(0, 20), spr: "noether", gx: 0, gy: 0, live: .5 },
    { id: 1, name: "Mail Room", construct: SENSITIVE[3], spr: "vocab", gx: 1, gy: 0, live: .8 },
    { id: 2, name: "Repo Floor", construct: "the-arcade", spr: "arcade", gx: 2, gy: 0, live: .3 },
  ],
  seams: [[0, 1], [1, 2]],
  envelopes: [
    { from: 0, to: 1, payload: `the key ${SENSITIVE[0]}`, keepers: 2, verdict: "APPROVED",
      gateline: `LEGBA reads ${SENSITIVE[5]} aloud`, custom_field: SENSITIVE[2],
      gate: { name: "handoff-validate", hardness: "prose", mechanism: "secret-bearing mechanism string", help: SENSITIVE[4] },
      transform: { badge: "✚", line: `lands at ${SENSITIVE[3]}` } },
    { from: 1, to: 2, payload: "distress packet", keepers: 1, verdict: "IMPASSE",
      gateline: "empty-handed", gate: { hardness: "unknown" },
      transform: { badge: "◈", line: "routed" } },
  ],
  clews: [{ room: 1, divergence: 0, routing: "heal", dropped_by: "watchdog", trigger: "budget",
    packet_digest: "sha256:" + "ab".repeat(32) }],
});

test("redactLevel: no sensitive string survives, anywhere", () => {
  const red = redactLevel(fixture());
  const blob = JSON.stringify(red);
  for (const s of SENSITIVE) assert.ok(!blob.includes(s), `leaked: ${s}`);
  assert.ok(!blob.includes("Key Vault"), "room name passed through unsalted");
});

test("redactLevel: same level twice → different salts, SAME topology (accepted leakage)", () => {
  const L = fixture();
  const a = redactLevel(L), b = redactLevel(L);
  assert.notEqual(a.rooms[0].name, b.rooms[0].name, "salts repeated — pseudonyms must differ across calls");
  assert.deepEqual(a.seams, b.seams);
  assert.deepEqual(a.rooms.map(r => [r.id, r.gx, r.gy, r.live]), b.rooms.map(r => [r.id, r.gx, r.gy, r.live]));
  assert.deepEqual(a.envelopes.map(h => h.verdict), b.envelopes.map(h => h.verdict));
  assert.deepEqual(a.clews, b.clews); // digests + routing survive — they are share value
});

test("redactLevel: within-level consistency — same text, same pseudonym", () => {
  const L = fixture();
  L.envelopes[0].payload = L.rooms[0].name; // duplicate text across fields
  const red = redactLevel(L);
  assert.equal(red.envelopes[0].payload, red.rooms[0].name);
});

test("redactLevel: unknown fields are DROPPED, never passed (allowlist is code)", () => {
  const red = redactLevel(fixture());
  assert.equal(red.envelopes[0].custom_field, undefined);
  assert.equal(red.meta.sources, undefined);
  assert.equal(red.envelopes[0].gateline, undefined);
  assert.equal(red.envelopes[0].transform, undefined);
  assert.equal(red.envelopes[0].gate.mechanism, undefined, "gate mechanism is free text — dropped");
  assert.equal(red.envelopes[0].gate.help, undefined, "gate help is free text — dropped");
  assert.equal(red.envelopes[0].gate.hardness, "prose", "hardness is enum doctrine — kept");
});

test("redacted level still VALIDATES (it is a level) and is stamped", () => {
  const red = redactLevel(fixture());
  const v = validateLevel(red);
  assert.ok(v.ok, v.errors.join("; "));
  assert.equal(red.meta.redacted, true);
});

test("IMP-011: unredacted ingestion is REJECTED at the public door", () => {
  const raw = fixture();
  assert.equal(assertShareable(raw).ok, false);
  const forged = fixture(); forged.meta.redacted = true; // client-claimed flag, never load-bearing
  const fv = assertShareable(forged);
  assert.equal(fv.ok, false, "a forged meta.redacted with surviving free-text must still be refused");
  assert.equal(assertShareable(redactLevel(fixture())).ok, true);
});

test("SP-B2: deployed-engine fetch restriction — same-origin relative paths only", () => {
  for (const ok of ["level.json", "levels/run-42.json", "./relative.json", "a/b/c.json"])
    assert.ok(isSameOriginRef(ok), `wrongly refused: ${ok}`);
  for (const bad of ["https://evil.example/x.json", "http://127.0.0.1:8787/x", "//evil.example/x",
    "javascript:alert(1)", "data:application/json,{}", "file:///etc/passwd", "\\\\evil\\share", ""])
    assert.ok(!isSameOriginRef(bad), `wrongly allowed: ${bad}`);
});
