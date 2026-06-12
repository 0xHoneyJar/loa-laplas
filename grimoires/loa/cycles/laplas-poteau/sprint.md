# Sprint Plan — Laplas + Poteau Integration

> **Cycle**: laplas-poteau · **PRD + SDD**: `grimoires/loa/{prd,sdd}.md` (both FLATLINE-REVIEWED)
> **Status**: DRAFT — pending Flatline sprint review (Phase 6)
> **Branch**: `cycle/laplas-poteau` (stacked on cycle/observatory-graduation) · Beads: created at /run time
> **MVP** = S1–S4 · wave 2 = S5 · wave 3 = S6 · out of scope per PRD §6.
> **Standing rule (G-5)**: any sprint that flips an enforcement surface prose→hook ships the
> `hardness-manifest.json` entry + its named PT benchmark IN THE SAME sprint, or the flip reverts.

## Sprint 1: CONTRACT + LANDING

**Goal**: law is proven possible on this runtime, then the lattice lands intact.

| # | Task | Acceptance |
|---|---|---|
| 1.1 | **FR-B0 smoke test** (`scripts/poteau-smoke.sh`) — five legs (Stop-block · exit-2 deny+stderr · loop-guard · injection · combined-state T2), BOTH interactive and headless modes | `contract-receipt.json` records 5/5 per mode; **any leg false = CYCLE HALTS** (the freeze gate — no FR-B design work may merge before this is green) |
| 1.2 | Vendor `poteau/` + `laplas/` pristine (commit 1), repo-convention deltas (commit 2): R-5 portable-compare fix, `POTEAU_ROOT` paths, B8/T3 session-keyed run-dirs, T1 packet-mailbox carve-out in tool-gate | Demo 21/21 on ubuntu AND macos in CI; `pt-fixture-portable-compare` named; tool-gate test: packet.json write ALLOWED, run-state.json write DENIED (P402) |
| 1.3 | `poteau-gen` adaptation + `docs/poteau-runbook.md` (SDD §4.2 content: merge/verify/rollback commands) | `poteau-gen` emits fragment + checksums; P401 drift-refusal demo'd; **operator executes the runbook once** (the agent never merges hook config) and `poteau-gen --check` passes post-merge AND post-remount |
| 1.4 | CI workflow: demo + smoke + fixtures as PR gates on `poteau/**`, `laplas/**` paths | Workflow green on the PR; a planted leg-failure fixture turns it red (the gate is proven by going red) |

## Sprint 2: THE DOOR

**Goal**: no ceremony starts unready; the format becomes draft law.

| # | Task | Acceptance |
|---|---|---|
| 2.1 | `laplas/schemas/{quest,party,dungeon,module}.schema.json` (draft-07, versioned `module/1`) — H1 extraction skips YAML frontmatter (IMP-007); task-literal bounds in quest schema (T5: ≤4000 chars) | Schemas validate all existing fixtures; frontmatter'd doc fixture extracts the RIGHT H1; 4001-char task fixture refused with named P-code |
| 2.2 | Worked example: decompose `compositions/code-implement-and-review.yaml` → `modules/code-implement-and-review/{module,quest,party,dungeon}.json` (council + gates + HITL seat all exercised) | `laplas-ready` passes it; receipt binds 3 hashes; the composition still runs UNCHANGED (module is preparation, not execution — no breaking change) |
| 2.3 | Ready check at dispatch gate 0 (SDD §4.1): `--module` flag + refusal pass-through; module-less = warn + proceed (wave-1 legality) | P601–P606 negative fixtures each refuse with the fix named; module-less dispatch warns `unprepared ceremony`; armed dispatch writes `.run/poteau/<run_id>/ready.json` |
| 2.4 | Hounfour migration PROPOSAL (schemas attached, ratification out of scope) | Proposal doc opened in loa-hounfour with the trinity framing (spec/kit/content); link recorded in NOTES.md |

## Sprint 3: THE QUEST REACHES THE GATE

**Goal**: #29 and #31 die by mechanism; the exit is the gate.

