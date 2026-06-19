#!/usr/bin/env bats
# =============================================================================
# render-bridge-findings.bats — verifiable-compose Epic A sprint-2 (RFC #56).
# =============================================================================
# The renderer projects the rigorous-review structured bridge-findings (the
# source of truth) into BEAUVOIR markdown wrapping a machine block in the
# <!-- bridge-findings-start/end --> markers. Two acceptance criteria:
#   VC-A3 — the rendered markers are parsed UNCHANGED by the existing consumers
#           (bridge-findings-parser.sh extracts the JSON; post-pr-triage.sh
#           triages the parsed findings).
#   [B1]  — anchor resolution: an `observed` (code-grounded) finding whose anchor
#           does not resolve fails the synthesis; a real anchor passes; a
#           `claimed` (no-file) finding skips resolution.
# Plus: deterministic output; severity UPPER-CASED for the parser's weighting.
# =============================================================================

fail() { echo "FAIL: $*" >&2; return 1; }

setup() {
    SUBSTRATE_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    RENDER="$SUBSTRATE_ROOT/scripts/render-bridge-findings.py"
    PARSER="$SUBSTRATE_ROOT/.claude/scripts/bridge-findings-parser.sh"
    TRIAGE="$SUBSTRATE_ROOT/.claude/scripts/post-pr-triage.sh"

    [[ -f "$RENDER" ]] || skip "render-bridge-findings.py not found"
    command -v jq >/dev/null || skip "jq required"
    command -v python3 >/dev/null || skip "python3 required"

    TMPROOT="$(mktemp -d)"
}

teardown() {
    [[ -n "${TMPROOT:-}" && -d "$TMPROOT" ]] && rm -rf "$TMPROOT"
    return 0
}

# A report whose first finding's anchor resolves against SUBSTRATE_ROOT
# (the renderer script's own line 1) and whose second is a `claimed` prose anchor.
_valid_report() {
    cat > "$TMPROOT/findings.json" <<'JSON'
{
  "summary": "Two findings across correctness and risk.",
  "findings": [
    {"dimension":"correctness","severity":"critical","anchor":"scripts/render-bridge-findings.py:1","issue":"Entry path needs a guard.","recommendation":"Add the guard."},
    {"dimension":"risk","severity":"low","anchor":"overall composition design","issue":"Coverage is narrow.","recommendation":"Add lenses."}
  ],
  "positive_callouts": ["Schema is well-scoped."],
  "claims_ledger": [
    {"claim":"The renderer is deterministic.","grounding":"No time/random.","tag":"observed"},
    {"claim":"Coverage could improve.","grounding":"Judgment.","tag":"claimed"}
  ]
}
JSON
    echo "$TMPROOT/findings.json"
}

@test "render: valid report → markdown with exactly one marker pair + one json fence" {
    local f; f="$(_valid_report)"
    run python3 "$RENDER" --input "$f" --tree "$SUBSTRATE_ROOT"
    [[ "$status" -eq 0 ]] || fail "render failed: $output"
    [[ "$(grep -c 'bridge-findings-start' <<<"$output")" -eq 1 ]] || fail "expected exactly one start marker"
    [[ "$(grep -c 'bridge-findings-end' <<<"$output")" -eq 1 ]] || fail "expected exactly one end marker"
    [[ "$(grep -c '```json' <<<"$output")" -eq 1 ]] || fail "expected exactly one json fence"
}

@test "render: severity is UPPER-CASED in the machine block (parser weighting compat)" {
    local f; f="$(_valid_report)"
    run python3 "$RENDER" --input "$f" --tree "$SUBSTRATE_ROOT" --output "$TMPROOT/out.md"
    [[ "$status" -eq 0 ]] || fail "render failed: $output"
    grep -q '"severity": "CRITICAL"' "$TMPROOT/out.md" || fail "severity not upper-cased"
    grep -q '"schema_version": 2' "$TMPROOT/out.md" || fail "schema_version must be integer 2"
}

@test "render: deterministic — same input renders byte-identical" {
    local f; f="$(_valid_report)"
    python3 "$RENDER" --input "$f" --tree "$SUBSTRATE_ROOT" > "$TMPROOT/a.md"
    python3 "$RENDER" --input "$f" --tree "$SUBSTRATE_ROOT" > "$TMPROOT/b.md"
    run diff "$TMPROOT/a.md" "$TMPROOT/b.md"
    [[ "$status" -eq 0 ]] || fail "render is non-deterministic:\n$output"
}

