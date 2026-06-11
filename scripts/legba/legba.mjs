#!/usr/bin/env node
/**
 * legba — operator CLI for the Legba substrate (file-backed).
 *
 *   legba init-keys [--gatekeeper ID]            run the key ceremony (once per room)
 *   legba provision <run-id> [--gatekeeper ID] [--run-dir DIR]
 *   legba record <run-dir> --span N --tool NAME --input JSON --output JSON [--det re_executable|attestable]
 *   legba record <run-dir> --span N --emit LABEL --content JSON
 *   legba open <run-dir> --span N               turnstile: refuses without prior gate token
 *   legba gate <run-dir> --gate N [--artifact JSON ...]
 *   legba verify <run-dir>                       third-party verification (public key only)
 *   legba challenge <run-dir> --span N --seq K   fraud proof by re-execution
 *   legba demo [--run-dir DIR]                   full lifecycle + 3 attacks, on real files
 *
 * The operator-facing verbs are `verify` and `challenge`: point them at any run
 * dir and get a cryptographic verdict / fraud proof. Exit 0 = ok, 1 = refused/failed.
 */
import {
  initKeys, provisionRun, record, gate, openSpan, verifyRun, challenge,
  runDir, readSpanLog, CONTRACT_VERSION,
} from './legba-core.mjs';
import { REGISTRY } from './tools.mjs';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

function parseFlags(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      if (k === 'artifact') (f.artifact ||= []).push(v); else f[k] = v;
    } else f._.push(a);
  }
  return f;
}
const J = (s) => (typeof s === 'string' ? JSON.parse(s) : s);
const out = (o) => console.log(JSON.stringify(o, null, 2));

const [cmd, ...rest] = process.argv.slice(2);
const f = parseFlags(rest);

