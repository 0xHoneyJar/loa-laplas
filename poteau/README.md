# poteau — the center post

**Domain**: enforcement · **Status**: reference-drop v0.1.0 · demo-proven 17/17

The hook-lattice enforcement layer for construct-rooms-substrate: every prompt, tool
call, and turn-exit passes through the post, deterministically, outside the context
window. Closes issues #29 (task conformance), #30 (council fail-closed), #31
(proof-of-grounding), #7 (governed-path teeth).

| path | what |
|---|---|
| `manifest/poteau.manifest.json` | the ONLY hand-edited file (projen discipline) |
| `bin/poteau-gen.mjs` | manifest → settings + checksums; refuses drift (P401), unhonorable mandates (P301), missing closure (P302) |
| `bin/poteau-gatekeeper.mjs` | the exit-gate judge: packet, task_ref, H1-echo grounding, council voices, receipt mint (ed25519, chained) |
| `hooks/` | prompt-arm · tool-gate · move-record · exit-gate · compact-clew (postures documented in-file) |
| `data/error-codes.json` | P-codes, loa E-code style: code/name/what/fix |
| `test/run-demo.sh` | fixture-driven proof of PT-1..PT-9: `POTEAU_SRC=$(pwd) bash test/run-demo.sh` |

Requires: node ≥18, jq (verified at compile time — P302), bash. See ../ARCHITECTURE.md
and ../PROMPT.md.