@test "VC-A3: bridge-findings-parser.sh extracts the rendered JSON unchanged" {
    [[ -f "$PARSER" ]] || skip "bridge-findings-parser.sh not found"
    local f; f="$(_valid_report)"
    python3 "$RENDER" --input "$f" --tree "$SUBSTRATE_ROOT" --output "$TMPROOT/review.md"
    run bash "$PARSER" --input "$TMPROOT/review.md" --output "$TMPROOT/parsed.json"
    [[ "$status" -eq 0 ]] || fail "parser failed on rendered markers: $output"
    run jq -e '.schema_version == 2 and (.findings | length) == 2' "$TMPROOT/parsed.json"
    [[ "$status" -eq 0 ]] || fail "parsed findings malformed: $(cat "$TMPROOT/parsed.json")"
    # The CRITICAL finding must have weight 10 (parser weighted it on UPPER severity).
    run jq -e '[.findings[] | select(.severity=="CRITICAL")][0].weight == 10' "$TMPROOT/parsed.json"
    [[ "$status" -eq 0 ]] || fail "CRITICAL finding not weighted — severity case mismatch"
}

@test "VC-A3: post-pr-triage.sh triages the parsed findings (dry-run, exit 0)" {
    [[ -f "$PARSER" ]] || skip "bridge-findings-parser.sh not found"
    [[ -f "$TRIAGE" ]] || skip "post-pr-triage.sh not found"
    local f; f="$(_valid_report)"
    python3 "$RENDER" --input "$f" --tree "$SUBSTRATE_ROOT" --output "$TMPROOT/review.md"
    bash "$PARSER" --input "$TMPROOT/review.md" --output "$TMPROOT/parsed.json"
    mkdir -p "$TMPROOT/reviewdir"
    cp "$TMPROOT/parsed.json" "$TMPROOT/reviewdir/rendered-iter1-findings.json"
    # Run from a clean cwd (no .run/bridge-state.json) → legacy *-findings.json glob.
    cd "$TMPROOT"
    run bash "$TRIAGE" --pr 1 --dry-run --review-dir "$TMPROOT/reviewdir"
    [[ "$status" -eq 0 ]] || fail "post-pr-triage failed on rendered findings: $output"
}

@test "[B1]: an observed anchor that does not resolve fails the synthesis (exit 2)" {
    cat > "$TMPROOT/dangling.json" <<'JSON'
{
  "summary": "One ungrounded finding.",
  "findings": [
    {"dimension":"correctness","severity":"high","anchor":"foo.ts:999","issue":"Phantom bug.","recommendation":"None."}
  ],
  "positive_callouts": [],
  "claims_ledger": [{"claim":"x","grounding":"y","tag":"observed"}]
}
JSON
    run python3 "$RENDER" --input "$TMPROOT/dangling.json" --tree "$SUBSTRATE_ROOT"
    [[ "$status" -eq 2 ]] || fail "expected exit 2 for dangling observed anchor, got $status: $output"
}

@test "[B1]: a real anchor passes (exit 0)" {
    cat > "$TMPROOT/real.json" <<'JSON'
{
  "summary": "One grounded finding.",
  "findings": [
    {"dimension":"correctness","severity":"high","anchor":"scripts/render-bridge-findings.py:10","issue":"Real anchor.","recommendation":"Fix it."}
  ],
  "positive_callouts": [],
  "claims_ledger": [{"claim":"x","grounding":"y","tag":"observed"}]
}
JSON
    run python3 "$RENDER" --input "$TMPROOT/real.json" --tree "$SUBSTRATE_ROOT"
    [[ "$status" -eq 0 ]] || fail "real anchor should pass: $output"
}

@test "[B1]: a claimed (no-file) finding skips resolution (exit 0 even in fail mode)" {
    cat > "$TMPROOT/claimed.json" <<'JSON'
{
  "summary": "One claimed finding.",
  "findings": [
    {"dimension":"strategy","severity":"medium","anchor":"the overall market positioning","issue":"Strategy note.","recommendation":"Consider X."}
  ],
  "positive_callouts": [],
  "claims_ledger": [{"claim":"x","grounding":"y","tag":"claimed"}]
}
JSON
    run python3 "$RENDER" --input "$TMPROOT/claimed.json" --tree "$SUBSTRATE_ROOT" --on-dangling fail
    [[ "$status" -eq 0 ]] || fail "claimed finding should skip resolution: $output"
    grep -q '"resolution": "claimed"' <<<"$output" || fail "claimed finding not marked"
}

