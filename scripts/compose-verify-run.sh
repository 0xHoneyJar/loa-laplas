#!/usr/bin/env bash
# =============================================================================
# compose-verify-run.sh — proof-of-run gate (the FIRST tooth).
# =============================================================================
# A composition is SUPPOSED to run through the Form C runtime:
# `compose-dispatch.sh --form-c` compiles it into
# `.run/compose/<run_id>/{form-c-manifest.json, workflows/*.workflow.js,
# orchestrator.jsonl}`, and when the main loop executes each segment via the
# Workflow tool + `compose-handoff-wrap.sh`, validated handoff ENVELOPES are
# written to `.run/compose/<run_id>/envelopes/`.
#
# The failure mode this guards: an agent can SKIP all of that and ROLE-PLAY the
# composition inline — emitting composition-looking prose with NO runtime
# provenance. This script distinguishes a real governed run from an inline fake:
# inline-approximation leaves no manifest / no segment / no orchestrator trail,
# so it FAILS the gate. A real run leaves a self-consistent provenance trail, so
# it PASSES.
#
# READ-ONLY + ADDITIVE: this script reads the run dir and never mutates any
# existing artifact or changes any existing dispatch/emit behavior.
#
# What it verifies (all locally checkable in construct-rooms-substrate):
#   1. MANIFEST — `.run/compose/<run_id>/form-c-manifest.json` exists, parses,
#      and its `run_id` matches the argument (a forged/copied manifest with a
#      mismatched run_id is rejected).
#   2. SEGMENTS — every segment workflow file the manifest references resolves
#      on disk (checked as `workflows/<basename>` RELATIVE to the run dir, so a
#      moved/copied run dir is still verifiable despite the absolute path baked
#      into the manifest at emit time).
#   3. ORCHESTRATOR — `orchestrator.jsonl` exists, parses line-by-line, and
#      records THIS run (every line's `run_id` matches; the `form_c.manifest`
#      event is present — i.e. the compiler actually reached the manifest step).
#   4. ENVELOPES (only if any segment executed) — every envelope in
#      `envelopes/` is valid JSON, passes the existing `handoff-validate.sh`
#      gate, carries `composition_run_id == <run_id>`, has a `stage_index` that
#      belongs to a manifest segment, and is content-addressable: its id is
#      recomputed via the EXISTING hash core (`construct-handoff-lib.sh
#      compute-id`), never reinvented here. The per-envelope ids are folded (in
#      stage order) into an `envelope_digest` a downstream consumer can pin.
#
# Check 5 (--legba, OPTIONAL): THE HASH CHAIN, now present. The Form C handoff
# format still carries no inter-envelope `prev_hash` field of its own, but
# `scripts/legba/compose-bridge.mjs` DERIVES a real custody chain over the
# executed envelopes — one envelope → one Legba span → one ed25519-signed gate
# token; the tokens chain (`prev_token_hash`) and the turnstile enforces order.
# With `--legba`, a run is `valid_run` only if that chain ALSO verifies from the
# gatekeeper's public key (`legba verify <run>/legba`). This closes the seam this
# comment used to reserve: the set-membership check proved presence; the Legba
# chain proves authorship + integrity-over-time (the playtest's exact gap). The
# flag is opt-in (warn-first) until recording is wired into dispatch by default;
# the exit code is the lever either way.
#
# Historical note (pre-Legba): this verifier checked only the integrity that was
# locally provable (content-addressable per-envelope id + set linkage) and did
# NOT fabricate a `prev_hash` chain against a format that lacked one. The chain
# now exists as a DERIVED layer (Legba), not a fabricated envelope field — the
# refusal discipline is preserved (old runs without a legba/ dir are old-rules
# runs; --legba simply has nothing to verify and says so).
#
# Usage:
#   compose-verify-run.sh <run_id> [--json] [--base-dir DIR] [--require-executed]
#
# --require-executed (the TERMINAL gate mode): a COMPILED-only run — a real
#   manifest + segment(s) + orchestrator trail but ZERO executed handoff envelopes
#   — is NOT a completed composition (the segments were never run). Without this
#   flag a compile-only run is `valid_run` exit 0 (back-compat: the compile is
#   provably real). WITH it, a compile-only run is `compiled_run` exit 2, so the
#   executor cannot dispatch-the-compile, skip execution, and claim completion.
#   Closes the subtler defection: "mint provenance, skip the work, gate it."
#   (Evidence bar is >=1 executed handoff envelope — enough to prove the segments
#   ran; per-manifest-segment completeness is a future refinement, see bd-mlw.)
#
# Exit codes:
#   0  valid governed run — proof-of-run holds
#   2  NOT a real run — no manifest / no emit dir (inline-fake or fabricated id) →
#      verdict not_a_run
#   3  broken / forged run — manifest, segments, orchestrator, or an envelope is
#      missing, unparseable, or internally inconsistent
#   4  (--require-executed) real compile but ZERO segments executed → verdict
#      compiled_run (DISTINCT from not_a_run's 2: different remediation — re-run the
#      segments, don't re-dispatch)
#   1  usage error
#
# --json verdict (machine-gateable):
#   {"verdict":"valid_run"|"not_a_run"|"compiled_run"|"broken_run", "run_id":...,
#    "reason":..., "checks":{manifest,segments_present,orchestrator,envelopes},
#    "segment_count":N, "envelope_count":N, "envelope_digest":"sha256:..."|null}
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSTRATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# PROJECT_ROOT resolution mirrors compose-dispatch.sh exactly: LOA_PROJECT_ROOT
# override, else one dir above the substrate (the installed <project>/ layout).
if [[ -n "${LOA_PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$LOA_PROJECT_ROOT"
else
    PROJECT_ROOT="$(cd "$SUBSTRATE_ROOT/.." && pwd)"
fi

# Reusable cores (host install first, substrate fallback) — never reinvented.
HANDOFF_VALIDATOR="$PROJECT_ROOT/.claude/scripts/handoff-validate.sh"
[[ -x "$HANDOFF_VALIDATOR" ]] || HANDOFF_VALIDATOR="$SUBSTRATE_ROOT/scripts/handoff-validate.sh"
HANDOFF_LIB="$PROJECT_ROOT/.claude/scripts/lib/construct-handoff-lib.sh"
[[ -f "$HANDOFF_LIB" ]] || HANDOFF_LIB="$SUBSTRATE_ROOT/scripts/lib/construct-handoff-lib.sh"
# Handoff schema (mirrors compose-handoff-wrap.sh resolution: host first, then
# substrate-canonical). The substrate-standalone validator can't self-resolve the
# schema from its own SCRIPT_DIR, so we pass it explicitly via --schema.
HANDOFF_SCHEMA=""
if [[ -f "$PROJECT_ROOT/.claude/data/trajectory-schemas/construct-handoff.schema.json" ]]; then
    HANDOFF_SCHEMA="$PROJECT_ROOT/.claude/data/trajectory-schemas/construct-handoff.schema.json"
elif [[ -f "$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json" ]]; then
    HANDOFF_SCHEMA="$SUBSTRATE_ROOT/data/trajectory-schemas/construct-handoff.schema.json"
fi
if [[ -z "${LOA_COMPOSE_BASE_DIR:-}" ]]; then
    BASE_DIR="$PROJECT_ROOT/.run/compose"
else
    BASE_DIR="$LOA_COMPOSE_BASE_DIR"
fi

# -----------------------------------------------------------------------------
# Portable sha256 (CVR-002). The previous fallback hardcoded `shasum -a 256`,
# which is macOS-only — on Linux/CI without shasum it would fail SILENTLY and the
# verifier could pass without a real digest. Resolve a hasher ONCE: prefer the
# GNU `sha256sum`, fall back to BSD/macOS `shasum -a 256`. If NEITHER exists we
# do NOT silently continue — `_sha256` returns non-zero so every call site can
# fail LOUDLY (broken_run / explicit error). Conservative-by-default.
# -----------------------------------------------------------------------------
SHA256_CMD=""
if command -v sha256sum >/dev/null 2>&1; then
    SHA256_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    SHA256_CMD="shasum -a 256"
fi
# Read stdin → echo the bare 64-hex digest. Returns 3 (no hasher) loudly if
# neither tool is present, so callers can route it to a broken_run verdict.
_sha256() {
    if [[ -z "$SHA256_CMD" ]]; then
        echo "ERROR: no sha256 hasher found (need 'sha256sum' or 'shasum') — cannot prove run integrity" >&2
        return 3
    fi
    $SHA256_CMD | awk '{print $1}'
}

usage() {
    cat <<EOF
Usage: compose-verify-run.sh <run_id> [options]

Verify that <run_id> is a real governed Form C composition run (proof-of-run),
not an inline-approximated fake. READ-ONLY.

Options:
  --json              Emit a structured verdict on stdout (gateable).
  --base-dir DIR      Override the compose run base dir (default: <root>/.run/compose).
  --require-executed  TERMINAL gate: a compile-only run (zero executed envelopes)
                      is compiled_run (exit 2), not valid_run. Demands execution
                      evidence so "compiled" cannot masquerade as "completed".
  -h, --help          Show this help.

Exit codes:
  0  valid_run     — proof-of-run holds (executed; or compiled, sans --require-executed)
  2  not_a_run     — no manifest / no emit dir (inline-fake or fabricated id)
  3  broken_run    — present but missing/forged/inconsistent provenance
  4  compiled_run  — (--require-executed) real compile but segments never executed
  1  usage error
EOF
}

RUN_ID=""
OUTPUT_JSON=0
REQUIRE_EXECUTED=0
LEGBA=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) OUTPUT_JSON=1; shift ;;
        --base-dir) BASE_DIR="$2"; shift 2 ;;
        --require-executed) REQUIRE_EXECUTED=1; shift ;;
        --legba) LEGBA=1; shift ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "ERROR: unknown flag '$1'" >&2; usage >&2; exit 1 ;;
        *) if [[ -z "$RUN_ID" ]]; then RUN_ID="$1"; else echo "ERROR: extra arg '$1'" >&2; exit 1; fi; shift ;;
    esac
