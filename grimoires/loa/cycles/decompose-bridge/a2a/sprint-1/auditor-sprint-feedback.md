APPROVED - LETS FUCKING GO

# Sprint 1 — Security & Correctness Audit (decompose-bridge deterministic routing core + roster)

**Auditor**: paranoid cypherpunk security auditor (final gate; did not write or review). **Verdict**: **APPROVED**. **Tests independently run**: `node --test laplas/test/*.test.mjs` → **44 pass / 0 fail** (the `jq` stderr lines are unrelated noise from the form-c-manifest ready-gate test, not S1). No CRITICAL or HIGH findings. The sprint is exactly what it claims: pure deterministic logic, no secrets, no network, no auth, no LLM in the loop. The two security-critical invariants from prior gates (B7: model self-confidence is telemetry-only / never gates; B2: no wildcard gate default) are honored and I re-verified both empirically. Three MEDIUM/LOW notes below are advisory and all properly belong to S2/S3 — none block S1.

---

## Findings by severity

### CRITICAL — none.

### HIGH — none.

### MEDIUM-1 — `centrality` is unbounded recursion, runs BEFORE the `N_MAX_ITEMS` bound, and is reachable as a DoS the moment S3 wires the (untrusted) LLM split
**File**: `laplas/lib/centrality.mjs:9-15` (recursive `visit`) · pipeline ordering `laplas/lib/derive-routing.mjs:27` (calls `centrality` per item) vs the only bound at `laplas/lib/dag-validate.mjs:23`.

The pipeline order (SDD §1, PRD seam) is **derive-routing → dag-validate**. The `1 ≤ items ≤ N_MAX_ITEMS(16)` bound lives *inside* `dagValidate` — i.e. it fires **after** `deriveRouting` has already run `centrality` over every item. `centrality` is plain recursion (`visit` calls itself per dependent) with **no depth bound**. The `seen` Set correctly bounds *cycles* (self-dep → 1, 2-cycle → 2, no infinite loop — verified), but it does NOT bound *depth*.

Empirically (probes run, pipeline order, untrusted item list):
- `deriveRouting(chain(20000))` → **`RangeError: Maximum call stack size exceeded`** (hard crash).
- `deriveRouting(chain(2000))` → **16.7 seconds** of compute (≈O(V²)+ — `centrality` is `rawItems.map` × `directDependents`=`items.filter` per recursion step) before `dagValidate` ever gets the chance to reject it for `BOUNDS`.

The over-large item array's source is the **S3 sonnet split — untrusted LLM output**. So this is *latent* in S1 (S1 has no LLM caller, no S1 test feeds unbounded input, suite is green) but becomes a live DoS/crash vector the instant S3 calls `deriveRouting` on a split that over-fragments. Note the glaring internal inconsistency: `findCycle` in the *same deliverable* (`dag-validate.mjs:56-73`) was **deliberately written iterative-DFS to avoid stack overflow** — yet `centrality`, which runs *earlier* in the pipeline, was left recursive.

**This is the one thing both the implementer AND the reviewer missed.** The reviewer's report explicitly probed `>16 items → fail BOUNDS` — but tested it by calling `dagValidate` *directly*, never through the real pipeline order (`deriveRouting` first). The recursion + the post-positioned bound are invisible unless you exercise derive-before-validate on an oversized list.

**Fix (S1-appropriate, this is the pure-core sprint)** — do BOTH:
1. `laplas/lib/derive-routing.mjs:18` — reject `rawItems.length > N_MAX_ITEMS` at the TOP of `deriveRouting`, before any per-item `centrality`/`placeTier` work (return a typed `fail`/`refusal` or have the S3 caller size-check first). The bound must gate the expensive step, not trail it.
2. `laplas/lib/centrality.mjs:9-15` — make `visit` iterative (explicit work-stack), mirroring the iterative `findCycle` already in `dag-validate.mjs`. Eliminates the stack-overflow class entirely regardless of where the bound sits.

