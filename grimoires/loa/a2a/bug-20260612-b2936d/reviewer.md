# Implementation Report — bug-20260612-b2936d: poteau gate forgeable (FR-E)

## Executive Summary

Closed the live forgery (run `20260613-b115bb`): a single work agent self-minted a
valid `poteau_gate_pass` by reflecting the readable run-state into a packet with
fabricated **unsigned** council strings. The fix hardens the gatekeeper's council
check (G4) from a string-count to **Ed25519 signature verification**, and — per the
operator's explicit scope decision — brings **FR-E (cryptographic council)** forward
to complete the green path: the council runner now **signs** each receipt with a
per-provider reviewer key, the seeder **provisions** the matching public keys, and a
tool-gate read-fence keeps reviewer **private** keys out of the governed agent's reach.

**Result:** a self-reflected packet now REFUSES (P204); a genuinely-signed
distinct-reviewer council still MINTS. Demo 32/32, laplas 35/35, bats 94/94.

**Author/judge isolation, reframed:** we deliberately do NOT restrict *who* writes
`packet.json` (unenforceable on a shared FS — would be form, not substance). Isolation
is enforced where it can be — the packet's PASS requires valid council signatures from
keys a self-reflecting agent does not hold.

## AC Verification

1. **"Self-reflected packet no longer mints a `poteau_gate_pass` — the gate REFUSES."**
   - ✓ Met — `poteau/bin/poteau-gatekeeper.mjs:78-110` (G4) verifies Ed25519 signatures
     against `run_state.review_routing.reviewer_keys`; fabricated `reviewer_id` strings
     yield 0 valid signatures → P204. Proven: `poteau/test/run-demo.sh` row 25
     ("FORGERY: self-reflected packet … REFUSES") + row 26 (names P204). Demo 30/30.

2. **"Live re-validation: re-drive `20260613-b115bb`-shaped teeth; a work agent's
   self-reflected packet REFUSES."**
   - ⚠ Partial — the exact live forgery shape (copied task_ref, copied H1, fabricated
     unsigned council strings) is reproduced deterministically in
     `poteau/test/forge-fixture.mjs` and REFUSES at the gatekeeper (run-demo row 25) —
     this is conclusive re-validation of the judge. The **full live-agent re-drive**
     (re-merge hooks + a real work agent reflecting a council:true run-state) is the
     operator-gated capstone: it needs the hook re-merge (operator's act) + agent tokens.
     Offered as the final confirmation; not a code deliverable. No scope-split needed —
     the gatekeeper logic is fully covered; the live-agent run is a stronger form of the
     same already-proven claim.

3. **"Failing test added to the fixture harness proves the fix; INVENTORY count updated."**
   - ✓ Met — `poteau/test/run-demo.sh` rows 25-27 (forgery REFUSES, names P204, signed
     council MINTS); `poteau/test/INVENTORY.md` count 27→30 with 3 matching rows
     (count-drift CI reconciled: demo RESULT 30 == 30 rows).

4. **"No regressions: all existing `run-demo.sh` assertions pass; green path mints."**
   - ✓ Met — demo 30/30 (the prior 27 still green, incl. the non-council mint ladder);
     laplas 35/35 (incl. `council.test.mjs` S4.2 green path); bats 94/94. One existing
     assertion's wording was updated to match the honest G3 reframe (run-demo.sh:41 +
     INVENTORY row 7: "proof-of-grounding" → "grounding heuristic").

5. **"Root cause addressed (author/judge isolation + signed council + honest grounding),
   not symptoms."**
   - ✓ Met — (a) **signed council**: G4 verifies signatures, not strings
     (`poteau-gatekeeper.mjs:78-110`); (b) **author/judge isolation**: substance-gating —
     the PASS requires keys the author lacks (`tool-gate.sh:22-31` documents why
     write-gating is not used); (c) **honest grounding**: G3 reframed as a heuristic with
     the declared run-state-copyability limit (`poteau-gatekeeper.mjs:67-78`).

## Audit Feedback Addressed (iteration 3)

**Cross-run/cross-gate replay (security audit, MEDIUM)** — the council signature bound to
packet content but not to the run or gate, so a byte-identical packet's genuine signatures
verified under a different `run_id` (audit probe 1d → `pass:true`). Closed.

- Fix: the reviewer now signs the **council subject** = `sha(jcs({gate_index, packet_hash,
  run_id}))`; the gatekeeper recomputes the same subject from `rs.run_id` / `rs.gate_index`
  and verifies against it. A signature is valid for exactly one `(packet, run, gate)`.
  - `poteau/bin/poteau-gatekeeper.mjs` G4 — `councilSubject` from `rs.run_id`/`rs.gate_index`.
  - `scripts/council-run.sh` — `--run-id`/`--gate-index` args; computes the same subject.
  - `laplas/test/council.test.mjs` — `council()` threads run+gate; S4.2 passes them from `rs`.
  - `poteau/test/forge-fixture.mjs` — signs the subject (run_id `forge-run`, gate_index 0).
