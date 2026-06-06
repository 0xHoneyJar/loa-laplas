#!/usr/bin/env python3
"""
segment-emitter.py — Form C: emit a Claude Code dynamic-workflow (.workflow.js)
for ONE autonomous composition segment (cycle-053).

Form C is the primitive Form A/B were faking: a programmatic subagent spawn WITH
/workflows visibility. compose-dispatch.sh is the COMPILER (validate -> cut ->
emit); the Claude Code main loop is the EXECUTOR (runs each emitted segment via
the Workflow tool, then runs the seam protocol). This module renders one segment.

RUNTIME SHAPE (verified against the live Workflow tool, NOT the design-package
draft's `export default async function(inputs)`):

    export const meta = { ... };          // pure literal — no computed values
    <const declarations>                  // schemas, guards, baked room packets
    <top-level async body>                // uses the `args` global + top-level await
    return { outcome, ..., seam };         // the segment handoff payload

FLATLINE-HARDENING baked into every emit (build-spec; loa-constructs flatline review;
cycle-053 adversarial review):
  * INJECTION (CRITICAL): EVERY composition value enters the emitted source ONLY
    through js() — json.dumps (ensure_ascii, all metacharacters escaped) — INCLUDING
    the doc-comment provenance (now static; composition values live only in the
    js()-escaped meta literal), max_iterations (int-coerced then js()'d), and the
    clew_example marker (assembled in Python, then js()'d). There is no bare
    f-string interpolation of a composition value into emitted JS anywhere.
  * DETERMINISM: js() also \\uXXXX-escapes the leading byte of any "Date" /
    "Math.random" token so a composition that merely MENTIONS those words in prose
    cannot make the emitted SOURCE TEXT contain the token (the runtime greps source
    text and aborts). The runtime string VALUE is unchanged (\\u0044ate === "Date").
    Timestamps/run-ids are baked literals by the bash compiler.
  * FAILURE != EMPTY: a thrown stage -> typed sentinel {__stage_failed:true,...};
    `agent()->null` (operator-skip) is distinct. A StructuredOutput MISS (a returned
    but schema-incomplete payload) is validated against the stage's required keys,
    retried once, then degraded — never propagated as a clean result.
  * SYNC-THROW SAFETY: every stage body (and every boundedParallel thunk) is wrapped
    in safe(); a sync throw in a parallel() thunk otherwise crashes the whole run.
  * RATE LIMITS (~11): boundedParallel chunks fan-out; the iterating loop is
    sequential by construction (does not rely on the unproven pipeline() no-barrier).

CLI:
  segment-emitter.py --segment <plan.json|-> --composition <comp.json> \\
      --room-packets <map.json> --cycle-id ID --run-id ID --authored-at ISO
"""
import argparse
import json
import re
import sys

# Determinism guard: \\uXXXX-escape the leading char of any Date / Math.random
# token in emitted source text. The runtime greps SOURCE for these and aborts;
# the escaped form keeps the same string VALUE but the source bytes no longer
# contain the literal token. ensure_ascii alone does NOT help (bytes still read
# "Date") — this is the actual mitigation.
_DET_RE = re.compile(r"Date|Math\s*\.\s*random")


def _det_escape(s):
    return _DET_RE.sub(lambda m: ("\\u%04x" % ord(m.group(0)[0])) + m.group(0)[1:], s)


def js(value):
    """Render a Python value as an embeddable JS literal — the single injection +
    determinism guard. json.dumps(ensure_ascii) escapes every quote/newline/control
    char (injection); _det_escape neutralizes Date/Math.random in source (determinism)."""
    return _det_escape(json.dumps(value, ensure_ascii=True))


def _coerce_cap(value, default=3):
    """max_iterations MUST become a JS integer literal — never a raw-interpolated
    string (that was an injection vector). Coerce; fall back to default."""
    try:
        n = int(value)
        return n if n >= 1 else default
    except (TypeError, ValueError):
        return default


# Stream-type -> per-stage StructuredOutput schema. The gate (Verdict-writing
# craft-gate) converges on verdict=="APPROVED".
WORK_SCHEMA = {
    "type": "object",
    "required": ["output", "rationale"],
    "additionalProperties": False,
    "properties": {
        "output": {"type": "string", "description": "the produced artifact (e.g. a unified diff)"},
        "rationale": {"type": "string", "description": "one paragraph: what was produced and why"},
        "rejected_findings": {
            "type": "array",
            "items": {"type": "string"},
            "description": "iteration 2+: prior gate findings declined, each with a reason",
        },
    },
}
WORK_REQUIRED = ["output", "rationale"]

