#!/usr/bin/env bash
# poteau demo — fixture-driven proof of every invariant. Run from a scratch dir.
set -u
cd "$(mktemp -d)" && mkdir -p poteau && cp -r "$POTEAU_SRC"/* poteau/ && cp -r "$(dirname "$POTEAU_SRC")/laplas" laplas && PASS=0; FAIL=0
say(){ printf '  %-52s %s\n' "$1" "$2"; }
ck(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); say "$3" "PASS"; else FAIL=$((FAIL+1)); say "$3" "FAIL (got $1 want $2)"; fi }

echo "== PT-GEN-3: refuse-to-compile on unhonorable council mandate (P301 / issue #30) =="
node poteau/bin/poteau-gen.mjs >/dev/null 2>&1; ck $? 4 "gen without council runner refuses (exit 4)"
node poteau/bin/poteau-gen.mjs --allow-single-model >/dev/null 2>&1; ck $? 0 "explicit --allow-single-model compiles (recorded)"

echo "== PT-GEN-2: drift refusal (P401) =="
echo '{"tampered":true}' > .claude/settings.poteau.json
node poteau/bin/poteau-gen.mjs --allow-single-model >/dev/null 2>&1; ck $? 3 "hand-edited generated file refuses (exit 3)"
node poteau/bin/poteau-gen.mjs --allow-single-model --force >/dev/null 2>&1; ck $? 0 "--force regenerates"

echo "== Arm a run, then walk the exit-gate ladder (P101→P201→P203→mint) =="
# S3.3 port: the DISPATCHER (gate 0) arms — not prompt-arm (hooks cannot conduct).
# The demo simulates the dispatcher's seed-runstate output directly.
mkdir -p .run/poteau
jq -n '{run_id:"demo-run", armed_at:"2026-06-13T00:00:00Z", gate_index:0, stop_blocks:0,
  task:{"id":"sprint-7","goal":"fix dpr curve"}, task_ref:"TBD",
  mandated_reads:[{"path":"docs/dpr.md","h1":"# DPR Methodology"}]}' > .run/poteau/run-state.json
# prompt-arm now only injects the gradient + links the session (fail-open); assert it does so
printf '%s' '{"prompt":"/compose ground-and-craft","session_id":"demo-sess"}' | bash poteau/hooks/prompt-arm.sh | grep -q "POTEAU ARMED (run demo-run)" ; ck $? 0 "prompt-arm injects the gradient + adopts the dispatcher-armed run (does NOT create run-state)"
OUT=$(printf '%s' '{"stop_hook_active":false}' | bash poteau/hooks/exit-gate.sh)
echo "$OUT" | jq -e '.decision=="block" and (.reason|contains("P101")|not) and (.reason|contains("handoff packet"))' >/dev/null; ck $? 0 "no packet → Stop blocked, refusal names the fix"
TASKREF=$(jq -cr '.task' .run/poteau/run-state.json | node -e 'const{createHash}=require("crypto");const jcs=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?"["+v.map(jcs).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+jcs(v[k])).join(",")+"}";let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("sha256:"+createHash("sha256").update(jcs(JSON.parse(s))).digest("hex")))')
jq -n '{verdict:"complete", rationale:"work is coherent", task_ref:"sha256:wrong", conformance:{in_scope:true}}' > .run/poteau/packet.json
OUT=$(printf '%s' '{"stop_hook_active":true}' | bash poteau/hooks/exit-gate.sh)
echo "$OUT" | jq -e '.reason|contains("AGAINST THE TASK")' >/dev/null; ck $? 0 "wrong task_ref → P201 (gate sees the task, #29)"
jq -n --arg t "$TASKREF" '{verdict:"complete", rationale:"work is coherent", task_ref:$t, conformance:{in_scope:true}}' > .run/poteau/packet.json
OUT=$(printf '%s' '{"stop_hook_active":true}' | bash poteau/hooks/exit-gate.sh)
echo "$OUT" | jq -e '.reason|contains("presumed unread")' >/dev/null; ck $? 0 "no H1 echo → P203 (proof-of-grounding, #31)"
printf '%s' '{"stop_hook_active":true}' | bash poteau/hooks/exit-gate.sh >/dev/null  # 3rd block in chain
OUT=$(printf '%s' '{"stop_hook_active":true}' | bash poteau/hooks/exit-gate.sh)
[ -z "$OUT" ] && grep -q max_blocks_checkpoint .run/poteau/incidents.jsonl; ck $? 0 "4th block in one chain → checkpoint-and-release + incident (liveness > imprisonment)"
jq -n --arg t "$TASKREF" '{verdict:"complete", rationale:"# DPR Methodology — grounded: curve scales per level...", task_ref:$t, conformance:{in_scope:true, note:"dpr only"}}' > .run/poteau/packet.json
printf '%s' '{"stop_hook_active":false}' | bash poteau/hooks/exit-gate.sh >/dev/null; ck $? 0 "fresh turn resets chain; conforming+grounded packet → receipt minted"
test -s .run/poteau/receipts.jsonl; ck $? 0 "receipt chain exists on disk"
jq -e '.gate_index==1 and .stop_blocks==0' .run/poteau/run-state.json >/dev/null; ck $? 0 "run state advanced (gate_index=1)"

echo "== P402: the law protecting the law =="
printf '%s' '{"tool_name":"Edit","tool_input":{"file_path":".claude/settings.poteau.json"}}' | bash poteau/hooks/tool-gate.sh 2>/dev/null; ck $? 2 "Edit on .claude/ denied (exit 2)"
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"echo x > poteau/manifest/poteau.manifest.json"}}' | bash poteau/hooks/tool-gate.sh 2>/dev/null; ck $? 2 "Bash redirect into manifest denied"
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"cat poteau/manifest/poteau.manifest.json"}}' | bash poteau/hooks/tool-gate.sh 2>/dev/null; ck $? 0 "reading the manifest allowed (narrow closed surface)"
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"app/feature.ts"}}' | bash poteau/hooks/tool-gate.sh 2>/dev/null; ck $? 0 "ordinary work allowed (wide open default)"
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":".run/poteau/run-7/packet.json"}}' | bash poteau/hooks/tool-gate.sh 2>/dev/null; ck $? 0 "T1 mailbox: packet.json write ALLOWED (the one judged slot)"
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":".run/poteau/run-7/run-state.json"}}' | bash poteau/hooks/tool-gate.sh 2>/dev/null; ck $? 2 "T1 mailbox: run-state.json write DENIED (P402 — constitutional)"
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":".run/poteau/run-7/receipts.jsonl"}}' | bash poteau/hooks/tool-gate.sh 2>/dev/null; ck $? 2 "T1 mailbox: receipts.jsonl write DENIED (P402 — the chain is not the agent's pen)"

echo "== Break-glass is sensed, never silent =="
POTEAU_BREAK_GLASS="operator: demo emergency" bash -c 'printf "%s" "{}" | bash poteau/hooks/exit-gate.sh' >/dev/null; ck $? 0 "break-glass releases the gate"
jq -e 'select(.event=="break_glass")' .run/poteau/incidents.jsonl >/dev/null; ck $? 0 "…and lands in incidents.jsonl (loudest signal)"


echo "== LAPLAS READY CHECK: quest + party + dungeon agree, or the ceremony does not start =="
node laplas/bin/laplas-ready.mjs laplas/test/fixtures/module-bad.json 2>/tmp/ready-bad.json; ck $? 2 "mismatched module refused at the door (exit 2)"
N=$(( $(grep -o 'P60[1-6]' /tmp/ready-bad.json | sort -u | wc -l) )); ck "$N" 6 "all six preparation failures named (P601-P606), each with the fix"  # R-5: $((…)) strips BSD wc padding (pt-fixture-portable-compare)
node laplas/bin/laplas-ready.mjs laplas/test/fixtures/module-good.json >/dev/null; ck $? 0 "complete module passes the ready check"
jq -e '.receipt.quest_hash and .receipt.party_hash and .receipt.dungeon_hash' .run/poteau/ready.json >/dev/null; ck $? 0 "ready receipt binds all three manifest hashes"

echo; echo "RESULT: $PASS passed, $FAIL failed"; [ $FAIL -eq 0 ]
