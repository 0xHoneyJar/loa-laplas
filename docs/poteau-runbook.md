# Poteau bootstrap runbook — OPERATOR-OWNED (IMP-008)

> The agent NEVER merges its own hook config. Every command below is yours.
> Why this path: `.claude/settings.json` here is framework-COPIED (refreshed on
> loa remount) — a merge into it is silently undone. `settings.local.json` is
> operator-owned and survives remount (SDD §4.2, grounded).

## When to merge

The fragment is safe to merge any time, but the lattice's prompt-arm uses the
REFERENCE behavior (arms on any `/compose|/simstim|/spiral` prompt) until S3.3
ports the ready-receipt requirement. **Recommended: execute the full
merge→verify→ROLLBACK cycle now (proves the bootstrap is repairable — the S1.3
acceptance), then merge for keeps after S3.3.**

## The cycle

```bash
# 0. generate (refuses on drift P401 / missing deps P302; council downgrade is
#    recorded until S4 builds the runner — you'll see P301-OVERRIDE, loudly)
node poteau/bin/poteau-gen.mjs --allow-single-model

# 1. MERGE — append poteau's hook entries into your settings.local.json
jq -s '.[0] * {hooks: ((.[0].hooks // {}) as $h | (.[1].hooks | to_entries
  | reduce .[] as $e ($h; .[$e.key] = ((.[$e.key] // []) + $e.value))))}' \
  .claude/settings.local.json .claude/settings.poteau.json > /tmp/sl.new \
  && mv /tmp/sl.new .claude/settings.local.json

# 2. VERIFY — checksums + the merged hooks are present
node poteau/bin/poteau-gen.mjs --check 2>/dev/null \
  || jq -e '.hooks | to_entries | map(.value[].hooks[].command)
       | flatten | map(select(test("poteau/hooks/"))) | length >= 5' \
       .claude/settings.local.json && echo "MERGED: 5 poteau hooks present"

# 3. ROLLBACK — one command, removes exactly the poteau entries
jq '(.hooks // {}) |= with_entries(.value |= map(select(
      [.hooks[]?.command // ""] | any(test("poteau/hooks/")) | not)))' \
  .claude/settings.local.json > /tmp/sl.new && mv /tmp/sl.new .claude/settings.local.json

# 4. RE-VERIFY — zero poteau hooks remain
jq -e '[.hooks // {} | to_entries[].value[].hooks[]?.command // ""]
  | map(select(test("poteau/hooks/"))) | length == 0' \
  .claude/settings.local.json && echo "ROLLED BACK clean"
```

New sessions pick up settings changes at launch (settings snapshot-at-start is
the first layer of hook-config protection — restart the session after merge).

## Break-glass (B3 — memorize this one)

`POTEAU_BREAK_GLASS="<your reason>" claude …` at session LAUNCH releases the
exit gate for that session's stops, writing every use to `incidents.jsonl`.
Launch-env only; the agent cannot set it mid-session. Reason is mandatory.

## What's armed after a real merge (until S3.3 lands)

- `UserPromptSubmit`: `/compose|/simstim|/spiral` prompts open run-state + inject
  the governed-path line. - `PreToolUse`: P402 denies on `.claude/`,
  `.run/poteau/` (except the packet mailbox), `poteau/{manifest,hooks,bin}/`.
- `PostToolUse`: moves logged. - `Stop`: armed runs require a packet
  (`.run/poteau/packet.json` reference shape) — refusals teach the fix; 3 blocks
  per chain then checkpoint-and-release with an incident.