GATE_SCHEMA = {
    "type": "object",
    "required": ["verdict", "findings"],
    "additionalProperties": False,
    "properties": {
        "verdict": {"type": "string", "enum": ["APPROVED", "CHANGES_REQUIRED"]},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["severity", "anchor", "issue", "fix"],
                "additionalProperties": False,
                "properties": {
                    "severity": {"type": "string", "enum": ["CRITICAL", "MAJOR", "MINOR"]},
                    "anchor": {"type": "string", "description": "text anchor (survives diff shifts), not a line number"},
                    "issue": {"type": "string"},
                    "fix": {"type": "string", "description": "executable fix the work stage can apply"},
                },
            },
        },
        "note": {"type": "string"},
    },
}
GATE_REQUIRED = ["verdict", "findings"]


def _agent_type(slug):
    return f"construct-{slug}"


# model tiers — opts.model accepts only haiku|sonnet|opus (the Workflow agent() contract).
_TIER_TO_MODEL = {"cheap": "haiku", "standard": "sonnet", "deep": "opus"}


def _resolve_model(stage, is_gate=False):
    """Per-segment model routing — the consumption-gradient fix. BEFORE this, the emitted agent()
    calls carried NO model key, so every subagent inherited the parent (Opus): a blanket-Opus fan-out,
    exactly the overuse the cc-usage cost model named. Rule: gates run on opus (adversarial review needs
    the strongest reader — never haiku); work stages default to sonnet (explore/read/scan → haiku); an
    explicit stage `intelligence_tier` (cheap|standard|deep) overrides, with a gate-never-haiku floor.
    Returns one of haiku|sonnet|opus."""
    tier = stage.get("intelligence_tier")
    if tier is not None:
        model = _TIER_TO_MODEL.get(tier)
        if model is None:
            sys.stderr.write(
                f"[segment-emitter] warning: invalid intelligence_tier {tier!r} "
                f"(expected cheap|standard|deep); using role default\n"
            )
        elif is_gate and model == "haiku":
            return "sonnet"  # gate-never-haiku floor
        else:
            return model
    if is_gate:
        return "opus"
    role = ((stage.get("role") or "") + " " + (stage.get("skill") or "")).lower()
    if any(k in role for k in ("explore", "read", "research", "scan", "browse")):
        return "haiku"
    return "sonnet"


def _persona_clause(persona):
    return f"You are {persona}. " if persona else ""


def _room_var(stage_num):
    return f"ROOM_PACKET_S{str(stage_num).replace('.', '_')}"


def emit_preamble():
    """Shared guards: sentinel, schema-conformance check, retry-with-degrade,
    bounded fan-out. Determinism-clean. (E/G/H fixes baked in.)"""
    return """\
// --- flatline guards ---
// sync-throw safety: a thrown stage becomes a typed sentinel, never a bare null.
const safe = async (stageName, fn) => {
  try { return await fn(); }
  catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    log("stage " + stageName + " threw: " + msg);
    return { __stage_failed: true, stage: stageName, error: msg };
  }
};
const isFailed = (r) => !!(r && r.__stage_failed === true);
// schema-conformance: a returned-but-incomplete StructuredOutput payload is NOT a
// valid result. required = the stage schema's required keys.
const conforms = (r, required) =>
  r && typeof r === "object" && !r.__stage_failed && required.every((k) => r[k] !== undefined);
// withRetry: try -> (on throw OR schema-miss) retry once -> then degrade via a
// typed sentinel. NEVER fabricate. null is reserved for a clean operator-skip;
// a transient throw that then returns null is surfaced as a distinct sentinel
// (not mislabelled operator-skip).
const withRetry = async (stageName, required, fn) => {
  const r = await safe(stageName, fn);
  if (r === null) return null;                       // clean operator-skip
  if (!isFailed(r) && conforms(r, required)) return r;
  const r2 = await safe(stageName, fn);              // one retry
  if (r2 === null) return { __stage_failed: true, stage: stageName, error: "transient-then-empty" };
  if (isFailed(r2)) return r2;
  if (!conforms(r2, required)) return { __stage_failed: true, stage: stageName, error: "structured-output-miss" };
  return r2;
};
// bounded fan-out: the real ceiling is rate limits (~11 concurrent). Chunk so a
// wide segment never loses agents. Each thunk is safe()-wrapped (a sync throw in
// a parallel() thunk would otherwise crash the whole run). The iterating loop
// below is sequential and does not use this — kept for fan-out segments.
const RATE_BOUND = 8;
const boundedParallel = async (thunks) => {
  const out = [];
  for (let i = 0; i < thunks.length; i += RATE_BOUND) {
    const chunk = thunks.slice(i, i + RATE_BOUND);
    const settled = await parallel(chunk.map((t, j) => () => safe("parallel-" + (i + j), t)));
    for (const r of settled) out.push(r);
  }
  return out;
};
"""


