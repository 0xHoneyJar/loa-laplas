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
| formation→observability→payoff | Level intro names which layer each gate checks; morgue groups outcomes by layer | — | — | ☐ S3 (not in S2.3 scope) |
| Hardness honesty | SOLID door bar + filled keepers when `hook`; HOLLOW (outline, 45% alpha) when `prose`/`unknown` | 3 vs 9/19 | solid vs hollow captures | ✅ S2 |
| IMPASSE arrival | Violet `#8a7fe8` styling — routed, never bounced (distinct from rage-red refusal) | 13 · 15 | `captures/s2-gate-impasse.png` · `captures/s2-arrive-impasse.png` | ✅ S2 |
| `<script>`-in-gateline inert (SP-B6) | Escaped text in log + status; bare `<b>/<i>` survive | 4 | eval proof + visible in `s2-gate-solid.png` | ✅ S2 |
| rev-1 visual regression (IMP-008) | BAKED rev-1 level: old engine vs rev-2 engine — only intended delta is HOLLOW keepers (fail-honest default) | 3 | `captures/rev1-baked-gate-{OLD,NEW}.png` | ✅ S2 |
| The thread (clew polyline) | Violet thread from clew room back to divergence envelope's room | — | — | ☐ S3 |
| Retrace beat | Envelope walks BACK along the thread, pale violet | — | — | ☐ S3 |
| Rotate beat | Resident sprite swaps for fresh instance, flash + ↻ badge | — | — | ☐ S3 |
| Heal beat (the summon) | GECKO sprite enters via reaper choreography at friendly tempo, inspects (2-beat), patches, exits | — | — | ☐ S3 |
| Involuntary clew | Identical packet, `◷` badge (watchdog-dropped) | — | — | ☐ S3 |
| The three prices | Clew ends the span · signed (chain badge) · ordering visible in morgue tally (loiter burns > clew > finish) | — | — | ☐ S3 |

## Mechanical gates (CI — `.github/workflows/observatory.yml`)

| Check | Command | Status |
|---|---|---|
| Contract wall fires (selftest) | `node observatory/cli/obs.mjs selftest` | ✅ S1 |
| Veve vectors byte-match | `node observatory/cli/verify-vectors.mjs` | ✅ S1 |
| Shell builds | `npm ci && npm run build` in `app/observatory/` | ✅ S1 |
| Policy conformance (pure/total/cap-bounded) | — | ☐ S4 |
| Episode schema validates | — | ☐ S4 |
| Redaction fixtures (incl. sensitive-looking strings) | — | ☐ S5 |
| Deployed-engine same-origin fetch restriction | — | ☐ S5 |
