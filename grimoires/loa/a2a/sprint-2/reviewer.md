# Sprint-2 Implementation Report — Epic A renderer + anchor resolution

> Cycle: verifiable-compose · RFC #56 · PRD `grimoires/loa/prd.md` · SDD `grimoires/loa/sdd.md`

## Executive Summary

Sprint-2 ships the **thin, deterministic renderer** that projects the structured
`bridge-findings` report (the source of truth produced by `rigorous-review.yaml`'s
BEAUVOIR synthesis stage, sprint-1) into BEAUVOIR-house-style markdown wrapping a
machine block in the `<!-- bridge-findings-start/end -->` markers that the existing
`bridge-findings-parser.sh` + `post-pr-triage.sh` consume **unchanged** (SDD §2.4 —
zero net-new consumer code). It also implements the **anchor-resolution step** (SDD
§2.6 / Flatline B1): a finding whose anchor is a code reference (`file:line` or a
file-citing text anchor) is resolved against the reviewed tree; a dangling code anchor
fails the synthesis (default) or downgrades to `claimed`; a no-file anchor is `claimed`
and skips resolution.

Net-new: 1 script (`scripts/render-bridge-findings.py`, 276 lines, stdlib-only) + 1
bats suite (`tests/integration/render-bridge-findings.bats`, 10 tests). No emitter,
parser, or triage source changed.

## AC Verification

### VC-A3
> "`rigorous-review` output renders to BEAUVOIR markdown with `bridge-findings` markers that `post-pr-triage.sh` parses unchanged. *(test)*"

**✓ Met.**
- Renderer emits exactly one marker pair + one `json` fence — `scripts/render-bridge-findings.py:290-299` (`render_markdown` marker block). Test: `tests/integration/render-bridge-findings.bats:61-69`.
- `bridge-findings-parser.sh` extracts the rendered JSON (schema_version=2, 2 findings, CRITICAL weighted 10) — test `render-bridge-findings.bats:90-103`. The integer `schema_version` (`render-bridge-findings.py:48`) is required because the parser round-trips it `jq -r` → `--argjson` (`.claude/scripts/bridge-findings-parser.sh:352,386`); a string would break it.
- `post-pr-triage.sh` triages the parsed findings clean (dry-run, exit 0) — test `render-bridge-findings.bats:105-117`. Severity is UPPER-cased (`render-bridge-findings.py:226`) so `classify_action` (`.claude/scripts/post-pr-triage.sh:255-281`) and the parser's weight map route correctly.

### [B1] Anchor resolution
> "an `observed` finding with `anchor: foo.ts:999` (no such line) fails the synthesis; a real anchor passes; a `claimed` finding skips resolution. *(test)*"

**✓ Met.**
- Dangling observed anchor → exit 2 (synthesis fails), default `--on-dangling fail` — `render-bridge-findings.py:249-259`. Test: `render-bridge-findings.bats:119-133`.
- Real anchor (`scripts/render-bridge-findings.py:10`) → exit 0 — `resolve_anchor` file_line branch `render-bridge-findings.py:74-83`. Test: `render-bridge-findings.bats:135-148`.
- Claimed (no-file) anchor → `classify_anchor` returns `claimed` and `resolve_anchor` skips (`render-bridge-findings.py:52-71,72-73`); exit 0 even in fail mode. Test: `render-bridge-findings.bats:150-164`.
- `--on-dangling downgrade` reclassifies to `claimed`, exit 0 — `render-bridge-findings.py:261-267`. Test: `render-bridge-findings.bats:166-180`.

### Renderer determinism + source-of-truth
> "Renderer is deterministic; structured findings remain the source of truth (markdown is a projection)."