def emit_meta(comp, seg, cycle_id, run_id, authored_at, cap):
    stages = seg["stages"]
    constructs = [s["construct"] for s in stages]
    agent_types = [_agent_type(s["construct"]) for s in stages]
    phases = []
    for s in stages:
        title = (s.get("name") or s["construct"]).strip() or s["construct"]
        phases.append({"title": title, "detail": (s.get("notes") or "").strip()[:160]})
    meta = {
        "name": seg["segment_name"],
        "description": (comp.get("description") or seg["segment_name"]).strip()[:300],
        "phases": phases,
        "metadata": {
            "source_composition": comp.get("name"),
            "segment_index": seg["index"],
            "kind": seg["kind"],
            "iterate": seg.get("iterate"),
            "max_iterations": cap if seg["kind"] == "iterating" else None,
            "terminate_when": (seg.get("terminate_when") if seg["kind"] == "iterating" else None),
            "ends_at_seam": seg.get("ends_at_seam", False),
            "constructs": constructs,
            "agent_types": agent_types,
            "cycle_id": cycle_id,
            "composition_run_id": run_id,
            "authored_at": authored_at,
            "emitted_by": "segment-emitter.py (cycle-053 Form C)",
        },
    }
    # _det_escape the whole meta literal: composition-derived strings (description,
    # phase detail from notes, name) may mention Date/Math.random in prose.
    return "export const meta = " + _det_escape(json.dumps(meta, ensure_ascii=True, indent=2)) + ";\n"


def emit_schemas():
    return (
        "const WORK_SCHEMA = " + js(WORK_SCHEMA) + ";\n"
        "const WORK_REQUIRED = " + js(WORK_REQUIRED) + ";\n"
        "const GATE_SCHEMA = " + js(GATE_SCHEMA) + ";\n"
        "const GATE_REQUIRED = " + js(GATE_REQUIRED) + ";\n"
    )


def emit_room_packets(seg, room_packets):
    """Bake each stage's room-activation packet as a JS literal (via js() — escaped).
    The emitted workflow cannot read the filesystem, so the packet content is
    embedded and handed to the agent in-prompt — this gives ROOM AUTHORITY
    (invocation_mode:room) instead of studio_synthesis (FINDINGS #2b)."""
    lines = []
    for s in seg["stages"]:
        packet = room_packets.get(str(s["stage"]), {})
        lines.append(f"const {_room_var(s['stage'])} = {js(packet)};")
    return ("\n".join(lines) + "\n") if lines else ""


def _handoff_seed_literal(stage, payload_var):
    """JS object literal: the per-stage construct-handoff SEED the runner wraps +
    validates. All composition values via js(); the payload var is a runtime value."""
    writes = stage.get("writes") or []
    output_type = writes[0] if writes else "Verdict"
    return (
        "{ construct_slug: " + js(stage["construct"])
        + ", persona: " + js(stage.get("persona"))
        + ", output_type: " + js(output_type)
        + ", invocation_mode: " + js("room")
        + ", stage_index: " + js(stage["stage"])
        + ", verdict: " + payload_var + " }"
    )