done

if [[ -z "$RUN_ID" ]]; then
    echo "ERROR: run_id required" >&2
    usage >&2
    exit 1
fi

RUN_DIR="$BASE_DIR/$RUN_ID"
MANIFEST="$RUN_DIR/form-c-manifest.json"
ORCHESTRATOR="$RUN_DIR/orchestrator.jsonl"
ENVELOPES_DIR="$RUN_DIR/envelopes"

# Track which checks have passed for the structured verdict.
CHK_MANIFEST=false
CHK_SEGMENTS=false
CHK_ORCH=false
CHK_ENVELOPES=false
SEGMENT_COUNT=0
ENVELOPE_COUNT=0
ENVELOPE_DIGEST=""
LEGBA_VERIFIED=null   # null = not checked; true/false when --legba ran
LEGBA_RECEIPT=""

# Emit the verdict + exit. $1=verdict $2=exit_code $3=reason
_verdict() {
    local verdict="$1" code="$2" reason="$3"
    if [[ "$OUTPUT_JSON" == "1" ]]; then
        jq -n \
            --arg verdict "$verdict" \
            --arg run_id "$RUN_ID" \
            --arg reason "$reason" \
            --argjson manifest "$CHK_MANIFEST" \
            --argjson segments "$CHK_SEGMENTS" \
            --argjson orch "$CHK_ORCH" \
            --argjson envelopes "$CHK_ENVELOPES" \
            --argjson seg_count "$SEGMENT_COUNT" \
            --argjson env_count "$ENVELOPE_COUNT" \
            --arg env_digest "$ENVELOPE_DIGEST" \
            --argjson legba_verified "$LEGBA_VERIFIED" \
            --arg legba_receipt "$LEGBA_RECEIPT" \
            '{
                verdict: $verdict,
                run_id: $run_id,
                reason: $reason,
                checks: {
                    manifest: $manifest,
                    segments_present: $segments,
                    orchestrator: $orch,
                    envelopes: $envelopes,
                    legba_chain: $legba_verified
                },
                segment_count: $seg_count,
                envelope_count: $env_count,
                envelope_digest: (if $env_digest == "" then null else $env_digest end),
                legba_receipt_hash: (if $legba_receipt == "" then null else $legba_receipt end)
            }'
    else
        if [[ "$code" -eq 0 ]]; then
            echo "[compose-verify-run] $RUN_ID — VALID governed run ($reason)"
        else
            echo "[compose-verify-run] $RUN_ID — $verdict: $reason" >&2
        fi
    fi
    exit "$code"
}

