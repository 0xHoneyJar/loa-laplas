// level-contract — the Observatory level treaty (obs-level/1, rev 2).
// ONE invariant list enforced on both sides of the seam: trace-gen validates
// before writing, game.html validates (inlined copy, CONTRACT_REV-stamped)
// before loading. Evolution rule: unknown fields ignored, missing-optional
// defaulted, missing-required → reject whole. (Panel fill W1-4 · obs-panel-20260611)
//
// rev 2 (SDD §3, flatlined): IMPASSE joins the verdict enum (a gate ARRIVAL,
// not a refusal — routed, never bounced) · envelopes[].gate carries DECLARED
// hardness (joined from hardness-manifest; fail-honest: unknown → HOLLOW) ·
// level.clews[] is the thread (distress is a legal, rendered move) ·
// sanitizeText closes the innerHTML path to untrusted levels (SP-B6).
// Cross-rev (IMP-002): a rev-2 consumer accepts rev-1 levels (gate defaults
// hardness=unknown, clews defaults []); a rev-1 consumer ignores unknown
// fields by design and console.warns the rev mismatch naming both revs.
export const CONTRACT_REV = 2;
export const SCHEMA = "obs-level/1";
export const VERDICTS = ["APPROVED", "CHECKPOINT", "EMITTED", "REJECTED", "DENIED", "IMPASSE"];
export const HARDNESS = ["hook", "prose", "unknown"];
export const CLEW_ROUTING = ["retrace", "rotate", "heal"];
export const CLEW_DROPPED_BY = ["agent", "watchdog"];