def _work_stage_js(st, var_suffix, prior_context_js, schema="WORK_SCHEMA", required="WORK_REQUIRED"):
    """Emit one work/preamble stage call. prior_context_js is a JS expression
    (string) appended to the prompt array, or '' for none. All literals via js()."""
    rv = _room_var(st["stage"])
    head = (
        _persona_clause(st.get("persona"))
        + f"You are the work stage (construct: {st['construct']}"
        + (f", skill: {st['skill']}" if st.get("skill") else "")
        + f", role: {st.get('role')}). Operate in ROOM AUTHORITY (room mode, not studio) per your room-activation packet below."
    )
    var = f"workOut_{var_suffix}"
    prompt_var = f"workPrompt_{var_suffix}"
    extra = f"\n      {prior_context_js}," if prior_context_js else ""
    return var, f"""    phase({js((st.get('name') or st['construct']))});
    const {prompt_var} = [
      {js(head)},
      "ROOM ACTIVATION PACKET (establishes room authority — invocation_mode:room):",
      JSON.stringify({rv}),
      "TASK: " + JSON.stringify(task),
      "SCOPE: " + JSON.stringify(scope),{extra}
      "Return the structured output per the WORK schema (output + rationale)."
    ].filter(Boolean).join("\\n");
    const {var} = await withRetry({js(st['construct'])}, {required}, () => agent({prompt_var}, {{ label: {js(st['construct'])} + ":iter-" + iteration, phase: {js((st.get('name') or st['construct']))}, agentType: {js(_agent_type(st['construct']))}, model: {js(_resolve_model(st))}, schema: {schema} }}));"""


