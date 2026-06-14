// claude-provider.mjs — the default split-goal provider: one headless sonnet call via the
// `claude` CLI, prompt on stdin. RUNTIME PATH ONLY — deliberately NOT unit-tested (tests inject
// a mock provider per Flatline D8). Kept to a few lines so that if the CLI shape drifts, this
// is the single place to fix. A throw here surfaces as splitGoal LLM_FAILURE → exit 5.
import { spawnSync } from 'node:child_process';

export async function defaultProvider(prompt) {
  const res = spawnSync('claude', ['-p', '--model', 'sonnet'], {
    input: String(prompt), encoding: 'utf8', timeout: 60_000, maxBuffer: 1 << 22,
  });
  if (res.error) throw new Error(`claude CLI: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`claude CLI exit ${res.status}: ${(res.stderr ?? '').slice(0, 200)}`);
  return res.stdout;
}
