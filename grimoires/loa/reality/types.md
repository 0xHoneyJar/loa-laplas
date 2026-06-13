# Types — the 5 typed artifacts

## construct-handoff packet (data/trajectory-schemas/construct-handoff.schema.json)
The inter-room envelope. REQUIRED: `construct_slug, output_type, verdict, invocation_mode, cycle_id`.
Observability fields: `evidence` (file:line refs), `pushback_invitation`
(primary_uncertainty + operator_check), `kaironic_context`, `gates_passed/gates_failed`,
`output_refs` (content travels as refs, never transcript), `translation_note`,
`source_provenance`, `transcript_path/excerpt`, `composition_run_id`, `stage_index`.
Gate: handoff-validate.sh (required fail-closed · recommended warn · optional).

## room-activation packet (data/trajectory-schemas/room-activation-packet.schema.json)
Room authority. REQUIRED: `room_id, cycle_id, construct_slug, mode, invocation_path,
expected_output_type, created_at, created_by`. Also: `allowed_skills, forbidden_context,
inputs, persona, expected_handoff_path`. Without packet → construct self-labels
studio_synthesis. Gate: room-packet-validate.sh.

## pair-relay composition descriptor (data/trajectory-schemas/pair-relay-composition.schema.json)
REQUIRED: `schema_version, pattern, artifact_name, sequence, surface_mode`.
Optional: `convergence_criteria, domain, max_cycles`. Gate: pair-relay-validate.sh.

## construct manifest v4 (data/schemas/construct-manifest-v4.schema.json)
REQUIRED: `schema_version, slug, name, version, description`. 27 props; the substrate
reads ONLY `tools.{allowlist,denylist,required}` + `adapter.{...}` (README.md:126).

## clew ledger line (scripts/clew/learnings-construct.schema.json)
Per-construct LEARNINGS.jsonl. REQUIRED: `id, tier, type, trigger, target, verified,
distilled_at`. Also: `genome_hash, genome_seq, run_id, solution, distill_status, proposed_pr`.

## Runtime shapes (non-schema'd)
- Segment return: `{outcome: converged|cap_reached|degraded, ..., seam}` (segment-emitter.py:16-22)
- Failure sentinels: `{__stage_failed: true, ...}` (throw) vs `null` (operator-skip) — distinct
- Legba (PROVISIONAL, tracks loa-hounfour#118): SpanMove / GateToken / RunReceipt (legba-core.mjs)
