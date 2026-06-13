# Bug Triage: poteau gate forgeable — work agent self-mints a valid `poteau_gate_pass`

## Metadata
- **schema_version**: 1
- **bug_id**: 20260612-b2936d
- **classification**: security / authorization-bypass (logic_bug)
- **severity**: critical
- **eligibility_score**: 4
- **eligibility_reasoning**: Live reproduced incident on run `20260613-b115bb` (+2: cryptographically-verifying receipts on disk are the executable artifact). Exact `file:line` source locations cited and verified to exist (+1). Production-incident-equivalent: a real runtime run, not a unit fixture (+1). No disqualifiers — this is a defect in EXISTING enforcement behavior, not a new feature. ACCEPT.
- **test_type**: integration
- **risk_level**: high
- **created**: 2026-06-13

## Reproduction
### Steps
1. Arm a poteau run (dispatcher gate 0) producing a readable `run-state.json` with `task`, `mandated_reads[].h1`, and `review_routing:{council:true, min_voices:2}`.
2. A SINGLE work agent (general-purpose, sonnet — NOT the reviewer, NO real council) reads the run-state (reads are not tool-gated).
3. The agent writes `.run/poteau/<run_id>/packet.json` (allowed by the tool-gate mailbox carve-out for ANY run participant) carrying:
   - `task_ref` = `sha(jcs(run_state.task))` — copied straight from the readable run-state.
   - `conformance.in_scope: true` — a free-text assertion.
   - `rationale` opening with the verbatim H1 string `# construct-rooms-substrate` — copied from `run_state.mandated_reads[0].h1`, NOT from opening README.md.
   - `council_receipts: [{reviewer_id:"a"}, {reviewer_id:"b"}]` — two distinct fabricated strings, no signatures.
4. The agent stops; `exit-gate.sh` shells the packet + run-state to `poteau-gatekeeper.mjs`, which passes G1–G4 and mints a signed receipt at G5.

### Expected Behavior
A self-reflected packet authored by a governed work agent — with no genuine review, no real council, README never opened — must **REFUSE** at the exit gate. The gate must prove SUBSTANCE (work genuinely grounded / reviewed / councilled), not merely FORM (a conforming packet reached the mailbox).

### Actual Behavior
The gatekeeper MINTS a cryptographically valid `poteau_gate_pass`. Verified live: `.run/poteau/20260613-b115bb/receipts.jsonl` holds two sealed receipts (gate_index 0 and 1) whose Ed25519 signatures VERIFY against `.run/poteau/gate.key.pub` (confirmed by independent re-verification), each with `checks:{task_conformance:true, grounding:1, council:true}` and `task_ref` matching the armed task. No genuine review occurred; one agent cannot run two voices.

### Environment
Live runtime — poteau v0.1.0, run `20260613-b115bb`. Reproduced during operator validation of the poteau enforcement lattice (laplas-poteau cycle). The static `/audit-sprint` APPROVED and missed this entirely — it only surfaces when a real agent reflects the run-state at runtime.

## Analysis

### Suspected Files
| File | Line(s) | Confidence | Reason |
|------|---------|------------|--------|
| `poteau/bin/poteau-gatekeeper.mjs` | 78-83 (G4 council) | high | Counts distinct `reviewer_id` STRINGS in `packet.council_receipts`; no signature verification. Trivially fabricable. Primary forgery surface. |
| `poteau/bin/poteau-gatekeeper.mjs` | 67-76 (G3 grounding) | high | `rationale.includes(h1)` — but `h1` lives in `run_state.mandated_reads[].h1`, readable & copyable without opening the doc. Proves nothing the run-state doesn't already contain. |
| `poteau/bin/poteau-gatekeeper.mjs` | 58-65 (G2 task_ref) | medium | `task_ref = sha(jcs(rs.task))` — copyable from the readable run-state. Expected to be copyable (it binds task identity, not effort), but contributes to the all-from-run-state forgeability. |
| `poteau/hooks/tool-gate.sh` | 33-37 (mailbox carve-out) | high | `packet.json` writable by ANY run participant. No provenance binding the packet to the gate stage's actual output → no adversarial isolation between the packet author and the gate it satisfies. |

### Related Tests
| Test File | Coverage |
|-----------|----------|
| `poteau/test/run-demo.sh` | Fixture-driven proof harness — currently 24+ `ck` assertions walking the P101→P201→P203→mint ladder, mailbox carve-out (rows 16-18b), break-glass. Asserts FORM correctness only; no adversarial "self-reflected packet must refuse" case. |
| `poteau/test/INVENTORY.md` | Assertion-count discipline (the demo RESULT line must equal the row count; CI refuses on drift). New assertions MUST be added here in the same commit. |