**Severity rationale**: MEDIUM not HIGH because (a) no S1 caller currently feeds unbounded input, (b) tests are green, (c) the input is operator-local in P1. **MUST be carried to S3** as a fix-before-LLM-wire item — once sonnet output flows into `deriveRouting`, leaving this unfixed promotes it to a real DoS.

### MEDIUM-2 — path traversal in `loadRoster` reads arbitrary files AND echoes file content in the error string (info-disclosure primitive)
**File**: `laplas/lib/roster.mjs:43` — `join(dirname(modulePath), mod.party)` then `readFileSync(...)`.

`mod.party` is used as a path component with **no containment check**. Probes run:
- `mod.party = "../../../../../../etc/passwd"` → resolves to the real `/etc/passwd`, Node opens it, JSON.parse fails, and the error string **echoes the file's first bytes** (`"ROSTER_INVALID: Unexpected token '#', \"##\n# User ...\" is not valid JSON"`). So this is *arbitrary file read + partial content disclosure via the error message*.
- `mod.party = "/etc/passwd"` (absolute) → **neutralized**: Node's `join(dir, "/etc/passwd")` strips the leading slash → `dir/etc/passwd` (stays inside). Absolute traversal does NOT escape.

**Real risk: bounded.** This is a local CLI reading the operator's *own* manifests — `mod.party` is operator-authored, not a network input, in Phase 1. The teeth are: (1) the relative-`..` traversal escapes the manifest dir, and (2) the JSON-parse error leaks file content into a string that may surface in logs/telemetry. If a `module.json` is ever attacker-influenced (a shared/imported composition, a future remote module fetch), this is a genuine arbitrary-read + info-disclosure.

**Fix (advisory, cheap, S1-appropriate)**: after `join`, assert the resolved party path stays within `dirname(modulePath)` (e.g. `resolve(partyPath).startsWith(resolve(dirname(modulePath)) + sep)`); on escape → `exit 6` with a path-omitting message. Separately, do not echo `e.message` for parse failures (or truncate/sanitize it) so file bytes never reach the error string. Belongs with S2's input-boundary hardening; NOTE it now.

### LOW-1 — `covers_domains` array values are trusted verbatim (null/empty can poison the coverage Set); unreachable today but inconsistent with the sibling branch
**File**: `laplas/lib/gate-coverage.mjs:12-13`.

The `covers_domains` branch (`:12`) adds every array element to the coverage Set with **no truthiness filter**, while the back-compat `entry.domain` branch (`:13`) IS truthiness-gated. So a manifest declaring `covers_domains: [null]` puts `null` in the coverage Set, after which `gateBlind(null, cov)` returns **`false`** — an unresolved-domain leaf would read as gate-covered → cheap. **Unreachable in the real path**: `deriveRouting:28` guards `domain != null` before computing `gate_coverage`, and `dagValidate:47` refuses any `domain == null` item as `DOMAIN_AMBIGUOUS` before it can run. So a null-domain leaf never reaches a runnable state. Pure defense-in-depth. **Fix**: filter falsy values in the `covers_domains` branch (`for (const d of entry.covers_domains) if (d) covered.add(d)`), matching the sibling branch. Advisory.

---

## Security checklist results