# -----------------------------------------------------------------------------
# Check 0: RUN_ID is well-formed (CVR-001 — path-traversal defense).
# RUN_ID is concatenated into BASE_DIR/<run_id> and used to read manifest /
# orchestrator / envelopes. An unvalidated run_id with `..` or `/` escapes the
# run base and lets a caller steer the verifier at ARBITRARY directories on disk
# (and, with a forged manifest run_id field, even coerce a valid_run verdict).
# compose-dispatch.sh generates run_id as `$(date -u +%Y%m%d)-$(openssl rand
# -hex 3)` → a YYYYMMDD-hex shape; operators MAY pass `--run-id` with their own
# label. We allow a conservative single-path-component charset and reject `..`
# explicitly. NO filesystem access has happened yet — we refuse before touching
# anything. Default-deny: an unrecognizable run_id is not_a_run.
# -----------------------------------------------------------------------------
if [[ ! "$RUN_ID" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || [[ "$RUN_ID" == *".."* ]]; then
    _verdict "not_a_run" 2 "invalid run_id '$RUN_ID' (must be a single path component matching ^[0-9A-Za-z][0-9A-Za-z._-]*\$ with no '..' — rejected before any path access; possible path traversal)"
fi

# -----------------------------------------------------------------------------
# Check 1: MANIFEST exists, parses, run_id matches.
# Absent manifest / absent emit dir == NOT a run (inline-fake leaves nothing).
# -----------------------------------------------------------------------------
if [[ ! -d "$RUN_DIR" ]]; then
    _verdict "not_a_run" 2 "no emit dir for run_id '$RUN_ID' (no manifest — inline-approximated or fabricated run_id)"
fi
if [[ ! -f "$MANIFEST" ]]; then
    _verdict "not_a_run" 2 "no manifest for run_id '$RUN_ID' (form-c-manifest.json absent — no runtime provenance)"
fi
if ! jq -e 'type == "object"' "$MANIFEST" >/dev/null 2>&1; then
    _verdict "broken_run" 3 "manifest does not parse as a JSON object (corrupt: cannot prove run)"
fi
MANIFEST_RUN_ID="$(jq -r '.run_id // ""' "$MANIFEST")"
if [[ "$MANIFEST_RUN_ID" != "$RUN_ID" ]]; then
    _verdict "broken_run" 3 "manifest run_id '$MANIFEST_RUN_ID' != requested run_id '$RUN_ID' (forged/copied manifest)"
fi
CHK_MANIFEST=true

# -----------------------------------------------------------------------------
# Check 2: every manifest segment's workflow file resolves on disk.
# The manifest bakes an ABSOLUTE workflow_file at emit time; we resolve it
# relative to THIS run dir (workflows/<basename>) so a moved run dir still
# verifies. A composition with zero segments is impossible for a valid emit.
# -----------------------------------------------------------------------------
SEGMENT_COUNT="$(jq '.segments | length' "$MANIFEST" 2>/dev/null || echo 0)"
if [[ "$SEGMENT_COUNT" -lt 1 ]]; then
    _verdict "broken_run" 3 "manifest declares 0 segments (a valid Form C run emits >=1 segment)"
fi
missing_seg=""
while IFS= read -r wf; do
    [[ -z "$wf" ]] && { missing_seg="<null workflow_file in manifest>"; break; }
    base="$(basename "$wf")"
    resolved="$RUN_DIR/workflows/$base"
    if [[ ! -f "$resolved" ]]; then
        missing_seg="$base"
        break
    fi
done < <(jq -r '.segments[].workflow_file // ""' "$MANIFEST")
if [[ -n "$missing_seg" ]]; then
    _verdict "broken_run" 3 "segment workflow file missing on disk: $missing_seg (run dir does not contain the emitted segment)"
fi
CHK_SEGMENTS=true

# Collect the set of valid stage_indexes from the manifest (for envelope check).
MANIFEST_STAGES="$(jq -r '[.segments[].stages[]?.stage] | unique | .[]' "$MANIFEST" 2>/dev/null || true)"

# -----------------------------------------------------------------------------
# Check 3: orchestrator.jsonl exists, parses, records THIS run.
# Every line must be valid JSON whose run_id matches; the form_c.manifest event
# must be present (proves the compiler actually reached the manifest step — a
# trail that stops earlier is an incomplete/aborted run).
# -----------------------------------------------------------------------------
if [[ ! -f "$ORCHESTRATOR" ]]; then
    _verdict "broken_run" 3 "orchestrator.jsonl absent (no run trail — cannot prove the runtime drove this run)"
fi
if [[ ! -s "$ORCHESTRATOR" ]]; then
    _verdict "broken_run" 3 "orchestrator.jsonl is empty (no recorded events)"
fi
orch_problem=""
saw_manifest_event=false
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if ! printf '%s' "$line" | jq -e 'type == "object"' >/dev/null 2>&1; then
        orch_problem="orchestrator line does not parse as JSON"
        break
    fi
    line_run="$(printf '%s' "$line" | jq -r '.run_id // ""')"
    if [[ "$line_run" != "$RUN_ID" ]]; then
        orch_problem="orchestrator event run_id '$line_run' != '$RUN_ID' (trail belongs to a different run)"
        break
    fi
    ev="$(printf '%s' "$line" | jq -r '.event // ""')"
    [[ "$ev" == "form_c.manifest" ]] && saw_manifest_event=true
done < "$ORCHESTRATOR"
if [[ -n "$orch_problem" ]]; then
    _verdict "broken_run" 3 "$orch_problem"
fi
if [[ "$saw_manifest_event" != "true" ]]; then
    _verdict "broken_run" 3 "orchestrator trail never recorded form_c.manifest (incomplete/aborted run — never reached the manifest step)"
fi
CHK_ORCH=true

# -----------------------------------------------------------------------------
# Check 4: handoff ENVELOPES (only present if segments were executed).
# For each envelope: valid JSON · passes handoff-validate.sh · composition_run_id
# == run_id · stage_index belongs to a manifest segment · content-addressable id
# recomputes via the existing hash core. Fold the ids (stage order) → digest.
# If there are NO envelopes, the run is a valid COMPILED run (segments not yet
# executed) — that is not a failure; envelopes just stay unchecked.
# -----------------------------------------------------------------------------
declare -a ENV_FILES=()
if [[ -d "$ENVELOPES_DIR" ]]; then
    while IFS= read -r f; do
        [[ -n "$f" ]] && ENV_FILES+=("$f")
    done < <(find "$ENVELOPES_DIR" -maxdepth 1 -type f -name '*.handoff.json' | LC_ALL=C sort)
fi
ENVELOPE_COUNT=${#ENV_FILES[@]}

if [[ "$ENVELOPE_COUNT" -gt 0 ]]; then
    # CVR-005 (silent-pass): if executed envelopes exist but the manifest declares
    # NO stages, there is nothing to validate stage_index against — the per-envelope
    # stage membership check below would be silently skipped and ANY stage_index
    # would pass unchecked. A manifest with segments but zero stages alongside
    # executed envelopes is internally inconsistent (the runtime cannot have
    # executed a stage the manifest never declared). Default-deny: surface it as
    # broken_run rather than silently accepting unverifiable stage indexes.
    if [[ -z "$MANIFEST_STAGES" ]]; then
        _verdict "broken_run" 3 "executed envelopes present but manifest declares no stages — stage_index is unverifiable (inconsistent run: cannot validate which stages the envelopes belong to)"
    fi
    # Build a stage-ordered list of "stage_index<TAB>id" lines for the digest.
    digest_lines=""
    for env in "${ENV_FILES[@]}"; do
        bn="$(basename "$env")"
        # JSON parse.
        if ! jq -e 'type == "object"' "$env" >/dev/null 2>&1; then
            _verdict "broken_run" 3 "handoff envelope does not parse as JSON: $bn (corrupt — cannot prove the executed handoff)"
        fi
        # Schema/required-field gate (reuse the canonical validator).
        # CVR-003 (silent-pass corridor): handoff-validate.sh's contract is
        #   0 = OK (incl. recommended-field warning ≤ threshold)
        #   1 = FAIL (required field missing or schema violation)
        #   2 = BLOCKER (recommended-field overage > threshold)
        # The previous code only treated exit 1 as failure — exit 2 (BLOCKER) and
        # any other non-zero (e.g. 127 validator-missing, 126 not-executable) would
        # SILENTLY PASS. Conservative-by-default: ONLY exit 0 is a pass; ANY other
        # exit code → broken_run, with the code carried in the reason. Default-deny
        # closes the corridor where an unrecognized failure mode looked like success.
        if [[ -x "$HANDOFF_VALIDATOR" ]]; then
            schema_arg=()
            [[ -n "$HANDOFF_SCHEMA" ]] && schema_arg=(--schema "$HANDOFF_SCHEMA")
            set +e
            "$HANDOFF_VALIDATOR" "$env" "${schema_arg[@]}" --json >/dev/null 2>&1
            vrc=$?
            set -e
            if [[ "$vrc" -ne 0 ]]; then
                case "$vrc" in
                    1) _verdict "broken_run" 3 "handoff envelope failed validation (required field/schema, validator exit 1): $bn" ;;
                    2) _verdict "broken_run" 3 "handoff envelope is a BLOCKER (recommended-field overage, validator exit 2): $bn" ;;
                    *) _verdict "broken_run" 3 "handoff envelope validation returned unrecognized exit $vrc (validator missing/errored — cannot prove validity): $bn" ;;
                esac
            fi
        fi
        # composition_run_id linkage.
        env_run="$(jq -r '.composition_run_id // ""' "$env")"
        if [[ "$env_run" != "$RUN_ID" ]]; then
            _verdict "broken_run" 3 "handoff envelope composition_run_id '$env_run' != run_id '$RUN_ID': $bn (envelope does not belong to this run)"
        fi
        # stage_index must belong to a manifest segment (when both sides declare stages).
        env_stage="$(jq -r '.stage_index // ""' "$env")"
        if [[ -n "$env_stage" && "$env_stage" != "null" && -n "$MANIFEST_STAGES" ]]; then
            if ! grep -qx "$env_stage" <<< "$MANIFEST_STAGES"; then
                _verdict "broken_run" 3 "handoff envelope stage_index '$env_stage' not in any manifest segment: $bn (envelope for an unknown stage)"
            fi
        fi
        # Content-addressable id via the EXISTING core (never reinvented).
        if [[ -f "$HANDOFF_LIB" ]]; then
            set +e
            id_err_file="$(mktemp)"
            env_id="$(bash "$HANDOFF_LIB" compute-id "$env" 2>"$id_err_file")"
            idrc=$?
            id_err="$(cat "$id_err_file")"; rm -f "$id_err_file"
            set -e
            if [[ "$idrc" -ne 0 || -z "$env_id" ]]; then
                # The lib returns exit 3 specifically when no sha256 hasher is
                # available (CVR-002) — surface that cause loudly rather than a
                # generic message. Any failure here is broken_run, never a pass.
                if [[ "$idrc" -eq 3 || "$id_err" == *"sha256"* || "$id_err" == *"hasher"* ]]; then
                    _verdict "broken_run" 3 "could not compute content-addressable id for envelope: $bn — no sha256 hasher available (need 'sha256sum' or 'shasum'); integrity uncheckable, failing loudly"
                fi
                _verdict "broken_run" 3 "could not compute content-addressable id for envelope: $bn (integrity uncheckable)"
            fi
        else
            # Fallback id (lib absent): JCS-ish canonical via `jq -cS` then a
            # PORTABLE sha256 (CVR-002). `jq -cS` sorts keys but is NOT full RFC
            # 8785 JCS (no number/whitespace canonicalization) — adequate only as a
            # last-resort fallback when the JCS-backed compute-id core is missing;
            # the lib path above is the canonical one. The hasher must fail loudly
            # if neither sha256sum nor shasum exists, never silently pass.
            set +e
            fb_hash="$(jq -cS . "$env" | _sha256)"
            fbrc=$?
            set -e
            if [[ "$fbrc" -ne 0 || -z "$fb_hash" ]]; then
                _verdict "broken_run" 3 "no sha256 hasher available to compute envelope id (need sha256sum or shasum): $bn (integrity uncheckable — failing loudly)"
            fi
            env_id="sha256:$fb_hash"
        fi
        sort_key="${env_stage:-0}"
        digest_lines+="${sort_key}	${env_id}"$'\n'
    done
    # Fold the per-envelope ids (stage-ordered) into a single set digest a
    # downstream consumer can pin. This is a content-addressable SET digest, NOT
    # an inter-envelope prev_hash chain (this repo's envelope format has none).
    # Portable sha256 (CVR-002): fail loudly if no hasher rather than emit a
    # silently-empty digest.
    set +e
    fold_hash="$(printf '%s' "$digest_lines" | LC_ALL=C sort -n | _sha256)"
    foldrc=$?
    set -e
    if [[ "$foldrc" -ne 0 || -z "$fold_hash" ]]; then
        _verdict "broken_run" 3 "no sha256 hasher available to fold the envelope digest (need sha256sum or shasum) — integrity uncheckable, failing loudly"
    fi
    ENVELOPE_DIGEST="sha256:$fold_hash"
    CHK_ENVELOPES=true