@test "[B1]: --on-dangling downgrade reclassifies a dangling anchor (exit 0)" {
    cat > "$TMPROOT/dangling.json" <<'JSON'
{
  "summary": "One ungrounded finding, downgraded.",
  "findings": [
    {"dimension":"correctness","severity":"high","anchor":"foo.ts:999","issue":"Phantom.","recommendation":"None."}
  ],
  "positive_callouts": [],
  "claims_ledger": [{"claim":"x","grounding":"y","tag":"observed"}]
}
JSON
    run python3 "$RENDER" --input "$TMPROOT/dangling.json" --tree "$SUBSTRATE_ROOT" --on-dangling downgrade
    [[ "$status" -eq 0 ]] || fail "downgrade mode should not fail: $output"
    grep -q '"resolution": "downgraded"' <<<"$output" || fail "dangling finding not downgraded"
}

@test "render: rejects a report missing a required top-level field (exit 1)" {
    echo '{"summary":"x","findings":[]}' > "$TMPROOT/bad.json"
    run python3 "$RENDER" --input "$TMPROOT/bad.json" --tree "$SUBSTRATE_ROOT"
    [[ "$status" -eq 1 ]] || fail "expected exit 1 for missing claims_ledger, got $status"
}

@test "[AUD-S2-1]: an anchor escaping the reviewed tree does not resolve and leaks nothing" {
    mkdir -p "$TMPROOT/sub"
    # A secret OUTSIDE the reviewed tree, with distinctive content + many lines.
    printf 'TOPSECRETMARKER\n%s\n' "$(seq 1 42)" > "$TMPROOT/secret.txt"
    cat > "$TMPROOT/escape.json" <<'JSON'
{
  "summary": "Attempted traversal.",
  "findings": [
    {"dimension":"correctness","severity":"high","anchor":"../secret.txt:1","issue":"exfil attempt","recommendation":"none"}
  ],
  "positive_callouts": [],
  "claims_ledger": [{"claim":"x","grounding":"y","tag":"observed"}]
}
JSON
    # fail mode: escaping anchor is unresolved → synthesis fails (exit 2), file NOT read.
    run python3 "$RENDER" --input "$TMPROOT/escape.json" --tree "$TMPROOT/sub" --on-dangling fail
    [[ "$status" -eq 2 ]] || fail "escaping anchor must fail closed, got $status: $output"
    grep -q 'escapes the reviewed tree' <<<"$output" || fail "expected constant escape reason"
    # No exfiltration: neither the secret content nor its line count leaks into output.
    grep -q 'TOPSECRETMARKER' <<<"$output" && fail "LEAK: secret content in output" || true
    grep -qE '\(4[0-9] lines\)' <<<"$output" && fail "LEAK: secret line-count in output" || true
}

@test "[AUD-S2-1]: downgrade mode also refuses to read an escaping anchor" {
    mkdir -p "$TMPROOT/sub"
    printf 'TOPSECRETMARKER\n' > "$TMPROOT/secret.txt"
    cat > "$TMPROOT/escape.json" <<'JSON'
{
  "summary": "Attempted traversal, downgrade.",
  "findings": [
    {"dimension":"risk","severity":"low","anchor":"../secret.txt:contents","issue":"oracle attempt","recommendation":"none"}
  ],
  "positive_callouts": [],
  "claims_ledger": [{"claim":"x","grounding":"y","tag":"observed"}]
}
JSON
    run python3 "$RENDER" --input "$TMPROOT/escape.json" --tree "$TMPROOT/sub" --on-dangling downgrade
    [[ "$status" -eq 0 ]] || fail "downgrade should not fail: $output"
    grep -q '"resolution": "downgraded"' <<<"$output" || fail "escaping anchor should downgrade"
    grep -q 'TOPSECRETMARKER' <<<"$output" && fail "LEAK: secret content via file_text oracle" || true
}
