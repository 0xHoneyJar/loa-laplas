#!/usr/bin/env python3
"""compose-cost-card.py — emit-time cost ceiling for a Form C cut plan.

Intel-routing fix-plan #5 (2026-06-10 review, run intel-routing-20260610a):
the tier CHOICE binds at emit time, but the only cost feedback in the system
was dispatch-time, global, and unattributed — it could throttle the fleet but
never teach a composition author anything. This card puts the cost signal
where the decision is made.

Reads the compose-cut plan JSON on stdin, resolves each stage's model with
THE EMITTER'S OWN `_resolve_model` (imported from segment-emitter.py, so the
card can never drift from what is actually emitted), and prints a cost-card
JSON to stdout.

This is a CEILING ESTIMATE, not a bill:
  - per-call token envelope is a documented nominal assumption
    (LOA_COMPOSE_EST_IN_TOKENS / LOA_COMPOSE_EST_OUT_TOKENS to override)
  - iterating segments count max_iterations calls per stage (the cap IS the
    ceiling); sequential stages count 1 call
  - prices are a pinned snapshot of the hounfour SoT
    (.claude/defaults/model-config.yaml in the loa repo) in micro-USD per
    MTok; LOA_COMPOSE_PRICES_JSON overrides. If the SoT moves, update the
    snapshot — the card prints its price provenance so staleness is visible.

Usage: compose-cost-card.py < plan.json > card.json
Exit: 0 on success, 2 on bad input. Never blocks a dispatch — the card is
feedback, not a gate.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys

# Pinned price snapshot (micro-USD per MTok) — SoT: loa model-config.yaml
# pricing blocks (verified 2026-06-10: haiku $1/$5, sonnet $3/$15, opus $5/$25,
# fable $10/$50).
DEFAULT_PRICES_MICRO = {
    "haiku": {"in": 1_000_000, "out": 5_000_000},
    "sonnet": {"in": 3_000_000, "out": 15_000_000},
    "opus": {"in": 5_000_000, "out": 25_000_000},
    "fable": {"in": 10_000_000, "out": 50_000_000},
}
PRICE_PROVENANCE = "pinned-snapshot 2026-06-10 (SoT: loa .claude/defaults/model-config.yaml)"

# Nominal per-call token envelope. Deliberately round numbers an author can
# reason about; the card is for comparing tier choices, not invoicing.
DEFAULT_EST_IN = 120_000
DEFAULT_EST_OUT = 8_000

# The emitted withRetry wrapper calls agent() up to twice per stage invocation
# (one retry on transient failure / schema miss — segment-emitter.py). The
# CEILING must price the worst case (codex review P2 on PR #34).
RETRY_ATTEMPTS_PER_CALL = 2


def _load_resolver():
    """Import the SEGMENT-AWARE resolver from the sibling segment-emitter.py
    (hyphenated filename, hence importlib). _resolve_model_in_segment applies
    the relative gate floor (gate >= highest non-gate peer in its segment); the
    card passes the whole segment stage list — a superset of the work peers the
    emitter scopes the gate to — so the card prices a gate at >= the emitted
    model, preserving the CEILING property."""
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "segment-emitter.py")
    spec = importlib.util.spec_from_file_location("segment_emitter", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._resolve_model_in_segment


def build_cost_card(plan: dict) -> dict:
    resolve_model = _load_resolver()

    prices = dict(DEFAULT_PRICES_MICRO)
    override = os.environ.get("LOA_COMPOSE_PRICES_JSON", "").strip()
    price_source = PRICE_PROVENANCE
    if override:
        prices.update(json.loads(override))
        price_source = "LOA_COMPOSE_PRICES_JSON override"

    est_in = int(os.environ.get("LOA_COMPOSE_EST_IN_TOKENS", DEFAULT_EST_IN))
    est_out = int(os.environ.get("LOA_COMPOSE_EST_OUT_TOKENS", DEFAULT_EST_OUT))

    stages_out = []
    by_model: dict = {}
    ceiling = 0
    unpriced = []

    for seg in plan.get("segments", []):
        kind = seg.get("kind", "sequential")
        # Iterating segments: each stage runs up to max_iterations times — the
        # cap is the ceiling. Sequential stages run once.
        base_calls = int(seg.get("max_iterations") or 1) if kind == "iterating" else 1
        calls = base_calls * RETRY_ATTEMPTS_PER_CALL
        for st in seg.get("stages", []):
            model = resolve_model(st, seg.get("stages", []))
            p = prices.get(model)
            if p is None:
                unpriced.append(model)
                cost = 0
            else:
                per_call = (est_in * p["in"] + est_out * p["out"]) // 1_000_000
                cost = per_call * calls
            ceiling += cost
            stages_out.append({
                "segment": seg.get("segment_name", f"segment-{seg.get('index')}"),
                "stage": st.get("stage"),
                "construct": st.get("construct"),
                "role": st.get("role"),
                "intelligence_tier": st.get("intelligence_tier"),
                "model": model,
                "calls_ceiling": calls,
                "est_cost_micro_usd": cost,
            })
            m = by_model.setdefault(model, {"calls": 0, "est_cost_micro_usd": 0})
            m["calls"] += calls
            m["est_cost_micro_usd"] += cost

    card = {
        "kind": "compose_cost_card",
        "assumptions": {
            "est_in_tokens_per_call": est_in,
            "est_out_tokens_per_call": est_out,
            "retry_attempts_per_call": RETRY_ATTEMPTS_PER_CALL,
            "price_source": price_source,
            "note": "ceiling estimate for tier-choice feedback, not a bill",
            "note_dag": "args.items fan-out (RFC #35) multiplies work-stage calls at runtime; this ceiling assumes the single-context path",
        },
        "stages": stages_out,
        "by_model": by_model,
        "ceiling_micro_usd": ceiling,
        "ceiling_usd": round(ceiling / 1_000_000, 4),
    }
    if unpriced:
        # An unpriced alias is the exact blind spot the review flagged — say so
        # loudly instead of folding it into the total as $0.
        card["unpriced_models"] = sorted(set(unpriced))
        card["warning"] = (
            "ceiling UNDERSTATES: no price for "
            + ", ".join(sorted(set(unpriced)))
            + " — update the snapshot or LOA_COMPOSE_PRICES_JSON"
        )
    return card


def main() -> int:
    try:
        plan = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"compose-cost-card: bad plan JSON: {e}", file=sys.stderr)
        return 2
    print(json.dumps(build_cost_card(plan), separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