| # | Task | Acceptance |
|---|---|---|
| 3.1 | Dispatcher per-stage seeds (SDD §4.4): task/task_ref/mandated_reads/review_routing into `stages/<k>.json`; IMP-004 legacy defaults (no task = refuse to arm; no routing = non-council, logged) | Cut of the worked example produces correct seeds; legacy composition without task literals refuses with teaching P-code |
| 3.2 | Emitter TASK/SCOPE into gate_head (`segment-emitter.py:1095`), fenced block (T5); emit-time P301 when council mandate unstaffable (#30 compile half) | Emitted gate segment contains the verbatim task in a fenced block; council-mandate-without-runner emit fails P301 unless `--allow-single-model` (recorded, `council_waived` stamped) |
| 3.3 | Gatekeeper port: G1 shells handoff-validate (10s timeout, T7) · by-session pointers (T3) · receipt run_id+freshness binding (IMP-011) · prompt-arm requires ready receipt | Pointer race test (two sessions, no clobber); stale-pointer no-op test; timeout → P500 naming the hang; existing 3-tier packet fixtures pass unchanged (R-1) |
| 3.4 | Verify-gate `--poteau` adoption-aligned (T4): armed = chain-walk + gate_index ≥ seams; unarmed = legacy verify + `governance: unarmed` stamp | **#29 benchmark**: wrong-repo fixture run refused at first exit with P201. **#31 benchmark**: 4 mandated reads, one missing H1 echo → P203 names the path; 4/4 echoes pass. **#7 benchmark**: unarmed run verifies legacy with the stamp, never a late trap |
| 3.5 | Hardness-manifest flips: `handoff-validate` + `loa-tool-mandate` successor entries reflect reality post-port | Each flip ships its PT benchmark in this sprint (G-5 standing rule); Observatory fold renders the new SOLID doors |

## Sprint 4: THE COUNCIL

**Goal**: #30 dies twice — at compile and at run time.

| # | Task | Acceptance |
|---|---|---|
| 4.1 | `scripts/council-run.sh` (SDD §4.7): headless trio pattern, 300s/provider timeout, receipts bind task_ref+packet_hash+nonce (B6) | Receipts schema-valid; same prompt to N providers; dead provider → HARD-FAIL naming it + the staffing fix (T6) — never silent degradation |
| 4.2 | Gatekeeper G4 live: council surfaces refuse <min_voices distinct reviewer_ids (P204) | **#30 benchmark**: council-mandated module emit w/o runner → P301; single-voice packet at run time → P204; recorded override → `council_waived` in receipt + incident |
| 4.3 | Executor wiring: gate-stage segments invoke council-run (hooks never conduct — the sandwich) | Worked-example run end-to-end: council receipts in packet, G4 passes, chain verifies, `valid_run` with `governance: armed` |
| 4.4 | Incidents schema (IMP-014) + cycle decisions.md ledger live | One shape `{ts, run_id, event, reason, actor}`; every override/break-glass/checkpoint lands in it; decisions.md cites the first armed run's receipts |

## Sprint 5: CUSTODY + LIVENESS (wave 2)

**Goal**: receipts become challengeable; the watchdog gets its hook.

| # | Task | Acceptance |
|---|---|---|
| 5.1 | Key ceremony (SDD §4.8): per-run provisioned keys outside workspace, pubkeys in run manifest, keys DELETED at run close (IMP-016) | Receipts verify via manifest pubkeys after key destruction; forged-receipt fixture (unmanifested key) detected by chain verify |
| 5.2 | CAS wiring: move-record hashes via legba CAS; receipts replay-challengeable | `legba challenge`-shaped re-execution over a poteau receipt succeeds/fails honestly on a tampered fixture |
| 5.3 | Watchdog (SDD §4.9): orchestrator-side poll over moves.jsonl; manifest thresholds (IMP-012: tool_calls 50 · wall_s 600 · stall_s 120); verdict → checkpoint packet through the exit gate (PT-8) | Fixture run breaching tool_calls fires the budget verdict; checkpoint packet judged, never dropped; `compose-calls-ceiling` flips prose→hook WITH this benchmark (G-5) |

## Sprint 6: TELEMETRY + THE HONEST README (wave 3)

**Goal**: G-5 closes — the posture map is true and watched.

| # | Task | Acceptance |
|---|---|---|
| 6.1 | `scripts/poteau-stats.sh` → GECKO-consumable JSONL (gate-pass rate, P-code histogram, incidents per construct) | Stats over the cycle's real runs; a climbing-refusal fixture surfaces in the report (IMP-009 mechanical criteria) |
| 6.2 | README posture map replaces "observability-primary / does not block": every surface listed with block/log + why + manifest entry | Every claim cross-checks against hardness-manifest.json (no orphan claims either direction); the Observatory renders the map |
| 6.3 | Wave-3 flip decision: dispatch refuses module-less ceremonies (T4 end-state) — OPERATOR decision with refusal-rate telemetry in hand | decisions.md entry citing 6.1 telemetry; if flipped, the unprepared-ceremony warn path is removed and its test inverts |

## Cross-cutting

- **The freeze gate**: S1.1 failing ANY leg halts the cycle for re-design — no exceptions, no partial credit (PRD FR-B0).
- **Benchmarks close issues**: #29 → S3.4 · #31 → S3.4 · #30 → S4.2 · #7 → S3.4 stamp + S6.3 flip; each closing commit cites the issue and the benchmark fixture.
- **Operator seats (HITL, never ambient)**: S1.3 runbook execution · S6.3 flip decision · break-glass forever.
- **Determinism env pinned**: Node ≥22, `LANG=C TZ=UTC` for all fixtures and receipts (house law since observatory).
- **Dual-state**: PR #43 (observatory) merges independently; this cycle's PR stacks until then — if #43 is unmerged after two sprints, operator decides rebase-vs-wait at a named checkpoint.
