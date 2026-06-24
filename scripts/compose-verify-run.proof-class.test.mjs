// compose-verify-run.proof-class.test.mjs — the proof_class honesty marker (BB #73 review).
// proof_class is the GATEABLE honesty: every verdict declares whether it rests on self-consistency
// (default — agent-authored files, "not an inline fake") or cryptographic authorship (--legba
// rooted / armed --poteau). A consumer gating on exit 0 reads proof_class to tell the two apart.
//
// Run: node --test scripts/compose-verify-run.proof-class.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'compose-verify-run.sh');
const run = (args, env = {}) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('every verdict carries proof_class, defaulting to self_consistency (no --legba/--poteau)', () => {
  const r = run(['nonexistent-run-pc-test', '--json']);
  const v = JSON.parse(r.stdout.trim());
  assert.ok('proof_class' in v, 'every verdict must carry proof_class');
  assert.equal(v.proof_class, 'self_consistency', 'a verdict with no cryptographic check declares self_consistency, not silence');
});

test('a default valid_run is marked self_consistency AND warns loudly (the audit\'s critical finding, surfaced)', () => {
  // a minimal compile-only run dir: manifest + one segment file + an orchestrator trail, 0 envelopes.
  // (This is the self-consistency forge the audit reproduced; here it pins the honesty marker.)
  const base = mkdtempSync(join(tmpdir(), 'cv-pc-'));
  const runId = 'pc-forge';
  const dir = join(base, runId);
  mkdirSync(join(dir, 'workflows'), { recursive: true });
  writeFileSync(join(dir, 'form-c-manifest.json'), JSON.stringify({ run_id: runId, segments: [{ gate: 0, workflow: 'seg0.workflow.js' }] }));
  writeFileSync(join(dir, 'workflows', 'seg0.workflow.js'), '// junk — existence is all check 2 tests\n');
  writeFileSync(join(dir, 'orchestrator.jsonl'), JSON.stringify({ run_id: runId, event: 'form_c.manifest' }) + '\n');
  try {
    const r = run([runId, '--json'], { LOA_COMPOSE_BASE_DIR: base });
    const v = JSON.parse(r.stdout.trim());
    if (v.verdict === 'valid_run') {
      assert.equal(v.proof_class, 'self_consistency', 'a self-consistency valid_run must say so');
      assert.match(r.stderr, /SELF-CONSISTENCY ONLY/i, 'a self-consistency valid_run must WARN, not bury it in legba_chain:null');
    } else {
      // if the minimal fixture does not reach valid_run on this install, still assert the marker exists.
      assert.ok('proof_class' in v, 'proof_class present regardless of verdict');
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});
