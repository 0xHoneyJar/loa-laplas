# Demo assertion inventory (IMP-004 — the count derives from THIS list)

The demo's RESULT line must equal the row count here (currently **24**). A new
assertion joins this table in the same commit, or CI refuses — count drift is
unaccounted coverage. Rows are the demo's `ck` labels VERBATIM (greppable).

| # | Assertion (verbatim ck label) | Invariant / issue |
|---|---|---|
| 1 | gen without council runner refuses (exit 4) | PT-4 compile half · #30 · P301 |
| 2 | explicit --allow-single-model compiles (recorded) | PT-4 override path |
| 3 | hand-edited generated file refuses (exit 3) | PT-6 · P401 |
| 4 | --force regenerates | PT-6 escape hatch |
| 5 | no packet → Stop blocked, refusal names the fix | PT-1 · #7 · P101 |
| 6 | wrong task_ref → P201 (gate sees the task, #29) | PT-2 · #29 |
| 7 | no H1 echo → P203 (proof-of-grounding, #31) | PT-3 · #31 |
| 8 | 4th block in one chain → checkpoint-and-release + incident (liveness > imprisonment) | PT-8 |
| 9 | fresh turn resets chain; conforming+grounded packet → receipt minted | PT-2/3 green path |
| 10 | receipt chain exists on disk | G5 / legba shape |
| 11 | run state advanced (gate_index=1) | lifecycle |
| 12 | Edit on .claude/ denied (exit 2) | PT-5 · P402 |
| 13 | Bash redirect into manifest denied | PT-5 |
| 14 | reading the manifest allowed (narrow closed surface) | PT-5 narrow-closed |
| 15 | ordinary work allowed (wide open default) | posture split |
| 16 | T1 mailbox: packet.json write ALLOWED (the one judged slot) | T1 (SDD §4.6) |
| 17 | T1 mailbox: run-state.json write DENIED (P402 — constitutional) | T1 / PT-5 |
| 18 | T1 mailbox: receipts.jsonl write DENIED (P402 — the chain is not the agent's pen) | T1 / PT-5 |
| 19 | break-glass releases the gate | PT-9 |
| 20 | …and lands in incidents.jsonl (loudest signal) | PT-9 |
| 21 | mismatched module refused at the door (exit 2) | laplas P6xx |
| 22 | all six preparation failures named (P601-P606), each with the fix | laplas · R-5 fixture |
| 23 | complete module passes the ready check | laplas green path |
| 24 | ready receipt binds all three manifest hashes | laplas receipt |