- Verified: audit probe 1d now REFUSES (`P204`); `run-demo.sh` row 29 ("CROSS-RUN REPLAY …
  REFUSE") asserts it; same packet under its own run_id still mints; demo 32/32, laplas 35/35
  (S4.2 green), bats 94/94. The entire replay class (same-task, different-packet, cross-run,
  cross-gate) is now closed.

## Review Feedback Addressed (iteration 2)

**C-REPLAY (senior lead, BLOCKING)** — *"council signatures are replayable (not bound
to the packet)."* Confirmed and fixed.

- Root cause: G4 verified the signature over `jcs({task_ref, verdict})` — the task,
  not the packet. Genuine signatures replayed onto a different packet with the same
  `(task_ref, verdict)` minted (`pass:true`).
- Fix: the reviewer now signs the **packet content hash** = `sha(jcs(packet WITHOUT
  council_receipts))`; the gatekeeper recomputes it and verifies against it.
  - `poteau/bin/reviewer-keys.mjs:signCouncil` — signs an opaque packet_hash.
  - `scripts/council-run.sh` — signs `PACKET_HASH` (the work-packet hash it computes).
  - `poteau/bin/poteau-gatekeeper.mjs` G4 — `const {council_receipts,...packetCore}=packet;
    verify over Buffer.from(sha(jcs(packetCore)))`.
- Verified: the exact replay repro now REFUSES (`P204`, 0 valid signatures);
  `poteau/test/forge-fixture.mjs` emits `replay-packet.json`; `run-demo.sh` row 28
  ("REPLAY … REFUSE") asserts it. Green path still mints (demo row 27, laplas S4.2).
- Concern 2 (decorative packet_hash) is resolved by the same change — packet_hash is
  now load-bearing. Concern 3 (provider/key coupling) left as the noted non-blocking
  follow-up (the seeder records `review_routing.providers`; deriving the runner's list
  from it is a clean future tightening).

## Tasks Completed

| File | Change |
|------|--------|
| `poteau/bin/poteau-gatekeeper.mjs` | G4 string-count → Ed25519 signature verification against provisioned reviewer pubkeys; G3 honest reframe (heuristic + declared limit); `verify` import; receipt `checks.council` = verified voice count |
| `poteau/bin/reviewer-keys.mjs` (NEW) | FR-E reviewer keyset: per-provider Ed25519 keypair (lib + CLI: `pub` / `sign`); signs the gatekeeper's canonical `jcs({task_ref,verdict})`; declared on-disk fence-grade limit |
| `laplas/lib/seed-runstate.mjs` | On `council:true`, provision `review_routing.reviewer_keys` (public keys) per provider — without which a council run fails closed (P204) |
| `scripts/council-run.sh` | Each receipt now carries a `signature` over `{task_ref,verdict}` from the provider's reviewer key (FR-E runner half) |
| `poteau/hooks/tool-gate.sh` | Read+write fence on `.run/poteau/reviewers/` (reviewer private keys); documents author-isolation = substance-gating, not write-gating |
| `poteau/test/forge-fixture.mjs` (NEW) | Deterministic repro of the live forgery + signed green-path inverse |
| `poteau/test/run-demo.sh` | +3 forgery-regression assertions; G3 label reword |
| `poteau/test/INVENTORY.md` | Count 27→30; rows 25-27; row 7 reword |

## Testing Summary

- **Demo** (`POTEAU_SRC=$(pwd)/poteau bash poteau/test/run-demo.sh`): 32 passed, 0 failed
  (incl. row 28 replay-refusal + row 29 cross-run-replay-refusal).
- **Laplas** (`node --test laplas/test/*.test.mjs`): 35 passed, 0 failed (S4.2 council
  green path mints with signed receipts; benchmarks P204 still refuses no-council).
- **Bats** (`bats tests/integration/form-c-dispatch.bats`): 94 ok, 0 not ok.
- **Fence** smoke: Read/Bash on `.run/poteau/reviewers/*.key` → exit 2; legit `.claude`
  read → exit 0.

## Known Limitations (declared, honest)

- **On-disk reviewer keys are FENCE-grade.** The tool-gate read-fence is
  subshell-bypassable (the documented tool-gate posture). HARD isolation is a
  **deployment property**: reviewer private keys must live outside the governed
  agent's reach (separate process/host). The code provides the mechanism; the
  deployment must provide the isolation. Documented at `poteau/bin/reviewer-keys.mjs`
  and `poteau/bin/poteau-gatekeeper.mjs` (G4 block).
- **G3 grounding remains a heuristic**, not a proof — reframed honestly, not
  over-claimed. Closing it absolutely needs an out-of-band check (the gatekeeper
  reading the actual file), deferred.

## Verification Steps (for reviewer/auditor)

1. `POTEAU_SRC=$(pwd)/poteau bash poteau/test/run-demo.sh` → 30/30, rows 25-27 green.
2. `node --test laplas/test/*.test.mjs` → 35/35 (S4.2 green).
3. `bats tests/integration/form-c-dispatch.bats` → 94/94.
4. Forgery directly: `node poteau/test/forge-fixture.mjs && jq -n --argjson rs "$(cat .run/poteau/forge/run-state.json)" --argjson p "$(cat .run/poteau/forge/forged-packet.json)" '{run_state:$rs,packet:$p}' | node poteau/bin/poteau-gatekeeper.mjs` → `{pass:false, code:"P204"}`.
