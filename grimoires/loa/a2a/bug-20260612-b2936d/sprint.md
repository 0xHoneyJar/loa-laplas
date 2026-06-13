# Sprint Plan: Bug Fix — poteau gate forgeable (work agent self-mints valid `poteau_gate_pass`)

**Type**: bugfix
**Bug ID**: 20260612-b2936d
**Source**: /bug (triage)
**Sprint**: sprint-bug-1
**Severity**: critical · **Risk**: high (trust-boundary / authorization) · **Repro**: strong (live, signatures verify)

---

## sprint-bug-1: poteau gate proves FORM, not SUBSTANCE

### Sprint Goal
Make a self-reflected packet — authored by a governed work agent with no genuine review, no real council, README never opened — REFUSE at the exit gate instead of minting a valid receipt. Restore adversarial isolation between the packet's author and the gate that judges it.

### Deliverables
- [ ] Failing integration test: a run-state-reflected packet (copied task_ref, copied H1 echo, fabricated unsigned council strings) is shown to currently MINT, then to REFUSE after the fix.
- [ ] G4 council fix: verify Ed25519-signed council receipts from distinct provisioned reviewer keys (not string-count).
- [ ] Mailbox authorship fix: scope the tool-gate carve-out so only the wire/executor authors packet.json; bind packet provenance to the gate stage.
- [ ] G3 grounding fix: require a grounding proof absent from the run-state; reframe the gate's claim honestly (documented limit).
- [ ] Green path preserved: a packet with genuinely signed distinct-reviewer council receipts + grounding proof still mints. All existing demo assertions stay green.
- [ ] INVENTORY.md updated with new assertion rows in the same commit (count-drift CI).

### Technical Tasks

#### Task 1: Write Failing Test [G-5]
- Add an adversarial assertion to the fixture harness `poteau/test/run-demo.sh`: arm a run mandating a council (`min_voices:2`) and a grounded read; emit a packet built ENTIRELY by reflecting the readable run-state (copy `task_ref`, copy `mandated_reads[].h1` into the rationale, set `council_receipts` to >=2 distinct fabricated `reviewer_id` STRINGS with no signatures, assert `conformance.in_scope:true`); drive `exit-gate.sh`.
- Verify the test currently FAILS the desired contract — i.e. the gate MINTS today (mirrors the live `20260613-b115bb` forgery). This is the red state.
- Add the matching row(s) to `poteau/test/INVENTORY.md` (the RESULT line must equal the row count or CI refuses).

**Acceptance Criteria**:
- The new assertion expresses "self-reflected packet must REFUSE (exit 2)"; against current code the gate mints, demonstrating the bug.
- Test is isolated (scratch-dir fixture, per the existing `run-demo.sh` mktemp pattern).
- INVENTORY.md count matches the demo RESULT line.

#### Task 2: Implement Fix [G-1, G-2]
- **G4 council** (`poteau/bin/poteau-gatekeeper.mjs:78-83`): replace the `reviewer_id` string-count with Ed25519 signature verification — each council receipt must carry a valid signature from a DISTINCT provisioned reviewer public key; refuse (P204) on fewer than `min_voices` VALID signatures.
- **Mailbox authorship** (`poteau/hooks/tool-gate.sh:33-37`): scope the `packet.json` carve-out to the wire/executor only; bind packet provenance to the gate stage's actual output so an arbitrary run-participant subagent cannot self-author the door.
- **G3 grounding** (`poteau/bin/poteau-gatekeeper.mjs:67-76`): require a grounding proof NOT already in the run-state (section content-hash or a passage absent from run-state). Reframe the gate's claim honestly — grounding is a heuristic, not a hard proof (document the acknowledged limit in the code comment / ARCHITECTURE).
- Verify the Task-1 failing assertion now REFUSES; run the full `run-demo.sh` suite.

**Acceptance Criteria**:
- The self-reflected (unsigned-council / run-state-only) packet REFUSES — gate does not mint.
- A genuine packet (signed distinct-reviewer council receipts + non-run-state grounding proof) STILL mints (green path preserved).
- All pre-existing demo assertions remain green; failure posture intact (custody → P500 exit 5, policy → exit 2).
- The fix is authored as a reviewed commit, NOT from inside a run (tool-gate denies in-run edits to `poteau/`).

### Acceptance Criteria
- [ ] Self-reflected packet no longer mints a `poteau_gate_pass` — the gate REFUSES.
- [ ] Live re-validation: re-drive run `20260613-b115bb`-shaped teeth; a work agent's self-reflected packet REFUSES.
- [ ] Failing test added to the fixture harness proves the fix; INVENTORY count updated.
- [ ] No regressions: all existing `run-demo.sh` assertions pass; green path mints.
- [ ] Root cause addressed (author/judge isolation + signed council + honest grounding), not symptoms.

### Triage Reference
See: grimoires/loa/a2a/bug-20260612-b2936d/triage.md