def emit_iterating_body(comp, seg, cycle_id, run_id):
    """Bounded implement<->gate loop. Respects the iterate pair [a,b]: stages BEFORE
    `a` are a once-only PREAMBLE (emitted before the while loop); only [a,b] iterate;
    the gate is `b`. Converge on the gate verdict APPROVED; cap_reached, degraded
    and converged are DISTINCT outcomes (never folded)."""
    stages = seg["stages"]
    pair = seg.get("iterate") or []
    lo = pair[0] if len(pair) == 2 else stages[0]["stage"]
    preamble_stages = [s for s in stages if float(s["stage"]) < float(lo)]
    loop_stages = [s for s in stages if float(s["stage"]) >= float(lo)]
    if not loop_stages:  # defensive — should not happen for an iterating segment
        loop_stages = stages
        preamble_stages = []
    work_stages = loop_stages[:-1]
    gate = loop_stages[-1]
    cap = _coerce_cap(seg.get("max_iterations"))

    # clew marker assembled in Python, then js()'d (C fix — never raw-interpolated).
    clew_marker = (
        ">>clew@" + gate["construct"]
        + ("/" + gate["skill"] if gate.get("skill") else "")
        + ": the gate kept missing <X> class of defect — tighten the inspection prompt"
    )

    # --- preamble stages: emit ONCE, before the loop ---
    preamble_blocks = []
    for idx, st in enumerate(preamble_stages):
        var, block = _work_stage_js(
            st, f"pre_{idx}",
            f'(preambleOut.length ? "PRIOR PREAMBLE OUTPUT:\\n" + JSON.stringify(preambleOut) : "")',
        )
        # NOTE: preamble runs at iteration 0 (before the loop sets iteration). Use a
        # local marker so the prompt label/iteration is sane.
        block = block.replace('":iter-" + iteration', '":preamble"')
        preamble_blocks.append(
            block
            + f"""
    if ({var} === null) return preambleSkip({js(st['construct'])});
    if (isFailed({var})) return preambleDegraded({var});
    preambleOut.push({var});
    handoffSeeds.push({_handoff_seed_literal(st, var)});"""
        )
    preamble_section = "\n".join(preamble_blocks)
    preamble_decl = "const preambleOut = [];" if preamble_stages else ""
    preamble_ctx = (
        '(preambleOut.length ? "PREAMBLE CONTEXT (produced once, before the loop):\\n" + JSON.stringify(preambleOut) : "")'
        if preamble_stages else ""
    )

    # --- loop work stages ---
    work_blocks = []
    for idx, st in enumerate(work_stages):
        prior = '(iteration > 1 ? "PRIOR OUTPUT (you are iterating — improve on this):\\n" + JSON.stringify(workState) : "")'
        verdict_ctx = "(iteration > 1 && lastVerdict ? \"GATE VERDICT — apply every finding fix; you MAY decline a finding with a written reason:\\n\" + JSON.stringify(lastVerdict) : \"\")"
        rv = _room_var(st["stage"])
        head = (
            _persona_clause(st.get("persona"))
            + f"You are the work stage (construct: {st['construct']}"
            + (f", skill: {st['skill']}" if st.get("skill") else "")
            + f", role: {st.get('role')}). Operate in ROOM AUTHORITY (room mode, not studio) per your room-activation packet below."
        )
        ctx_lines = [prior, verdict_ctx]
        if preamble_ctx:
            ctx_lines.insert(0, preamble_ctx)
        ctx_js = ",\n      ".join(ctx_lines)
        work_blocks.append(
            f"""    phase({js((st.get('name') or st['construct']))});
    const workPrompt_{idx} = [
      {js(head)},
      "ROOM ACTIVATION PACKET (establishes room authority — invocation_mode:room):",
      JSON.stringify({rv}),
      "TASK: " + JSON.stringify(task),
      "SCOPE: " + JSON.stringify(scope),
      {ctx_js},
      "Return the structured output per the WORK schema (output + rationale [+ rejected_findings on iteration 2+])."
    ].filter(Boolean).join("\\n");
    const workOut_{idx} = await withRetry({js(st['construct'])}, WORK_REQUIRED, () => agent(workPrompt_{idx}, {{ label: {js(st['construct'])} + ":iter-" + iteration, phase: {js((st.get('name') or st['construct']))}, agentType: {js(_agent_type(st['construct']))}, model: {js(_resolve_model(st))}, schema: WORK_SCHEMA }}));
    if (workOut_{idx} === null) {{ degraded = {{ reason: "operator-skip", stage: {js(st['construct'])}, iteration: iteration }}; break; }}
    if (isFailed(workOut_{idx})) {{ degraded = {{ reason: workOut_{idx}.error || "stage-failed", detail: workOut_{idx}, iteration: iteration }}; break; }}
    workState = workOut_{idx};
    handoffSeeds.push({_handoff_seed_literal(st, f'workOut_{idx}')});"""
        )
    work_block = "\n".join(work_blocks)

    grv = _room_var(gate["stage"])
    gate_head = (
        _persona_clause(gate.get("persona"))
        + f"You are the craft-gate reviewer (construct: {gate['construct']}"
        + (f", skill: {gate['skill']}" if gate.get("skill") else "")
        + "). Operate in ROOM AUTHORITY (room mode, not studio) per your room-activation packet below. Run an adversarial review of the work output."
    )

    return f"""\
// --- inputs (the `args` global; main loop passes them at invocation) ---
const input = (args && typeof args === "object") ? args : {{}};
const task = input.task || {js(comp.get('intent') or 'No task provided — pass { task, scope } as args.')};
const scope = input.scope || "unscoped — the work stage infers the minimal blast radius";

const MAX_ITER = {js(cap)};
let workState = null;          // mode:persistent carry across iterations
let lastVerdict = null;        // last gate verdict, fed into the next work pass
const ledger = [];             // every gate verdict + findings, kept for the seam
const handoffSeeds = [];       // per-stage construct-handoff seeds for the runner to wrap+validate
{preamble_decl}
let iteration = 0;
let degraded = null;

// terminate_when (composition predicate): Form C interprets it as "gate verdict
// === APPROVED" (the autonomous, machine-checkable reduction). The original prose
// is preserved in meta.metadata.terminate_when for operator legibility.
const preambleSkip = (s) => ({{ outcome: "degraded", converged: false,
  degraded: {{ reason: "operator-skip", stage: s, iteration: 0 }}, handoff_seeds: handoffSeeds,
  seam: {{ kind: "operator_gate", clew_capable: true, surface: "preamble stage " + s + " skipped — operator decides", options: ["retry-segment", "abort"] }} }});
const preambleDegraded = (r) => ({{ outcome: "degraded", converged: false,
  degraded: {{ reason: (r && r.error) || "stage-failed", detail: r, iteration: 0 }}, handoff_seeds: handoffSeeds,
  seam: {{ kind: "operator_gate", clew_capable: true, surface: "preamble stage failed — operator decides", options: ["retry-segment", "abort"] }} }});

{preamble_section}

while (iteration < MAX_ITER) {{
  iteration += 1;

{work_block}

  if (degraded) break;

  phase({js((gate.get('name') or gate['construct']))});
  const gatePrompt = [
    {js(gate_head)},
    "ROOM ACTIVATION PACKET (establishes room authority — invocation_mode:room):",
    JSON.stringify({grv}),
    {(preamble_ctx + ",") if preamble_ctx else ""}
    "WORK OUTPUT under review:\\n" + JSON.stringify(workState),
    (iteration >= 2 ? "This is a RE-REVIEW. Accept reasonable declines (the work stage's context is fuller than your scoped view); raise only NEW material defects. If you keep surfacing net-new issues every pass, say so in note (signals prompt drift)." : "First pass: full adversarial scan. Anchor every finding to text (not a line number) and supply an executable fix."),
    "Return APPROVED | CHANGES_REQUIRED + findings per the GATE schema."
  ].filter(Boolean).join("\\n");
  const gateOut = await withRetry({js(gate['construct'])}, GATE_REQUIRED, () => agent(gatePrompt, {{ label: {js(gate['construct'])} + ":iter-" + iteration, phase: {js((gate.get('name') or gate['construct']))}, agentType: {js(_agent_type(gate['construct']))}, model: {js(_resolve_model(gate, is_gate=True))}, schema: GATE_SCHEMA }}));
  if (gateOut === null) {{ degraded = {{ reason: "operator-skip", stage: {js(gate['construct'])}, iteration: iteration }}; break; }}
  if (isFailed(gateOut)) {{ degraded = {{ reason: gateOut.error || "stage-failed", detail: gateOut, iteration: iteration }}; break; }}
  ledger.push({{ iteration: iteration, verdict: gateOut.verdict, findings: gateOut.findings || [], note: gateOut.note || null }});
  handoffSeeds.push({_handoff_seed_literal(gate, 'gateOut')});
  lastVerdict = gateOut;

  if (gateOut.verdict === "APPROVED") {{
    log("converged on merit at iteration " + iteration);
    return {{
      outcome: "converged", converged: true, iterations: iteration,
      result: workState, ledger: ledger, handoff_seeds: handoffSeeds,
      context_carry: {{ workState: workState, lastVerdict: lastVerdict{", preambleOut: preambleOut" if preamble_stages else ""} }},
      seam: {{ kind: "confirm", clew_capable: true,
        surface: "reviewed output + clean approval at iteration " + iteration }}
    }};
  }}
  log("iteration " + iteration + ": CHANGES_REQUIRED (" + ((gateOut.findings || []).length) + " findings) — looping");
}}

if (degraded) {{
  // StructuredOutput miss / operator-skip / stage failure: surface a DEGRADED
  // verdict. Never fabricate convergence.
  log("segment degraded: " + degraded.reason);
  return {{
    outcome: "degraded", converged: false, degraded: degraded, iterations: iteration,
    result: workState, ledger: ledger, handoff_seeds: handoffSeeds,
    context_carry: {{ workState: workState, lastVerdict: lastVerdict }},
    seam: {{ kind: "operator_gate", clew_capable: true,
      surface: "segment could not produce a trusted handoff (" + degraded.reason + ") — operator decides",
      options: ["retry-segment", "accept-partial", "abort"] }}
  }};
}}

// Cap reached WITHOUT a merit APPROVED. Spec: surface auto_approved_at_cap; NEVER
// treat as a clean approval (cap_reached is a distinct outcome from converged).
log("iteration cap (" + MAX_ITER + ") reached without merit convergence — escalating to the operator seam");
return {{
  outcome: "cap_reached", converged: false, auto_approved_at_cap: true, iterations: iteration,
  result: workState, ledger: ledger, handoff_seeds: handoffSeeds,
  context_carry: {{ workState: workState, lastVerdict: lastVerdict }},
  seam: {{ kind: "operator_gate", clew_capable: true,
    surface: "non-converged output + full findings ledger; the gate did not approve on merit within cap",
    options: ["accept-as-is", "one-more-iteration", "hand-back-to-work-stage"],
    clew_example: {js(clew_marker)} }}
}};
"""


