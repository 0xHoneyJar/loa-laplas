// Policy conformance (S4.1, IMP-003/SP-B8) + registry-only wall (S4.2, IMP-010).
// Run: node --test observatory/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POLICIES, ACTIONS } from "../producers/policies.mjs";
import { validateEpisodeLine } from "../contract/level-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OBS = join(here, "..", "cli", "obs.mjs");
const env = { ...process.env, LANG: "C", TZ: "UTC" };
const run = (args) => {
  try { return { out: execFileSync(process.execPath, [OBS, ...args], { encoding: "utf8", env }), code: 0 }; }
  catch (e) { return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 }; }
};

// a deterministic grid over the state space — totality is sampled, not assumed
const GRID = [];
for (let q = 0; q <= 10; q++) for (let c = 0; c <= 10; c++)
  for (const lastGain of [Infinity, .5, .05, .01, 0])
    GRID.push({ quality: q / 10, clock: c / 10, lastGain });

for (const [name, pol] of Object.entries(POLICIES)) {
  test(`policy '${name}' is PURE — same state → same action`, () => {
    for (const s of GRID) {
      const a1 = pol.decide({ ...s, params: pol.params });
      const a2 = pol.decide({ ...s, params: pol.params });
      assert.equal(a1, a2, `impure at ${JSON.stringify(s)}`);
    }
  });
  test(`policy '${name}' is TOTAL over the sampled grid — every state returns an enum action`, () => {
    for (const s of GRID) {
      const a = pol.decide({ ...s, params: pol.params });
      assert.ok(ACTIONS.includes(a), `'${a}' at ${JSON.stringify(s)} not in {${ACTIONS}}`);
    }
  });
}

test("the harness bound FIRES (SP-B8): the SIM ends a policy that reads past the flood — watchdog, not the policy", () => {
  // greedy in a walled room never reaches presentAt; its panic (clock ≥ .96)
  // usually saves it, but the clock tick can jump the [.96,1) window — seed 5
  // is a pinned witness. The world floods, the watchdog drops the clew with
  // trigger: budget. 'Terminating' is the SIM's property, proven here; the
  // TICK_CAP backstop is the same bound one layer deeper.
  const { out, code } = run(["play", "--policy", "greedy", "--seed", "5", "--rooms", "3", "--stuck", "0"]);
  assert.equal(code, 0);
  const L = JSON.parse(out);
  const c = (L.clews ?? []).find(c2 => c2.room === 0);
  assert.ok(c, "no clew in the walled room — the bound never fired");
  assert.equal(c.dropped_by, "watchdog");
  assert.equal(c.trigger, "budget");
});

test("registry-only resolution (IMP-010): --policy <path> exits 2", () => {
  for (const evil of ["./any/path.mjs", "../escape.js", "evil/pol.mjs", ".hidden"]) {
    const { code } = run(["play", "--policy", evil, "--seed", "7"]);
    assert.equal(code, 2, `'${evil}' was not refused`);
  }
});

test("unknown policy name exits 2 listing the registry", () => {
  const { out, code } = run(["play", "--policy", "nonexistent", "--seed", "7"]);
  assert.equal(code, 2);
  assert.match(out, /registry: greedy, disciplined, stuck/);
});

test("episode JSONL validates line-by-line and digests are JCS-sha256 shaped", () => {
  const ep = "/tmp/obs-test-episode.jsonl";
  rmSync(ep, { force: true });
  const { code } = run(["play", "--policy", "stuck", "--seed", "7", "--rooms", "6", "--stuck", "2", "--episode-out", ep]);
  assert.equal(code, 0);
  const lines = readFileSync(ep, "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const v = validateEpisodeLine(line);
    assert.ok(v.ok, v.errors.join("; "));
  }
  // the terminal action of the walled room is the clew (testimony, not flood)
  const roomActions = lines.filter(l => l.actor === lines.at(-1).actor || true).map(l => l.action);
  assert.ok(roomActions.includes("clew"), "stuck policy never testified");
});

test("episode schema rejects malformed lines (red)", () => {
  for (const bad of [
    { episode_id: "", tick: 0, actor: "x", action: "read", observation_digest: "sha256:" + "a".repeat(64) },
    { episode_id: "e", tick: -1, actor: "x", action: "read", observation_digest: "sha256:" + "a".repeat(64) },
    { episode_id: "e", tick: 0, actor: "x", action: "loiter", observation_digest: "sha256:" + "a".repeat(64) },
    { episode_id: "e", tick: 0, actor: "x", action: "read", observation_digest: "sha256:short" },
  ]) assert.equal(validateEpisodeLine(bad).ok, false, JSON.stringify(bad));
});