**✓ Met.**
- No `time`/`random` imports; findings stable-sorted by `(severity_rank, orig_index)` (`render-bridge-findings.py:182-184`); JSON block emitted `sort_keys=True` (`render-bridge-findings.py:298`). Byte-identical re-render test: `render-bridge-findings.bats:71-78`.
- The markdown machine block is a *projection* (adds `id`/`title`, UPPER severity); `.run/rigorous-review.json` (the composition's `outputs.destination`, `compositions/experimentation/rigorous-review.yaml`) remains the lowercase source of truth.

## Tasks Completed

1. **Renderer** — `scripts/render-bridge-findings.py`. Reads structured findings JSON, validates required top-level fields, resolves anchors, emits BEAUVOIR markdown (summary, severity-ranked findings, positive_callouts, claims_ledger table) + the marker-wrapped JSON projection. CLI: `--input --output --tree --on-dangling {fail,downgrade}`.
2. **Anchor-resolution step [B1]** — `classify_anchor` (shape heuristic: `file:line` / file-citing text / claimed) + `resolve_anchor` (file existence, line count, text presence). `render-bridge-findings.py:52-90`.
3. **Marker integration test** — `tests/integration/render-bridge-findings.bats` drives the real `bridge-findings-parser.sh` and `post-pr-triage.sh` against rendered output.

## Technical Highlights

- **Severity case is the integration seam.** The sprint-1 schema enum is lowercase (`critical`…); the parser/triage classify on UPPER (`CRITICAL`…). The projection upper-cases at the boundary while the source of truth stays lowercase — the markdown is the only place the case is normalized.
- **Anchor-shape, not a tag field.** The sprint-1 finding schema is `additionalProperties:false` with no `tag`, so observed-vs-claimed is derived from the anchor's *shape* (does it cite a file?), matching SDD §2.6's "text-anchor → quoted text in the cited file" / "non-file synthesis tags findings claimed". See Known Limitations.

## Testing Summary

- `bats tests/integration/render-bridge-findings.bats` → 10/10 pass.
- `bats tests/integration/rigorous-review.bats` (sprint-1) → 5/5 pass (unregressed).
- Run: `bats tests/integration/render-bridge-findings.bats`

## Known Limitations

- **Anchor observed/claimed is inferred from anchor shape**, not an explicit per-finding tag (the schema forbids extra finding keys). A code anchor written without a file reference (bare prose) is treated as `claimed`. This is the SDD §2.6 default-fail-on-dangling behavior; the composition-configurable `downgrade` mode is exposed via `--on-dangling`. Documented in `render-bridge-findings.py` module docstring. Logged to NOTES.md Decision Log.
- `file:line:col` anchors resolve on the `file:line` head only (col ignored) — rare in synthesis output; acceptable.

## Verification Steps (for reviewer)

1. `bats tests/integration/render-bridge-findings.bats` — expect 10/10.
2. `python3 scripts/render-bridge-findings.py --input <(echo '{"summary":"s","findings":[{"dimension":"d","severity":"high","anchor":"foo.ts:999","issue":"i","recommendation":"r"}],"claims_ledger":[{"claim":"c","grounding":"g","tag":"observed"}]}') --tree .` → exit 2 (dangling).
3. Confirm no diff to `.claude/scripts/bridge-findings-parser.sh`, `.claude/scripts/post-pr-triage.sh`, `scripts/lib/segment-emitter.py`.

## Security Audit Feedback Addressed (round 2)

**[MEDIUM] AUD-S2-1 — unconfined anchor resolution file-read oracle** — FIXED.
- Added `_confined(tree, file)` (`scripts/render-bridge-findings.py:65-77`): resolves the anchor's path with `os.path.realpath` (symlinks included) and returns it only if it stays within `realpath(tree)`; otherwise `None`.
- `resolve_anchor` now refuses an escaping anchor with a **constant** reason (`"anchor escapes the reviewed tree — not resolved"`, `render-bridge-findings.py:84-87`) — never opens the file, so no existence/line-count/substring leaks into the rendered (PR-bound) output.
- Negative tests added (`tests/integration/render-bridge-findings.bats:182-220`): `../secret.txt:1` fails closed in fail mode (exit 2) and downgrades in downgrade mode; both assert the secret content + line-count do NOT appear in output.
- Suite now 12/12.