def emit_sequential_body(comp, seg, cycle_id, run_id):
    """A straight sequence of agent() stages (no gate, no loop). Each runs in room
    authority; outputs thread forward; returns the last output + handoff seeds."""
    stages = seg["stages"]
    blocks = []
    for idx, st in enumerate(stages):
        rv = _room_var(st["stage"])
        head = (
            _persona_clause(st.get("persona"))
            + f"You are construct {st['construct']}"
            + (f" running skill {st['skill']}" if st.get("skill") else "")
            + f" (role: {st.get('role')}). Operate in ROOM AUTHORITY (room mode, not studio) per your room-activation packet below."
        )
        prior = "" if idx == 0 else '      "PRIOR STAGE OUTPUT:\\n" + JSON.stringify(prior),'
        blocks.append(
            f"""  phase({js((st.get('name') or st['construct']))});
  {{
    const p = [
      {js(head)},
      "ROOM ACTIVATION PACKET (establishes room authority — invocation_mode:room):",
      JSON.stringify({rv}),
      "TASK: " + JSON.stringify(task),
{prior}
      "Return the structured output per the WORK schema."
    ].filter(Boolean).join("\\n");
    const out = await withRetry({js(st['construct'])}, WORK_REQUIRED, () => agent(p, {{ label: {js(st['construct'])}, phase: {js((st.get('name') or st['construct']))}, agentType: {js(_agent_type(st['construct']))}, model: {js(_resolve_model(st))}, schema: WORK_SCHEMA }}));
    if (out === null) {{ degraded = {{ reason: "operator-skip", stage: {js(st['construct'])} }}; }}
    else if (isFailed(out)) {{ degraded = {{ reason: out.error || "stage-failed", detail: out }}; }}
    else {{ prior = out; outputs.push(out); handoffSeeds.push({_handoff_seed_literal(st, 'out')}); }}
  }}
  if (degraded) {{
    return {{ outcome: "degraded", converged: false, degraded: degraded, outputs: outputs,
      handoff_seeds: handoffSeeds, context_carry: {{ prior: prior }},
      seam: {{ kind: "operator_gate", clew_capable: true, surface: "sequential segment degraded (" + degraded.reason + ")", options: ["retry-segment", "abort"] }} }};
  }}"""
        )
    body = "\n".join(blocks)
    return f"""\
const input = (args && typeof args === "object") ? args : {{}};
const task = input.task || {js(comp.get('intent') or 'No task provided.')};
let prior = input.prior || null;
const outputs = [];
const handoffSeeds = [];
let iteration = 1;
let degraded = null;

{body}

return {{
  outcome: "complete", converged: true, outputs: outputs, handoff_seeds: handoffSeeds,
  context_carry: {{ prior: prior }},
  seam: {{ kind: "confirm", clew_capable: {js(bool(seg.get('ends_at_seam')))}, surface: "sequential segment complete" }}
}};
"""


