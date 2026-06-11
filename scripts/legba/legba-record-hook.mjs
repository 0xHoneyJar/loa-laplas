#!/usr/bin/env node
/**
 * legba-record-hook.mjs — PostToolUse hook shape for involuntary move capture
 * (LG-1: recording is hook-enforced, NEVER agent-voluntary).
 *
 * Claude Code calls a PostToolUse hook with a JSON event on stdin describing the
 * tool call. This hook reads the active Legba run from $LEGBA_RUN_DIR (set by the
 * compose-dispatch executor when a composition run opens), classifies the tool's
 * determinism from the manifest, and appends ONE chained SpanMove. The agent
 * cannot opt out — that is the whole point (the gradient flip: recording is free
 * and automatic, confabulation is the path that gets fraud-proven later).
 *
 * This file is the WIRING SHAPE, not yet attached to settings.json. Attaching it
 * (and threading $LEGBA_RUN_DIR / $LEGBA_SPAN_INDEX through compose-dispatch) is
 * the integration step the README calls out. Until then, drive recording via the
 * `legba record` CLI explicitly.
 *
 * Determinism classification (LG-5): a tool is `re_executable` ONLY if it is in
 * the run's tool manifest as such; everything else defaults to `attestable`
 * (hash-only, never replayed). Nondeterministic tools (network/clock/randomness)
 * MUST be attestable — the lint that enforces this is the manifest's job.
 */
import { record } from './legba-core.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RE_EXECUTABLE = new Set((process.env.LEGBA_REEXEC_TOOLS || 'arith,dpr').split(',').map((s) => s.trim()));

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

(async () => {
  const dir = process.env.LEGBA_RUN_DIR;
  if (!dir || !existsSync(join(dir, 'manifest.json'))) {
    // No active Legba run — no-op (the hook is harmless when not in a run).
    process.exit(0);
  }
  const spanIndex = Number(process.env.LEGBA_SPAN_INDEX || 0);
  const runId = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).run_id;

  let event = {};
  try { event = JSON.parse(await readStdin() || '{}'); } catch { /* tolerate non-JSON */ }

  // Claude Code PostToolUse event shape: { tool_name, tool_input, tool_response }.
  const tool = event.tool_name || 'unknown';
  const determinism = RE_EXECUTABLE.has(tool) ? 're_executable' : 'attestable';
  try {
    if (determinism === 're_executable') {
      record(dir, { runId, spanIndex, kind: 'tool', determinism, tool, input: event.tool_input ?? {}, output: event.tool_response ?? {} });
    } else {
      record(dir, { runId, spanIndex, kind: 'emission', determinism: 'attestable', label: tool, content: { input: event.tool_input ?? null, response: event.tool_response ?? null } });
    }
  } catch (e) {
    // A recorder failure must be LOUD (LEGBA_MOVE_TOO_LARGE / SETUP_REQUIRED) but
    // must not crash the agent's turn — surface to stderr, exit 0.
    process.stderr.write(`legba-record-hook: ${e.message}\n`);
  }
  process.exit(0);
})();