fi

# -----------------------------------------------------------------------------
# Check 5 (--legba): the derived Legba custody chain over the executed envelopes
# must verify (ed25519, from the gatekeeper public key). This is THE hash chain
# the header comment used to reserve — presence+set-membership becomes
# authorship+integrity-over-time. Opt-in; only runs when envelopes executed.
# -----------------------------------------------------------------------------
if [[ "$LEGBA" == "1" && "$ENVELOPE_COUNT" -gt 0 ]]; then
    _LEGBA_BRIDGE="$(dirname "${BASH_SOURCE[0]}")/legba/compose-bridge.mjs"
    if [[ ! -f "$_LEGBA_BRIDGE" ]] || ! command -v node >/dev/null 2>&1; then
        _verdict "broken_run" 3 "--legba requested but the bridge ($_LEGBA_BRIDGE) or node is unavailable"
    fi
    if _legba_out="$(node "$_LEGBA_BRIDGE" verify "$RUN_DIR" 2>/dev/null)"; then
        LEGBA_VERIFIED=true
        LEGBA_RECEIPT="$(printf '%s' "$_legba_out" | jq -r '.run_receipt_hash // ""' 2>/dev/null)"
    else
        LEGBA_VERIFIED=false
        _verdict "broken_run" 3 "Legba custody chain FAILED to verify over the executed envelopes (--legba): the inter-envelope chain is broken or a token signature is invalid"
    fi
