// stub.test.mjs — the proof substrate's teeth (Phase 3 reusable-rail proof).
// Run: node --test scripts/descent-example-stub/stub.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { seal, openSealed, generateVerifierKeypair } from './stub.mjs';

test('seal/openSealed roundtrips via legba (composes, no inline crypto)', () => {
  const { privateKey } = generateVerifierKeypair();
  const pub = createPublicKey(privateKey);
  const sealed = seal('hello', privateKey);
  assert.equal(openSealed(sealed, pub), true);
});

test('NEGATIVE CONTROL: a tampered seal fails verification (the teeth)', () => {
  const { privateKey } = generateVerifierKeypair();
  const pub = createPublicKey(privateKey);
  const sealed = seal('hello', privateKey);
  sealed.body.value = 'tampered'; // mutate the signed body
  assert.equal(openSealed(sealed, pub), false);
});
