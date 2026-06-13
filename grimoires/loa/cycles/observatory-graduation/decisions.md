# decisions.md — the G-1 ledger + cycle decision log

> **G-1 (the primary goal)**: ≥3 real gate-design decisions made/changed BECAUSE
> the game made them visible — logged at decision time as
> `{date · decision · rendered-beat citation (phase/screenshot/level-id) · what changed}`.
> Anti-Goodhart (R-4): **a decision without a beat citation does not count.**
> Trajectory (IMP-003): ≥1 entry by S4 close · ≥3 by cycle end.

## G-1 ledger (gate-design decisions, beat-cited)

| # | Date | Decision | Rendered-beat citation | What changed |
|---|---|---|---|---|
| 1 | 2026-06-12 | `compose-calls-ceiling` is signage, not a gate — declared `prose` in hardness-manifest v1; budget-watchdog hook queued (s3-regrounding-spike: budget-exhaustion → involuntary clew) | `verify/captures/s2-gate-impasse.png` (phase 13: the ceiling's HOLLOW door + teaches line "a ceiling that cannot reap is signage, not a gate") | hardness-manifest.json gains the entry; S3 spike re-grounds SDD §3.3 watchdog trigger from liveness to budget/convergence |

| 2 | 2026-06-12 | **Disciplined stays clew-less — its walled-room REJECTED is a feature, not a bug.** When the haiku construct-agent played the disciplined seat against the walled room, it panic-presented 25%-quality work and LEGBA barred the door (verdicts EEERE) — instead of testifying. The contrast with the stuck policy's voluntary clew IS the design lesson: the archetypes must keep their honest blind spots or the sim stops diverging. Decision: do NOT add a clew branch to disciplined/greedy; the clew is `stuck`'s distinguishing move, and a policy that presents garbage at panic renders a different (visible, judged) failure than one that testifies. | `episodes/agent-disciplined-42.{jsonl,level.json}` · `verify/captures/s4-agent-episode-morgue.png` · the EEERE story (room 3 REJECTED beat) | policies.mjs registry doc hardened; the agent's own reflection archived in the episode record |

> Causality note (anti-Goodhart honesty): entry 1 was INITIATED by S1.4 forensics
> (raw JSONL) and CONFIRMED by the rendered beat — the hollow door made the
> declared-but-unenforced ceiling legible enough to commit the S3 hook design.
> Entry 2 was born in-game: the agent's played episode made the contrast visible
> before any code changed.

## Cycle decisions (gates, checkpoints, diagnoses)

### S1.4 — k-hole loiter diagnosis (R-6, IMP-004) — 2026-06-12

**symptom**: k-hole stage-1 grounding agent (compose run obs-design-20260612) loitered
~14 min / 68 tool calls in a single open-ended reasoning room without converging to a
handoff. Not spinning (varied calls), not stalled — loitering. Reaped manually mid-stage;
zero synthesis produced.

**evidence**:
1. `~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/99fe3232-84af-4ee6-8553-7d3c24393a5b.jsonl`
   @ 2026-06-12T04:19:45Z — GitHub issue filed with full forensics: "compose stages
   loiter: model-tier mismatch (sonnet in single open-ended reasoning rooms) — root vs
   symptom". Quote: "ran ~14 min / 68 tool calls … had to be reaped manually mid-stage;
   produced zero synthesis."
2. `~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/a1fee6a0-e9c8-4273-822e-090cd978465b.jsonl`
   @ 2026-06-12T04:02:16Z — Form-C manifest: `{"stage": 1, "construct": "k-hole",
   "model": "sonnet", "calls_ceiling": 2}` — **ceiling declared 2, actual 68: the
   ceiling was prose, not a hook**.
3. Same transcript @ 2026-06-12T04:40:25Z — the fix commit (crs #40, singleton-up
   routing): "mid/standard → opus (was sonnet) … sonnet singletons saved dollars that
   don't exist while paying real convergence-time costs (the 14-min/68-call loiter)."
4. `construct-k-hole/scripts/dig-search.ts` — robust: 480s CLI timeout, 90s/REST call,
   3-attempt exponential backoff. No hang path found.

**root_cause**: model-tier ↔ room-cognitive-load mismatch (compose routing), compounded
by a declared-but-unenforced per-stage budget (`calls_ceiling` never fired). NOT script
breakage — dig-search.ts is sound.

**verdict_on_A3**: **DISPROVEN.** A-3 claimed loiter = script breakage. The agent's
tooling worked; the model ground without converging and nothing was empowered to reap
or clew it. Fix already landed as crs #40 (tier routing); the budget-enforcement hole
remains open substrate truth.

**→ IMP-005 remediation (queued, gates S3.4)**: one-day re-grounding spike updates
SDD §3.3 clew mechanics against the ACTUAL failure mode before S3.4 may close:
- The watchdog trigger is **non-convergence/budget-exhaustion**, not non-liveness — the
  loitering agent was fully live (varied calls). `livenessVerdict` alone would NOT have
  fired here. The involuntary clew needs a budget/convergence dimension
  (calls-ceiling-exceeded → watchdog clew), or the rendered mechanics overpromise.
- Bead: `s3-regrounding-spike` (blocks S3.4).

**Two seeds for the instrument** (not G-1 entries yet — no rendered beat exists; cite
these when the beats land):
- `calls_ceiling` is a real gate that is HOLLOW today (declared 2, actual 68) —
  seed it into `hardness-manifest.json` at S2.2 with `hardness: prose`.
- The #40 routing decision was made from raw JSONL forensics. The Observatory exists so
  the NEXT such decision is made from a rendered beat — this diagnosis is the
  control-group anecdote for G-1.

### S3.4 — FR-B closure gate (blocked-by S1.4, flatline SP-B5/IMP-006) — 2026-06-12

S1.4's diagnosis reviewed: **A-3 DISPROVEN** → IMP-005 remediation EXECUTED before
S3 mechanics were built (the spike preceded S3.1, not just S3.4):

- **SDD §3.3 amended** (both copies, marked amendment — flatlined text preserved):
  watchdog trigger taxonomy = `liveness` OR `budget`; the loiter case is budget
  exhaustion by a fully-live agent. `clews[].trigger` joins rev 2 as optional declared
  data; red test (`trigger: "vibes"` rejected) in selftest.
- **Sim mechanics re-grounded**: the stuck condition is a QUALITY WALL (returns
  plateau below every present threshold), not a hang — `--stuck N`. Discipline
  testifies at the plateau (voluntary clew, clock 0.21); indiscipline grinds to the
  flood and the watchdog drops the identical packet with `trigger: budget`
  (clock 1.0). The three-prices ordering is IN THE DATA, then in the morgue.
- **Beat citation**: `observatory/verify/captures/s3-clew-involuntary.png` —
  the S1.4 loiter, rendered: flooded clock + ENRAGE + "◷ the watchdog drops the
  thread for protocol — budget spent. signed ⛓". Plus the G-4 third story golden
  vector `sim-stuck-clew-heals` (veve, byte-pinned).

**FR-B closes.** The clew mechanics now describe the failure mode that actually
happened, not the one we assumed.

### S5 — SHARE shipped; G-3 door wired, spectate entry OPEN — 2026-06-12

- **Public surface**: https://the-observatory-kappa.vercel.app — sim-first
  (engine + `/api/sim` WITH its abuse bounds; `/api/level` does NOT ship).
  Receipts against the LIVE URL: vector parity (rev-2 golden byte-match through
  the public API) · out-of-range → 400 · burst → 429s · CDN MISS→HIT on repeat
  params · production protection lifted by decision (previews stay SSO-gated);
  no auth on /api/sim BY DECISION (SP-B1/B3) — the clamps + bucket + CDN are
  the control. Capture: `verify/captures/s5-public-surface.png`.
- **Redaction**: allowlist-as-code, salted-HMAC pseudonyms (salt function-scoped,
  discarded), 7 tests incl. forged-flag refusal (IMP-011) and the SP-B2
  same-origin matrix. Topology leakage accepted by design.
- **G-3 (the attempt)**: the door is wired LOCAL-only per SP-B2 — deployed engine
  refuses cross-origin `?live=`/`?level=`. To spectate a real run:
  `node observatory/producers/serve.mjs --run .run/compose/<id>` then
  `localhost:8787/game.html?live=/level.json&auto=1`. **The "what the watching
  changed" entry belongs to the operator's first live spectate — OPEN.**

### S1.3 — A-2 checkpoint (dispatch gate, flatline SP-B4)

_PENDING — OPERATOR decision at S1 review. S2 work order may not OPEN until this is logged._

Trigger criteria (IMP-001) — fire the freeside-observatory fallback if ANY hold:
- (a) crs CI path rules reject `app/` — **none.** `next build` green; observatory CI workflow added with shell-build job.
- (b) build tooling conflicts (lockfile/framework collisions) — **none.** Shell is a self-contained project at `app/observatory/` (own package.json + lockfile); crs root stays manifest-free by design.
- (c) maintainer veto at S1 review — **not cast.**

**Decision (2026-06-12, operator at S1 review): ACCEPT — crs is home.** The
freeside-observatory fallback does not fire. S2 work order may open (SP-B4 satisfied).
Logged from operator selection at the A-2 pair-point; PR #43 carries the receipts.