export function validateLevel(L) {
  const errs = [];
  const E = (m) => errs.push(m);
  if (!L || typeof L !== "object") return { ok: false, errors: ["level is not an object"] };
  if (!Array.isArray(L.rooms) || !L.rooms.length) E("rooms[] missing or empty");
  if (!Array.isArray(L.seams)) E("seams[] missing");
  if (!Array.isArray(L.envelopes) || !L.envelopes.length) E("envelopes[] missing or empty");
  if (errs.length) return { ok: false, errors: errs };
  const n = L.rooms.length;
  L.rooms.forEach((r, i) => {
    if (r.id !== i) E(`rooms[${i}].id=${r.id} — ids must be contiguous from 0`);
    if (!Number.isInteger(r.gx) || !Number.isInteger(r.gy)) E(`rooms[${i}] gx/gy must be integers`);
    if (typeof r.live !== "number" || r.live < 0 || r.live > 1) E(`rooms[${i}].live must be in [0,1]`);
    if (typeof r.name !== "string" || !r.name.length || r.name.length > 28) E(`rooms[${i}].name must be 1..28 chars`);
  });
  const seen = new Set();
  L.seams.forEach((s, i) => {
    if (!Array.isArray(s) || s.length !== 2 || s.some(x => !Number.isInteger(x) || x < 0 || x >= n))
      return E(`seams[${i}] endpoints must be valid room ids`);
    const k = Math.min(...s) + ":" + Math.max(...s);
    if (seen.has(k)) E(`seams[${i}] duplicate seam ${k}`); seen.add(k);
  });
  const hasSeam = (a, b) => L.seams.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  L.envelopes.forEach((h, i) => {
    if (!Number.isInteger(h.from) || h.from < 0 || h.from >= n) E(`envelopes[${i}].from invalid`);
    if (!Number.isInteger(h.to) || h.to < 0 || h.to >= n) E(`envelopes[${i}].to invalid`);
    if (h.from === h.to) E(`envelopes[${i}] from===to`);
    else if (Number.isInteger(h.from) && Number.isInteger(h.to) && !hasSeam(h.from, h.to))
      E(`envelopes[${i}] has no seam ${h.from}→${h.to} (hopPath would walk uncarved wall)`);
    if (h.verdict !== undefined && !VERDICTS.includes(h.verdict)) E(`envelopes[${i}].verdict '${h.verdict}' not in enum {${VERDICTS.join(",")}}`);
    if (h.keepers !== undefined && (!Number.isInteger(h.keepers) || h.keepers < 1 || h.keepers > 5)) E(`envelopes[${i}].keepers must be int 1..5`);
    const g = h.transform?.badge;
    if (g !== undefined && (typeof g !== "string" || [...g].length < 1 || [...g].length > 2)) E(`envelopes[${i}].transform.badge must be 1..2 chars`);
    if (h.wave !== undefined && !Number.isInteger(h.wave)) E(`envelopes[${i}].wave must be an integer`);
    // rev 2 — the gate block (hardness is DECLARED data; renderer never invents enforcement)
    if (h.gate !== undefined) {
      if (typeof h.gate !== "object" || h.gate === null) E(`envelopes[${i}].gate must be an object`);
      else {
        if (h.gate.hardness !== undefined && !HARDNESS.includes(h.gate.hardness))
          E(`envelopes[${i}].gate.hardness '${h.gate.hardness}' not in enum {${HARDNESS.join(",")}}`);
        for (const f of ["mechanism", "help", "teaches"])
          if (h.gate[f] !== undefined && (typeof h.gate[f] !== "string" || h.gate[f].length > 120))
            E(`envelopes[${i}].gate.${f} must be a string ≤120 chars`);
      }
    }
  });
  // rev 2 — the thread (clews[] is optional; structure is not)
  if (L.clews !== undefined) {
    if (!Array.isArray(L.clews)) E("clews must be an array");
    else L.clews.forEach((c, i) => {
      if (!c || typeof c !== "object") return E(`clews[${i}] must be an object`);
      if (!Number.isInteger(c.room) || c.room < 0 || c.room >= n) E(`clews[${i}].room invalid`);
      if (!Number.isInteger(c.divergence) || c.divergence < 0 || c.divergence >= L.envelopes.length)
        E(`clews[${i}].divergence must index an envelope`);
      if (!CLEW_ROUTING.includes(c.routing)) E(`clews[${i}].routing '${c.routing}' not in enum {${CLEW_ROUTING.join(",")}}`);
      if (!CLEW_DROPPED_BY.includes(c.dropped_by)) E(`clews[${i}].dropped_by '${c.dropped_by}' not in enum {${CLEW_DROPPED_BY.join(",")}}`);
      if (typeof c.packet_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(c.packet_digest))
        E(`clews[${i}].packet_digest must be 'sha256:<64 hex>' (JCS-sha256, S3.1)`);
    });
  }
  // rev 2 — IMPASSE is empty-handed-but-honest: it MUST drop a thread.
  // An IMPASSE envelope without a clews entry pointing at it is rejected.
  L.envelopes.forEach((h, i) => {
    if (h.verdict === "IMPASSE" &&
        !(Array.isArray(L.clews) && L.clews.some(c => c && c.divergence === i)))
      E(`envelopes[${i}].verdict IMPASSE has no clews entry (divergence=${i}) — the thread is the move`);
  });
  return { ok: errs.length === 0, errors: errs };
}

// Default the optionals in place (evolution rule). Returns the level.
export function defaultLevel(L) {
  L.meta = L.meta ?? {};
  L.meta.contract_rev = L.meta.contract_rev ?? CONTRACT_REV;
  L.envelopes.forEach((h, i) => {
    h.verdict = h.verdict ?? "EMITTED";
    h.keepers = h.keepers ?? 1;
    h.wave = h.wave ?? i;
    h.transform = h.transform ?? { badge: "✦", line: "the handoff lands" };
    // rev 2: missing gate → fail-honest. A rev-1 level loads with hardness=unknown (HOLLOW).
    h.gate = h.gate ?? {};
    h.gate.hardness = h.gate.hardness ?? "unknown";
  });
  L.clews = L.clews ?? [];
  return L;
}

// rev 2 (SP-B6) — sanitizeText: escape-by-default, whitelist <b>/<i> only.
// EVERY level-sourced string the engine renders into HTML goes through this;
// the log's raw-innerHTML path is closed to untrusted levels. A <script> in a
// gateline renders inert (the red test). Inlined into game.html beside the
// validator copy, same CONTRACT_REV stamp.
export function sanitizeText(s) {
  if (typeof s !== "string") return "";
  const escaped = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  // re-admit ONLY bare <b>/<i> pairs (no attributes — an attribute is a surface)
  return escaped
    .replace(/&lt;(\/?)b&gt;/g, "<$1b>")
    .replace(/&lt;(\/?)i&gt;/g, "<$1i>");
}
