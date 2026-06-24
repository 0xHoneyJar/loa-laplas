// descent-example-stub — a MINIMAL second substrate, the proof that the descent procedure
// (grimoires/loa/runbooks/descent-procedure.md) is REUSABLE, not settle-bespoke.
//
// It walks the same rail settle did: scripts-first .mjs, composes legba (zero inline crypto,
// no own ed25519 signer), ships its teeth (stub.test.mjs incl. a negative control).
// `node scripts/descend-check.mjs scripts/descent-example-stub` validates it generically.
import { sign as legbaSign, verify as legbaVerify, generateVerifierKeypair, hashObj } from '../legba/legba-core.mjs';

// A trivial "sealed value" substrate: seal(value) signs a canonical body; openSealed verifies.
export function seal(value, privKey) {
  const body = { value, id: hashObj({ value }) };
  const sig = legbaSign(Buffer.from(JSON.stringify(body)), privKey).toString('base64');
  return { body, sig };
}

export function openSealed(sealed, pubKey) {
  return legbaVerify(Buffer.from(JSON.stringify(sealed.body)), Buffer.from(sealed.sig, 'base64'), pubKey);
}

export { generateVerifierKeypair };