| Check | Result |
|-------|--------|
| **Secrets / hardcoded creds/keys/tokens** | **NONE.** Grep + read of all 8 libs + 2 schemas + tests: zero credentials, zero tokens, zero env-secret reads. Only `node:` builtins + relative imports. |
| **Input validation / path traversal** (`loadRoster` → `mod.party`) | **FINDING → MEDIUM-2.** Relative `..` traversal reads arbitrary files + leaks content via the parse-error string. Absolute paths neutralized by `join`. Bounded risk (operator-local manifests, P1). |
| **ReDoS** (`resolveDomain` `/[,;|]/`) | **SAFE.** Trivial character-class, no backtracking, no quantifier nesting. Not a ReDoS shape. |
| **Unbounded compute / stack overflow** (`centrality` recursion) | **FINDING → MEDIUM-1.** Recursive, depth-unbounded, runs before the `N_MAX_ITEMS` bound. 20k chain → stack overflow; 2k chain → 16.7s. `seen` guard bounds cycles (correct) but NOT depth. |
| **Error handling / info disclosure** | `ROSTER_INVALID` messages echo tier names, role ids, and (MEDIUM-2) file content from parse failures. Tier/role echo is acceptable (operator-authored, useful). File-content echo is the real leak — folded into MEDIUM-2. |
| **Priv-esc by tier** (clamp routes leaf HIGHER than role permits?) | **SAFE — verified.** `placeTier` clamp only ever *lowers* tier (`tierRank(tier) > tierRank(ceiling)`). No code path raises a leaf above `tier_default` or its ceiling. `opusPredicate=false → tier=tier_default`. Confirmed across blind+haiku-ceiling, covered+opus-ceiling, haiku-default+opus-ceiling. |
| **`gate_blind` wrongly false** (suppressing opus where unverifiable?) | **SAFE — verified.** Unresolved domain (`null`/`undefined`) → `gateBlind` returns `true` → opus (conservative). The only way to flip it false is the LOW-1 poisoned-Set edge, which is unreachable (two upstream `domain != null` guards). |
| **Prototype pollution** (`__proto__`/`constructor`/`prototype` as id/role/dep) | **SAFE — verified, see below.** |
| **Deferred footgun** (strict-confidence → all-serial silent) | **CONFIRMED SAFE DEFAULT, correctly deferred to S3.** Serial is the conservative fallback (never a mis-route, B7 preserved). It's a *legibility* footgun (un-migrated manifests silently never fan out), not a security issue. The reviewer already flagged it; the implementer correctly left the distinct-signal work to S3. Not faulting S1. |

## Prototype-pollution check (explicit)
Probed `id`, `role`, and `depends_on` values of `"__proto__"`, `"constructor"`, `"prototype"` through `dagValidate` (Map `byId`/`color`, Set `idset`), `rosterFromParty` (Map `byRole`), and `findCycle`:
- **No global pollution**: `Object.prototype` untouched after every probe (`({}).id === undefined`, `[].depends_on === undefined`).
- **No crash, no mis-route**: `id:"__proto__"` items validate to a clean `dag`; `role:"__proto__"`/`"constructor"` map to roster roles normally; `__proto__` self-cycle is correctly caught as `CYCLE __proto__→__proto__`.
- **Root cause it's safe**: every id/role-keyed structure is a `Map` or `Set`, never a plain-object dictionary. `Map.set("__proto__", v)` / `Set.add("__proto__")` write real entries — they do NOT walk the prototype chain. The code never does `obj[userControlledKey] = ...` on a plain object. **No prototype-pollution surface. Clean.**

## Path-traversal check (explicit)
See MEDIUM-2. **Result**: relative `..` traversal in `mod.party` **works** (reads `/etc/passwd`, leaks bytes into the error). Absolute paths are **neutralized** by `path.join`'s leading-slash strip. Real-world risk is **bounded** (local CLI, operator-authored manifests in P1) but the arbitrary-read + content-echo combo is a genuine primitive worth a containment check before any manifest becomes attacker-influenced. Advisory; carry to S2.

---

## Notes for the implementer/reviewer
The **MEDIUM-1 centrality DoS** survived both implementation and review. The reviewer did probe oversized input — but only against `dagValidate` directly, so the derive-before-validate ordering (which lets unbounded input hit the recursive `centrality` first) never surfaced. The tell was already in the codebase: `findCycle` was made iterative *on purpose* to dodge stack overflow, while its sibling `centrality` — running earlier on the same untrusted list — was left recursive and unbounded. Fix both before S3 wires the LLM split.

**Carry to S2/S3**: MEDIUM-1 (bound + de-recursion before LLM wire — S3 blocker-adjacent) · MEDIUM-2 (path containment + don't-echo-file-content — S2 boundary) · LOW-1 (filter falsy `covers_domains` — anytime).
