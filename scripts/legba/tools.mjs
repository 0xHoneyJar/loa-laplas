/**
 * tools.mjs — the re-executable tool registry for Legba replay + fraud proofs.
 *
 * A re_executable move's output can be reproduced by ANY verifier, any time, by
 * re-running the named tool on the recorded input. These are the first registered
 * tools: pure, deterministic, eval-free (the same posture as gygax's augury
 * sweep + restricted arithmetic interpreter, the network's reference
 * re-executable family per the Legba SDD). No clock, no network, no randomness.
 *
 * To register a real tool (e.g. gygax's), add an entry: name → pure fn(input)→output.
 * A tool with nondeterministic inputs MUST be recorded `attestable`, never here.
 */

// Restricted arithmetic: a pure evaluator over {+,-,*,/,%, parens, numbers}.
// Hand-tokenized, recursive-descent, no eval/Function. Mirrors the gygax interpreter's
// guarantees so a recorded computation is replayable forever.
function arith(input) {
  const expr = String(input.expr ?? '');
  let i = 0;
  const peek = () => expr[i];
  const eat = (c) => { if (expr[i] === c) i++; else throw new Error(`expected ${c}`); };
  const skip = () => { while (expr[i] === ' ') i++; };
  function number() {
    skip(); let s = '';
    while (/[0-9.]/.test(expr[i] ?? '')) s += expr[i++];
    if (s === '') throw new Error('expected number');
    return parseFloat(s);
  }
  function factor() {
    skip();
    if (peek() === '(') { eat('('); const v = expression(); skip(); eat(')'); return v; }
    if (peek() === '-') { eat('-'); return -factor(); }
    return number();
  }
  function term() {
    let v = factor(); skip();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = expr[i++];
      const r = factor();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
      skip();
    }
    return v;
  }
  function expression() {
    let v = term(); skip();
    while (peek() === '+' || peek() === '-') {
      const op = expr[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
      skip();
    }
    return v;
  }
  const result = expression();
  skip();
  if (i < expr.length) throw new Error(`unexpected '${expr[i]}'`);
  return { result };
}

// Damage-per-round style parametric formula (gygax augury family reference).
function dpr(input) {
  const { hit = 0.65, dmg = 7, crit = 0.05, critMult = 2 } = input;
  return { dpr: Number((hit * dmg + crit * dmg * (critMult - 1)).toFixed(6)) };
}

export const REGISTRY = {
  arith,
  dpr,
};