### Test Target
An integration test, added to `run-demo.sh` (the existing fixture harness) with matching INVENTORY.md rows, that:
1. Arms a run whose run-state mandates a council (`min_voices:2`) and a grounded read.
2. Constructs a packet built ENTIRELY by reflecting the readable run-state (copied `task_ref`, copied `h1` echo, fabricated `reviewer_id` strings with no signatures).
3. Asserts the gatekeeper REFUSES (exit 2, teaching refusal naming the council/grounding/provenance failure) — must NOT mint.
4. Regression-guards the green path: a packet carrying genuinely Ed25519-SIGNED council receipts from distinct provisioned reviewer keys + a grounding proof absent from the run-state STILL passes.

### Constraints
- `poteau/` is constitutional-layer; the tool-gate denies in-run edits to it. The FIX itself must be authored as a reviewed commit (this is the legitimate path — `tool-gate.sh:39-47`), not from inside a run.
- The fix must preserve the existing failure posture: custody gates FAIL CLOSED (exit 5 → P500), policy refusals exit 2.
- Must not break the existing 24+ green assertions (mailbox carve-out for the packet itself stays open; what changes is WHO may author it and WHAT the council/grounding checks require).
- **Honest-limit caveat on G3**: any grounding proof an agent can produce by reading the doc, it can ALSO produce by reading the run-state spec if that proof is embedded there. Strengthening G3 mechanically (e.g. quoting a passage absent from run-state) raises the bar but does not close it absolutely. G3 may need to be REFRAMED honestly (grounding is a weak/heuristic signal) rather than presented as a hard proof. The fix should not over-claim.

## Fix Strategy

Three vectors, in priority order. Vectors (1) and (2) are the load-bearing fixes — they convert FORM into SUBSTANCE. Vector (3) is an honest hardening with an acknowledged limit.

**(1) G4 council — verify SIGNED council receipts (highest leverage).**
A council receipt must be a real Ed25519 signature from a DISTINCT, provisioned reviewer key, verified against a known set of reviewer public keys — not merely `>= min_voices` distinct `reviewer_id` strings. Fabricating a string is trivial; forging a signature against a key you don't hold is not. This is the same legba/G5 signature discipline the gate already uses to mint its OWN receipt, turned inward on the council inputs. Provisioning: reviewer public keys published per room (mirrors the gate-key ceremony in the gatekeeper header comment).

**(2) Mailbox authorship — bind the packet to the gate stage, not arbitrary subagents.**
Scope the `tool-gate.sh` carve-out so `packet.json` is writable only by the wire/executor (the main loop translating the GATE STAGE's structured verdict — e.g. `compose-handoff-wrap`), not by arbitrary run-participant subagents. The packet must carry provenance binding it to the gate stage's actual output (e.g. a marker/signature only the executor can produce), so a work agent cannot self-author the door it then walks through. This restores adversarial isolation between the packet's AUTHOR and the gate that JUDGES it.

**(3) G3 grounding — proof not already in the run-state, reframed honestly.**
The H1 echo is run-state-copyable, so it proves nothing. Strengthen to a grounding proof the run-state does NOT already contain (quote a passage/line absent from `run-state`, or a content hash of a doc section computed from the actual file). Accept and DOCUMENT the fundamental limit (see Constraints): grounding remains a heuristic, not a hard proof. Reframe the gate's claim accordingly rather than over-asserting "proof of grounding."

**Thesis correction this fix lands**: the cycle currently claims "enforcement is law, the closed surfaces are actually closed." Until (1)+(2) ship, poteau proves a conforming packet REACHED THE MAILBOX (form), not that the work was genuinely grounded/reviewed/councilled (substance). This is BLOCKER-class against the merge claim.

### Fix Hints
Structured hints for multi-model handoff (each hint targets one file change):

| File | Action | Target | Constraint |
|------|--------|--------|------------|
| `poteau/bin/poteau-gatekeeper.mjs` | validate | G4 `council_receipts` → verify Ed25519 signatures from distinct provisioned reviewer pubkeys | replace string-count with signature verification against a known reviewer keyset; refuse (P204) on too-few VALID signatures |
| `poteau/hooks/tool-gate.sh` | refactor | packet.json mailbox carve-out (lines 33-37) → restrict author to wire/executor | only the gate-stage executor may write packet.json; bind packet provenance to the gate stage's output |
| `poteau/bin/poteau-gatekeeper.mjs` | validate | G3 grounding (lines 67-76) → require proof absent from run-state | replace bare `rationale.includes(h1)` with a content-derived proof (section hash / non-run-state passage); reframe the claim, do not over-assert |
| `poteau/test/run-demo.sh` + `INVENTORY.md` | add | adversarial "self-reflected packet must REFUSE" assertion(s) | new ck label(s) added to INVENTORY.md in the same commit (count-drift CI); green path with signed receipts still mints |

## Re-validation (live teeth)
The static audit cannot catch this; re-validate by re-driving the LIVE teeth after the fix: arm a run, have a work agent emit a packet built entirely by reflecting the run-state (copied task_ref + copied H1 + fabricated unsigned council strings), and confirm the exit gate REFUSES (does not mint). Then confirm the genuine green path (signed distinct-reviewer council receipts + grounding proof) STILL mints.