fi

# -----------------------------------------------------------------------------
# All checks passed.
# -----------------------------------------------------------------------------
if [[ "$ENVELOPE_COUNT" -gt 0 ]]; then
    _legba_note=""
    [[ "$LEGBA_VERIFIED" == "true" ]] && _legba_note=" + Legba custody chain verified"
    _verdict "valid_run" 0 "manifest + $SEGMENT_COUNT segment(s) + orchestrator trail + $ENVELOPE_COUNT executed handoff envelope(s) verified$_legba_note"
elif [[ "$REQUIRE_EXECUTED" == "1" ]]; then
    # TERMINAL gate: the compile is provably real, but ZERO segments executed —
    # not a completed composition. Distinct from valid_run (default) so an
    # executor cannot dispatch-the-compile, skip the work, and gate it as done.
    # Exit 4 (NOT 2): an exit-code-only consumer must be able to tell
    # `compiled_run` (re-run the segments) from `not_a_run` (re-dispatch) without
    # parsing JSON — they have different remediations (BB-23 F-001).
    _verdict "compiled_run" 4 "manifest + $SEGMENT_COUNT segment(s) + orchestrator trail verified, but ZERO executed handoff envelopes — COMPILED, not RUN (segments never executed). --require-executed demands execution evidence."
else
    _verdict "valid_run" 0 "manifest + $SEGMENT_COUNT segment(s) + orchestrator trail verified (compiled run; segments not yet executed)"
fi
