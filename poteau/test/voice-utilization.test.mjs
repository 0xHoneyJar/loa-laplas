/**
 * voice-utilization.test.mjs — the SENSE sibling of voice-attestation.
 * voice-attestation PROVES one review used what it claims; this SENSES the
 * estate-wide trend: are the paid subscriptions (transport=cli) actually being
 * used, or is everything single-family claude? Turns the operator's intuition
 * ("we don't use codex/gemini/cursor as much as we should") into numbers.
 *
 * Run: node --test poteau/test/voice-utilization.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUtilization } from '../bin/voice-utilization.mjs';

function entry({ succeeded = [], failed = [], transport = 'cli', primitive = 'reviewing-diffs' }) {
  return {
    payload: {
      models_succeeded: succeeded,
      models_failed: failed.map((m) => (typeof m === 'string' ? { model: m } : m)),
      transport, calling_primitive: primitive,
    },
  };
}

test('counts dispatches per provider family', () => {
  const s = summarizeUtilization([
    entry({ succeeded: ['anthropic:claude-headless'] }),
    entry({ succeeded: ['anthropic:claude-opus-4-8'] }),
    entry({ succeeded: ['openai:codex-headless'] }),
  ]);
  assert.equal(s.totalDispatches, 3);
  assert.equal(s.byFamily.anthropic.count, 2);
  assert.equal(s.byFamily.openai.count, 1);
});

test('transport split distinguishes subscription (cli) from API (http) usage', () => {
  const s = summarizeUtilization([
    entry({ succeeded: ['openai:codex-headless'], transport: 'cli' }),
    entry({ succeeded: ['openai:gpt-5.2'], transport: 'http' }),
    entry({ succeeded: ['anthropic:claude-opus-4-8'], transport: 'http' }),
  ]);
  assert.equal(s.byTransport.cli, 1);
  assert.equal(s.byTransport.http, 2);
  // openai used both; the per-family transport split shows the subscription rate.
  assert.equal(s.byFamily.openai.cli, 1);
  assert.equal(s.byFamily.openai.http, 1);
});

test('flags under-utilized families below the threshold share', () => {
  // 9 anthropic + 1 openai → openai is 10%; with a 20% floor it is flagged.
  const entries = [];
  for (let i = 0; i < 9; i++) entries.push(entry({ succeeded: ['anthropic:claude-headless'] }));
  entries.push(entry({ succeeded: ['openai:codex-headless'] }));
  const s = summarizeUtilization(entries, { floorPct: 20 });
  assert.ok(s.underutilized.includes('openai'));
  assert.ok(!s.underutilized.includes('anthropic'));
});

test('single-family dominance: % of dispatches from the top family', () => {
  const entries = [];
  for (let i = 0; i < 19; i++) entries.push(entry({ succeeded: ['anthropic:claude-headless'] }));
  entries.push(entry({ succeeded: ['openai:codex-headless'] }));
  const s = summarizeUtilization(entries);
  assert.equal(s.topFamily, 'anthropic');
  assert.equal(s.topFamilySharePct, 95);
});

test('empty chain summarizes to zero without throwing', () => {
  const s = summarizeUtilization([]);
  assert.equal(s.totalDispatches, 0);
  assert.deepEqual(s.underutilized, []);
});

test('auto-detects a DEAD voice — fails repeatedly, never succeeds', () => {
  // gemini-shaped: dispatched (and failed) but never in models_succeeded.
  const entries = [
    entry({ succeeded: ['anthropic:claude-headless'] }),
    entry({ failed: ['google:gemini-headless'] }),
    entry({ failed: ['google:gemini-headless'] }),
    entry({ failed: ['google:gemini-headless'] }),
  ];
  const s = summarizeUtilization(entries);
  const dead = s.health.find((h) => h.family === 'google');
  assert.ok(dead, 'google should appear in health');
  assert.equal(dead.status, 'DEAD');           // failed thrice, succeeded zero
  assert.equal(dead.failed, 3);
  assert.equal(dead.succeeded, 0);
  assert.ok(s.deadVoices.includes('google'));
});

test('a DEGRADED voice fails often but sometimes succeeds', () => {
  const entries = [
    entry({ succeeded: ['openai:codex-headless'] }),
    entry({ failed: ['openai:codex-headless'] }),
    entry({ failed: ['openai:codex-headless'] }),
  ];
  const s = summarizeUtilization(entries);
  const o = s.health.find((h) => h.family === 'openai');
  assert.equal(o.status, 'DEGRADED');          // 2 of 3 failed but 1 succeeded
  assert.ok(!s.deadVoices.includes('openai'));
});

test('a healthy voice with no failures is HEALTHY', () => {
  const s = summarizeUtilization([entry({ succeeded: ['cursor:cursor-headless'] })]);
  assert.equal(s.health.find((h) => h.family === 'cursor').status, 'HEALTHY');
});

test('ignores corrupt (null) and shapeless entries', () => {
  const s = summarizeUtilization([
    null,
    { nope: true },
    entry({ succeeded: ['cursor:cursor-headless'] }),
  ]);
  assert.equal(s.totalDispatches, 1);
  assert.equal(s.byFamily.cursor.count, 1);
});