def emit(comp, seg, room_packets, cycle_id, run_id, authored_at):
    cap = _coerce_cap(seg.get("max_iterations"))
    # Leading doc-comment is STATIC — NO composition value is interpolated into the
    # /* */ block (a name like `x */ code; /*` would otherwise break out). All
    # composition-derived provenance lives in the js()-escaped meta literal.
    header = (
        "/**\n"
        " * Form C autonomous segment (cycle-053). Emitted by segment-emitter.py.\n"
        " * Runs via the Claude Code Workflow tool; the main loop runs the seam\n"
        " * protocol around it. Determinism-clean; every composition value is a\n"
        " * json-escaped, determinism-escaped literal (injection guard). Provenance\n"
        " * (source composition, segment index, constructs) is in meta.metadata.\n"
        " */"
    )
    parts = [
        header,
        emit_meta(comp, seg, cycle_id, run_id, authored_at, cap),
        emit_schemas(),
        emit_room_packets(seg, room_packets),
        emit_preamble(),
    ]
    if seg["kind"] == "iterating":
        parts.append(emit_iterating_body(comp, seg, cycle_id, run_id))
    else:
        parts.append(emit_sequential_body(comp, seg, cycle_id, run_id))
    return "\n".join(parts)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Form C segment emitter")
    ap.add_argument("--segment", required=True, help="segment plan JSON path or '-'")
    ap.add_argument("--composition", required=True, help="composition JSON path")
    ap.add_argument("--room-packets", default="", help="JSON map {stage: packet}")
    ap.add_argument("--cycle-id", default="cycle-053")
    ap.add_argument("--run-id", default="unknown-run")
    ap.add_argument("--authored-at", default="", help="ISO timestamp baked as literal")
    args = ap.parse_args(argv)

    seg_raw = sys.stdin.read() if args.segment == "-" else open(args.segment).read()
    seg = json.loads(seg_raw)
    comp = json.loads(open(args.composition).read())
    room_packets = json.loads(args.room_packets) if args.room_packets else {}

    sys.stdout.write(emit(comp, seg, room_packets, args.cycle_id, args.run_id, args.authored_at))
    return 0


if __name__ == "__main__":
    sys.exit(main())
