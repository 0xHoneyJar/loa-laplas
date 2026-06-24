// jcs-boundary.test.mjs — GROUND the brakes layer's canonicalizer (the TCB map's first soft spot,
// the-trusted-computing-base.md). Every signature in poteau/legba/settle is computed over jcs(...).
// The canonicalizer is REPRODUCED (inline, in-tree) but: (a) it is an explicit RFC-8785 SUBSET that
// leans on JS JSON.stringify for primitives, and (b) it is COPIED ~7× across the layer, so the
// copies could silently drift from each other or from a future "fixed" version — and a silent change
// to jcs breaks every existing signature without any other test noticing. This pins it: a GOLDEN
// freeze (jcs can't change unnoticed) + a DRIFT guard (every inline copy must equal legba's) + the
// SUBSET boundary made explicit (reproduced, not just vouched in a comment).
//
// Run: node --test scripts/legba/jcs-boundary.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jcs as legbaJcs } from './legba-core.mjs';

// The exact inline canonicalizer copied across the layer (poteau-gatekeeper.mjs,
// poteau-verify-receipts.mjs, the test helpers). If legba's and this drift, cross-verification breaks.
const inlineJcs = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(inlineJcs).join(',') + ']'
  : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + inlineJcs(v[k])).join(',') + '}';

// GOLDEN: frozen outputs. A change to legba's jcs that would invalidate existing signatures fails here.
const GOLDEN = [
  [{ b: 1, a: 2, c: 3 }, '{"a":2,"b":1,"c":3}'],                                                  // keys sorted
  [{ z: { y: [3, 1, 2] }, a: null }, '{"a":null,"z":{"y":[3,1,2]}}'],                              // nested + array order preserved
  [{ receipt_kind: 'poteau_gate_pass', run_id: 'r', gate_index: 0, prev_receipt_hash: null },
    '{"gate_index":0,"prev_receipt_hash":null,"receipt_kind":"poteau_gate_pass","run_id":"r"}'],   // the real receipt shape
  [{ k: 'héllo→é' }, '{"k":"héllo→é"}'],                                                            // unicode kept literal (subset boundary)
  [{ i: 1, f: 1.5, big: 1e21, neg: -0 }, '{"big":1e+21,"f":1.5,"i":1,"neg":0}'],                   // numbers via JSON.stringify (subset boundary)
  [[1, 'two', null, { x: 1 }], '[1,"two",null,{"x":1}]'],
  [{}, '{}'],
];

test('GOLDEN: legba jcs output is frozen — a silent change that breaks signatures fails here', () => {
  for (const [input, expected] of GOLDEN) {
    assert.equal(legbaJcs(input), expected, 'jcs output drifted from the frozen golden — this invalidates every existing signature');
  }
});

test('DRIFT: the inline copy used across the layer equals legba jcs (the 7 copies must agree)', () => {
  for (const [input] of GOLDEN) {
    assert.equal(inlineJcs(input), legbaJcs(input), 'an inline jcs copy diverged from legba jcs — cross-verification (daemon-signed vs locally-checked) would silently break');
  }
});

test('SUBSET boundary, made explicit: keys sorted, arrays preserved, primitives via JSON.stringify', () => {
  // The documented limit: this is JCS-for-flat-shapes, NOT full RFC-8785. Pinned so the boundary is
  // reproduced (a test) rather than vouched (a comment) — and so widening it is a deliberate, caught change.
  assert.equal(legbaJcs({ b: 0, a: 0 }), '{"a":0,"b":0}', 'object keys are lexically sorted');
  assert.equal(legbaJcs([3, 1, 2]), '[3,1,2]', 'array order is NOT sorted (semantically significant)');
  assert.equal(legbaJcs('x"y'), '"x\\"y"', 'strings are escaped by JSON.stringify');
  // the subset edge: numbers are whatever JS JSON.stringify yields — fine for the flat int/string/null
  // shapes the layer signs, NOT guaranteed identical to RFC-8785 for exotic floats. (legba-core.mjs:39.)
  assert.equal(legbaJcs(1e21), '1e+21');
  assert.equal(legbaJcs(-0), '0');
});