try {
  switch (cmd) {
    case 'init-keys': {
      const gk = initKeys(f.gatekeeper || 'legba:default');
      out({ ok: true, gatekeeper_id: gk.gatekeeperId, key_id: gk.key_id, contract_version: CONTRACT_VERSION });
      break;
    }
    case 'provision': {
      const runId = f._[0];
      const gk = initKeys(f.gatekeeper || 'legba:default');
      const man = provisionRun(runId, gk, f['run-dir']);
      out({ ok: true, run_dir: runDir(runId, f['run-dir']), manifest: man });
      break;
    }
    case 'record': {
      const dir = f._[0];
      const runId = f.run || JSON.parse(readManifestRaw(dir)).run_id;
      const spanIndex = Number(f.span);
      const h = f.emit
        ? record(dir, { runId, spanIndex, kind: 'emission', determinism: 'attestable', label: f.emit, content: J(f.content) })
        : record(dir, { runId, spanIndex, kind: 'tool', determinism: f.det || 're_executable', tool: f.tool, input: J(f.input), output: J(f.output) });
      out({ ok: true, record_hash: h });
      break;
    }
    case 'open': {
      const r = openSpan(f._[0], { runId: manifestRunId(f._[0]), spanIndex: Number(f.span) });
      out({ ok: r.ok, span: Number(f.span), opened: true });
      break;
    }
    case 'gate': {
      const dir = f._[0];
      const sealed = gate(dir, {
        runId: manifestRunId(dir), gateIndex: Number(f.gate),
        registry: REGISTRY, artifacts: (f.artifact || []).map(J),
      });
      out({ ok: sealed.token.verdict === 'pass', verdict: sealed.token.verdict, token_hash: sealed.token_hash, checks: sealed.token.checks });
      process.exit(sealed.token.verdict === 'pass' ? 0 : 1);
      break;
    }
    case 'verify': {
      const report = verifyRun(f._[0]);
      out(report);
      process.exit(report.ok ? 0 : 1);
      break;
    }
    case 'challenge': {
      const r = challenge(f._[0], Number(f.span), Number(f.seq), REGISTRY);
      out(r);
      process.exit(r.challengeable && r.ok ? 0 : 1);
      break;
    }
    case 'demo': {
      runDemo(f['run-dir']);
      break;
    }
    default:
      console.error('usage: legba <init-keys|provision|record|open|gate|verify|challenge|demo> ...');
      process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

function manifestRunId(dir) {
  return JSON.parse(readManifestRaw(dir)).run_id;
}
function readManifestRaw(dir) {
  const p = join(dir, 'manifest.json');
  if (!existsSync(p)) throw new Error(`LEGBA_SETUP_REQUIRED: no manifest at ${p} (run \`legba provision\` first)`);
  return readFileSync(p, 'utf8');
}

// ── demo: the whole lifecycle + three attacks, on REAL files ────────────────
function runDemo(baseFlag) {

  const runId = 'legba-demo';
  const dir = baseFlag || join(homedir(), '.loa', 'runs', runId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const gk = initKeys('legba:demo');
  provisionRun(runId, gk, dir);
  const line = (l) => console.log(l);

  line('══ SPAN 0 — agent computes (re_executable tool + attestable emission) ══');
  record(dir, { runId, spanIndex: 0, kind: 'emission', determinism: 'attestable', label: 'plan', content: { note: 'evaluate the damage formula' } });
  record(dir, { runId, spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '2 + 3 * 4' }, output: { result: 14 } });
  record(dir, { runId, spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'dpr', input: { hit: 0.65, dmg: 7, crit: 0.05, critMult: 2 }, output: { dpr: 4.9 } });
  line(`  moves recorded                        ${readSpanLog(dir, 0).length}`);

  line('\n══ GATE 0 — Legba validates, mints the key ══');
  const t0 = gate(dir, { runId, gateIndex: 0, registry: REGISTRY, artifacts: [{ kind: 'analysis', summary: 'dpr=4.9' }] });
  line(`  verdict                               ${t0.token.verdict}`);
  line(`  checks                                ${JSON.stringify(t0.token.checks)}`);

  line('\n══ TURNSTILE — span 1 without the key, then with it ══');
  // simulate "no key" by checking against a fresh run with no token
  try { openSpan(dir, { runId: 'other', spanIndex: 1 }); } catch (e) { line(`  wrong run                             ${e.message.split('.')[0]}`); }
  const o = openSpan(dir, { runId, spanIndex: 1 });
  line(`  with key                              span 1 OPEN (${o.ok})`);

  line('\n══ VERIFY — third party, public key + run dir only ══');
  const v = verifyRun(dir);
  line(`  run verifies                          ${v.ok ? 'PASS' : 'FAIL'}`);
  line(`  run receipt hash                      ${v.run_receipt_hash.slice(0, 30)}…`);

  line('\n══ ATTACK 1 — rewrite history: flip a recorded output ══');
  const logPath = join(dir, 'spans', 'span-0.log.jsonl');
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  lines[1].output_hash = 'deadbeef'.repeat(8);
  writeFileSync(logPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const vTamper = verifyRun(dir);
  line(`  tampered run verifies                 ${vTamper.ok ? 'PASS (!!)' : 'FAIL — caught (chain break)'}`);
  // restore for the next attack
  lines[1].output_hash = sha_of({ result: 14 });
  writeFileSync(logPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  line('\n══ ATTACK 2 — forge a gate token without Legba\'s private key ══');
  const tokPath = join(dir, 'tokens', 'token-0.json');
  const forged = JSON.parse(readFileSync(tokPath, 'utf8'));
  forged.token.verdict = 'pass'; forged.signature = Buffer.from('not-a-real-signature').toString('base64');
  writeFileSync(tokPath, JSON.stringify(forged));
  const vForge = verifyRun(dir);
  line(`  forged token verifies                 ${vForge.ok ? 'PASS (!!)' : 'FAIL — caught (signature invalid)'}`);
  // re-gate honestly to restore
  gate(dir, { runId, gateIndex: 0, registry: REGISTRY, artifacts: [{ kind: 'analysis', summary: 'dpr=4.9' }] });

  line('\n══ ATTACK 3 — confabulated tool output: claim a result the tool never produced ══');
  // honest move survives
  const honest = challenge(dir, 0, 1, REGISTRY);
  line(`  honest arith move challenged          ${honest.ok ? 'SURVIVES (recomputed == recorded)' : 'FAIL'}`);
  // write a confabulated move into a fresh span and challenge it
  record(dir, { runId, spanIndex: 0, kind: 'tool', determinism: 're_executable', tool: 'arith', input: { expr: '2 + 2' }, output: { result: 5 } });
  const conf = challenge(dir, 0, readSpanLog(dir, 0).length - 1, REGISTRY);
  line(`  confabulated move challenged          ${conf.ok ? 'SURVIVES (!!)' : 'FRAUD PROVEN — re-execution diverges'}`);
  line(`    recorded                            ${conf.recorded?.slice(0, 24)}…`);
  line(`    recomputed                          ${conf.recomputed?.slice(0, 24)}…`);

  line('\n══ and the boundary, stated honestly ══');
  const att = challenge(dir, 0, 0, REGISTRY);
  line(`  challenging a model emission          ${att.reason}`);
  line(`\nrun dir: ${dir}`);
}
function sha_of(o) {
  return createHash('sha256').update(jcsLocal(o)).digest('hex');
}
function jcsLocal(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcsLocal).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcsLocal(v[k])).join(',') + '}';
}
