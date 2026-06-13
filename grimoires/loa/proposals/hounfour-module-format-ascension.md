# PROPOSAL — the laplas module format ascends to hounfour schema law

> **From**: loa-laplas (the kit) · **To**: loa-hounfour (the spec) · cycle laplas-poteau, 2026-06-12
> **Status**: PROPOSAL (ratification explicitly out of the laplas-poteau cycle scope)
> **Return trigger (IMP-013)**: revisit at laplas-poteau S6 close OR +30 days (2026-07-12),
> whichever is first — no proposal limbo.

## The trinity (why this is a hounfour concern, not a laplas one)

A module is three preparations — **quest** (the what), **party** (the who),
**dungeon** (the where) — authored separately, validated together. The format is
law; the kit targets it; the catalog conforms to it:

| layer | repo | change speed | owns |
|---|---|---|---|
| **spec** | loa-hounfour | slow (ratified) | the module FORMAT — versioned schema law |
| **kit** | loa-laplas | medium | the cooker + ready check + poteau lattice that TARGET the format |
| **content** | construct-compositions | fast | the sovereign catalog that CONFORMS to the format |

Spec, kit, content — three repos, three change speeds, Ostrom's three layers
wearing a game studio's org chart (quest design / encounter design / level design
are staffed as separate disciplines because they ARE separate disciplines). Reuse
compounds along three independent axes: the same quest with a cheap drafting party
Tuesday and a full council Friday; the same hardened dungeon hosting many quests;
party templates with names, vectors, reputations.

## What ascends

Four draft-07 schemas, attached from `loa-laplas/laplas/schemas/`, versioned
`module/1`:

- **quest.schema.json** — objectives (task literals, bounded ≤4000 chars + fence-safe
  so a malformed quest cannot escape a gate prompt), `requires{roles,tools}`,
  `review_routing{council,min_voices}`, `gates[{id,room,hitl?}]`,
  `mandated_reads[{path,h1}]`.
- **party.schema.json** — `members[]` of agent seats (`work`|`council`, tier) and HITL
  slots (the operator is a party slot, not ambient magic).
- **dungeon.schema.json** — `rooms[]` graph, `tools[]` (the veve'd allowlist —
  Daemonheim rule), `rel`, `budgets{tool_calls,wall_s,stall_s}`.
- **module.schema.json** — the three-path binder.

## Why these shapes are trustworthy as law

They are not designed-in-the-abstract: they were extracted from the reference
fixtures and PROVEN by the kit's ready check (P601–P606 cross-validation) and a
real decomposition — `compositions/code-implement-and-review.yaml` → a working
module that `laplas-ready` passes with a receipt binding all three manifest hashes.
The format earned schema status by being repeatedly useful before it was proposed.

## What ratification would add (hounfour's call, not laplas's)

- Canonical `$id` host (the schemas currently point at a placeholder
  `https://loa-hounfour/laplas/...`).
- A richer validator than the kit's zero-dep draft-07 SUBSET (the kit deliberately
  stays dependency-free; full draft-07 belongs at the spec layer).
- A conformance suite the content catalog runs against to claim `module/1`.
- The evolution rule for `module/2` (unknown ignored · missing-optional defaulted ·
  missing-required reject — the same rule poteau's contract already follows).

## Out of scope here

Ratification, the validator implementation, and the conformance suite are
hounfour's to decide. This proposal OPENS the conversation with proven schemas;
it does not presume the answer.
