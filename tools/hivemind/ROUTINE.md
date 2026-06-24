# AFK Triage → Review → Land — Cloud Routine spec (loa-laplas)

The unattended Cloud Routine that runs the loop for `0xHoneyJar/loa-laplas`. This toolkit is
ported from `loa-freeside` `tools/hivemind/` — same vendored scripts, repo-specific config
(this file + `auto-merge-allowlist.yml`) re-derived for the brakes runtime. Created by the
operator via `/schedule` (it runs on Anthropic cloud — laptop-closed, fresh clone, no
`~/.claude`, no mid-run prompts, on the Claude subscription, 1-hour-min cadence).

> **Brakes-repo caveat.** loa-laplas IS the enforcement lattice (Laplas exit-2 deny · Poteau ·
> Legba ed25519 trust-root · Observatory). The **labeling half** of this loop (triage-sweep)
> is fully safe to run AFK — labels are additive and reversible. The **auto-merge half** is
> deliberately near-disabled here: `auto-merge-allowlist.yml` excludes the entire enforcement
> core, trust root, signing, and gate workflows, so every fix PR against the teeth STAGES for
> your one-click. Start with labeling-only; opt into bug-fix PRs once you trust the loop.

## The routine prompt (paste into `/schedule`)

> You are the AFK triage agent for `0xHoneyJar/loa-laplas`. You run unattended; no human is
> watching, so never ask permission — proceed on reversible actions and stage anything
> irreversible for the operator.
>
> 1. Run `TRIAGE_REPO=0xHoneyJar/loa-laplas tools/hivemind/triage-sweep.sh --apply` — labels
>    every open issue with canonical hivemind colon-labels and writes the routing manifest to
>    `.run/hivemind/triage-manifest.json`.
> 2. For each manifest entry with `route: operator`: re-read the issue. The regex
>    under-detects bugs — if it's actually a reproducible bug (stack trace, error, broken
>    behavior), re-route to `bug`; otherwise leave it labeled in the operator queue. **Never
>    silently default an ambiguous issue — when unsure, leave it for the operator.**
> 3. For each `route: bug` issue: run `/bug` → prepare a fix on a branch → open a PR →
>    run a Bridgebuilder review (Opus) and a Fagan diff review (Codex + Cursor).
> 4. Decide land-vs-stage against `tools/hivemind/auto-merge-allowlist.yml`: if the PR matches
>    an ENABLED allow rule AND satisfies every `require` (CI green, reviews resolved, gates
>    pass, no excluded paths) → merge it. Otherwise → leave it open (staged) with the review
>    posted, for the operator's one-click. On the brakes repo almost everything stages — that
>    is by design.
> 5. Before reporting progress, audit each claim against a tool result (a PR URL, a CI
>    status, a merge SHA). Report only verified outcomes; if a step failed, say so.
>
> Brakes: never touch an `exclude_paths` entry in an auto-merge; never auto-merge a PR with
> an unresolved CRITICAL/HIGH finding; never auto-merge anything touching `laplas/`, `poteau/`,
> `observatory/`, the trust root, signing, or `.github/workflows/`; cap at 5 bug-fix PRs per
> run; on any ambiguity, leave it for the operator and move on.

## Model routing (cost-tiered)

| Stage | Model |
|---|---|
| labeling | free — `triage-sweep.sh` regex, zero tokens |
| `/bug` triage + bug re-classification backstop | sonnet |
| Bridgebuilder review | Opus → Fable when it lands |
| Fagan diff | Codex + Cursor (parallel) |

## Setup checklist (do once before the first run)

- [ ] `gh` auth available in the routine env (GitHub connector / token).
- [x] Vendored scripts committed under `tools/hivemind/` (fresh clone sees them).
- [x] Canonical hivemind labels + the two routing labels seeded on the repo (31 ensured via
      `tools/hivemind/label-setup.sh 0xHoneyJar/loa-laplas` — includes
      `triage:operator-review` + `triage:bug-queued`).
- [ ] **Eyeball `auto-merge-allowlist.yml`** — the entire blast radius of unattended merges.
      On the brakes repo it ships near-disabled (docs + deps only); decide if you want more.
- [ ] Confirm the Claude plan tier allows Cloud Routines + the usage budget.
- [ ] (optional, destructive, operator-gated) collapse any legacy bracket labels:
      `node tools/hivemind/label-sync.mjs loa-laplas --apply --migrate`

## Brakes (baked in — the routine has no mid-run human)

- `auto-merge-allowlist.yml` is the whole auto-merge blast radius; everything else stages.
  On loa-laplas the enforcement core, trust root, signing, and gate workflows are excluded
  outright — they can never auto-merge.
- triage-sweep labels are regex + additive (reversible).
- the repo's own enforcement gates (`.github/workflows/poteau.yml`, `observatory.yml`,
  `post-merge.yml`) keep CI honest before any merge decision.
- per-run PR cap (5); 1-hour-min cadence bounds spend.
- "never silently default" — ambiguous issues route to the operator queue.

## What's built vs operator-gated

- **Built + verified:** vendored `autolabel.mjs` / `label-sync.mjs` / `hivemind-validate.sh`
  (fresh-clone-safe) + `triage-sweep.sh` (classify → route → manifest, default repo
  = loa-laplas) + `label-setup.sh` (labels already seeded) + this spec + the allowlist.
- **Operator-gated tail:** create the Cloud Routine (`/schedule`), eyeball the allowlist,
  confirm plan tier. Then it runs AFK. Recommended first cadence: labeling-only (skip steps
  3–4) until you trust the classification on the brakes repo's issue mix.
