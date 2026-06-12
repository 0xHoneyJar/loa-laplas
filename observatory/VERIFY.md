# VERIFY — the G-2 checklist

> Every doctrine concept renders faithfully in the game, and the rendering is
> **proven by a deterministic capture**, not asserted. Capture law (flatline
> SP-B10): agent-browser **1440×900** at deterministic `?phase=` seeks under
> the engine's sim-time law; vectors run under **Node ≥22, `LANG=C TZ=UTC`**;
> digests are JCS canonical JSON. Baseline images live beside this file in
> `verify/` and are checked in.
>
> A row is DONE when: beat implemented → `?phase=` index recorded → capture
> checked in → capture diff stable across two runs.

## Doctrine → beat → proof (SDD §4)

> S2 captures use `verify/fixtures/verify-s2.level.json` via `#level=<b64>`,
> frozen with `seek(N)` + pause (the time fold makes any seek deterministic).

| Doctrine | Beat | `?phase=` | Capture | Status |
|---|---|---|---|---|
| Receipts-not-rituals | Gate consumes the ENVELOPE visibly; gateline names evidence, never an act | 3 | `captures/s2-gate-solid.png` | ✅ S2 |
| 3-tier awareness: signage | Room plates + title-screen manifest panel listing verbs | title | `captures/s2-title-manifest.png` | ✅ S2 |
| 3-tier: --help | `gate.help` tooltip plate above the door while the envelope waits | 19 | `captures/s2-gate-help-tooltip.png` | ✅ S2 |
| 3-tier: the-gate-teaches | REJECTED/DENIED/IMPASSE gateline appends `gate.teaches` — the refusal IS the documentation | 9 | `captures/s2-gate-hollow-teaches.png` | ✅ S2 |
| stderr-as-prompt | `teaches` carries the corrected invocation verbatim | 9 | same capture (log line: `run compose-verify-run.sh <run_id>…`) | ✅ S2 |
| formation→observability→payoff | Level intro names which layer each gate checks; morgue groups outcomes by layer | — | — | ☐ deferred (not in S2.3/S3 task scope — FR-A residual) |
| The thread (clew polyline) | Violet thread from clew room back along traversed seams to the divergence junction — ≥2 seams; persists once dropped | 13 | `captures/s3-clew-thread-draws.png` · `s3-thread-persists.png` | ✅ S3 |
| Retrace beat | Envelope ghosts BACK along the thread, pale violet | 19 (retrace fixture) | `captures/s3-retrace-beat.png` | ✅ S3 |
| Rotate beat | Fresh instance takes the chamber — flash + ↻ badge | 19 (rotate fixture) | `captures/s3-rotate-beat.png` | ✅ S3 |
| Heal beat (the summon) | GECKO walks in along the thread (friendly reaper choreography), 2-beat inspect, patch flash, exits | 19 @ pt 2.5 / 2.95 | `captures/s3-heal-inspect.png` · `s3-heal-patch.png` | ✅ S3 |
| Involuntary clew ◷ | Watchdog drops the identical packet at the flood — `trigger: budget` (§3.3-amendment); ENRAGE clock + ◷ badge | 13 (disc .1) | `captures/s3-clew-involuntary.png` | ✅ S3 |
| The three prices | Clew ends the span · signed ⛓ into the chain · morgue tally: `loiter burns > clew > finish` + clew row; teaching line on first clew | 33 (morgue) | `captures/s3-morgue-prices.png` | ✅ S3 |
| Hardness honesty | SOLID door bar + filled keepers when `hook`; HOLLOW (outline, 45% alpha) when `prose`/`unknown` | 3 vs 9/19 | solid vs hollow captures | ✅ S2 |
| IMPASSE arrival | Violet `#8a7fe8` styling — routed, never bounced (distinct from rage-red refusal) | 13 · 15 | `captures/s2-gate-impasse.png` · `captures/s2-arrive-impasse.png` | ✅ S2 |
| `<script>`-in-gateline inert (SP-B6) | Escaped text in log + status; bare `<b>/<i>` survive | 4 | eval proof + visible in `s2-gate-solid.png` | ✅ S2 |
| rev-1 visual regression (IMP-008) | BAKED rev-1 level: old engine vs rev-2 engine — only intended delta is HOLLOW keepers (fail-honest default) | 3 | `captures/rev1-baked-gate-{OLD,NEW}.png` | ✅ S2 |

## Mechanical gates (CI — `.github/workflows/observatory.yml`)

| Check | Command | Status |
|---|---|---|
| Contract wall fires (selftest) | `node observatory/cli/obs.mjs selftest` | ✅ S1 |
| Veve vectors byte-match | `node observatory/cli/verify-vectors.mjs` | ✅ S1 |
| Shell builds | `npm ci && npm run build` in `app/observatory/` | ✅ S1 |
| Policy conformance (pure/total/cap-bounded) | `node --test observatory/tests/policies.test.mjs` (11 tests, incl. IMP-010 registry wall + SP-B8 bound witness seed 5) | ✅ S4 |
| Episode schema validates | same suite + sim validates line-by-line before emit; agent episode archived: `grimoires/loa/cycles/observatory-graduation/episodes/agent-disciplined-42.jsonl` (28 ticks) · replay capture `captures/s4-agent-episode-morgue.png` | ✅ S4 |
| Redaction fixtures (incl. sensitive-looking strings) | `node --test observatory/tests/share.test.mjs` (7 tests: nothing survives, salts differ/topology identical, allowlist-is-code, IMP-011 forged-flag refusal) | ✅ S5 |
| Deployed-engine same-origin fetch restriction | same suite (SP-B2 matrix: schemes/protocol-relative/backslash refused) + engine doors warn and refuse | ✅ S5 |
