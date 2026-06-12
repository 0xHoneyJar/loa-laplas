# Structure — annotated tree (app zone)

```
construct-rooms-substrate/
├── construct.yaml              # manifest v4: type skill-pack, personas/skills EMPTY by design
├── README.md                   # front door (test counts + component table STALE — see drift)
├── CLAUDE.md                   # stub; imports .claude/loa/CLAUDE.loa.md
├── SPINOUT.md                  # spinout-from-loa-constructs record
├── compositions/               # 4 reference compositions
│   ├── code-implement-and-review.yaml   # pilot: implementer ↔ FAGAN review loop
│   └── {access,fidelity,frame}-relay.yaml
├── scripts/
│   ├── compose-dispatch.sh     # 1009 ln — COMPILER entry (Form C + legacy A/B)
│   ├── compose-verify-run.sh   # 510 ln — proof-of-run terminal gate
│   ├── compose-{handoff-wrap,seam-clew,doctor,output-schema-preflight}.sh
│   ├── construct-adapter-gen.sh
│   ├── {handoff,room-packet,construct-manifest,pair-relay}-validate.sh
│   ├── handoff-parity-check.sh · surface-envelope.sh · migrate-subagents-*.sh
│   ├── lib/
│   │   ├── compose-cut.py      # 341 ln — is_seam + co-location cut algorithm
│   │   ├── segment-emitter.py  # 1447 ln — .workflow.js emitter; js() guard; tier routing
│   │   ├── adapter-generator.py · compose-cost-card.py
│   │   ├── construct-handoff-lib.sh   # hash core (compute-id)
│   │   └── run-emitted-segment.js · workflow-syntax-check.js
│   ├── clew/                   # VENDORED (loa-constructs) — capture/distill/ledger/genome
│   └── legba/                  # PROVISIONAL — custody-chain verify/challenge CLI (.mjs, zero-dep)
├── hooks/
│   ├── subagent-start/loa-tool-mandate.sh   # log-only observability
│   └── subagent-stop/loa-handoff-collect.sh
├── data/
│   ├── schemas/construct-manifest-v4.schema.json
│   └── trajectory-schemas/{construct-handoff,room-activation-packet,pair-relay-composition}.schema.json
├── skills/compose/SKILL.md     # /compose — THE composition surface
├── templates/construct-adapter.template.md
├── docs/
│   ├── compose-as-cc-workflow.md        # seam-protocol AUTHORITY
│   ├── cycles/cycle-053-compose-as-cc-workflow.md
│   ├── runtime/{construct-adapters,composition-patterns}.md
│   └── v1.{1,2}-additions.md
├── tests/
│   ├── integration/            # 11 bats suites, 223 @test
│   ├── composition/state/      # 2 bats suites, 13 @test (NOT run by `bats tests/integration/`)
│   └── fixtures/               # form-c/ · handoff-packets/ (valid-*/invalid-*) · pair-relay/ · room-packets/ · probe-adapters/
└── .github/workflows/post-merge.yml + CODEOWNERS
```

Excluded zones: `.loa/` (framework submodule), `.claude/` (System Zone symlinks),
`grimoires/` (State Zone), `.run/` (runtime artifacts), `.beads/`, `.loa-state/`.
