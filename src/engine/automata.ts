/* Automata execution + subset construction (NFA -> DFA) + minimization. */

import type { Dfa, DfaTransition, ExecutionResult, ExecutionStep, Nfa, RegexNode } from "./types";
import { parseRegex } from "./parser";
import { buildNfa } from "./thompson";

/* ---------------- epsilon closure ---------------- */

/** Build an adjacency map once, then compute epsilon-closures cheaply. */
export function buildEpsilonAdjacency(nfa: Nfa): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const s of nfa.states) map.set(s, []);
  for (const t of nfa.transitions) {
    if (t.symbol === null) map.get(t.from)!.push(t.to);
  }
  return map;
}

export function epsilonClosure(states: Iterable<number>, epsAdj: Map<number, number[]>): number[] {
  const seen = new Set<number>(states);
  const stack = [...seen];
  while (stack.length > 0) {
    const s = stack.pop()!;
    for (const next of epsAdj.get(s) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/* ---------------- symbol transitions ---------------- */

/** All states reachable from `from` on a concrete symbol. */
function move(nfa: Nfa, from: number[], symbol: string): number[] {
  const out = new Set<number>();
  for (const t of nfa.transitions) {
    if (t.symbol !== null && from.includes(t.from) && symbolMatches(t.symbol, symbol)) {
      out.add(t.to);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function symbolMatches(transitionSymbol: string, inputChar: string): boolean {
  return transitionSymbol === inputChar;
}

/* ---------------- execution ---------------- */

export function runNfa(nfa: Nfa, input: string): ExecutionResult {
  const epsAdj = buildEpsilonAdjacency(nfa);
  const steps: ExecutionStep[] = [];

  let current = epsilonClosure([nfa.initial], epsAdj);
  steps.push({ stepIndex: 0, char: null, charPosition: null, stateSet: [...current], isStart: true, canConsume: true });

  let stuck = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const moved = move(nfa, current, c);
    if (moved.length === 0) {
      stuck = true;
      steps.push({
        stepIndex: steps.length,
        char: c,
        charPosition: i,
        stateSet: [],
        isStart: false,
        canConsume: false,
      });
      break;
    }
    current = epsilonClosure(moved, epsAdj);
    steps.push({
      stepIndex: steps.length,
      char: c,
      charPosition: i,
      stateSet: [...current],
      isStart: false,
      canConsume: true,
    });
  }

  const accepted = !stuck && current.some((s) => nfa.accepting.has(s));
  const reason = stuck
    ? `Rejected at position ${steps[steps.length - 1].charPosition}: no transition consumes '${steps[steps.length - 1].char}'.`
    : accepted
      ? "Accepted: after consuming the last character the NFA sits in an accepting state."
      : "Rejected: after consuming the whole input no active state is accepting.";

  return { input, accepted, steps, reason };
}

/* ---------------- subset construction ---------------- */

export function nfaToDfa(nfa: Nfa): Dfa {
  const epsAdj = buildEpsilonAdjacency(nfa);
  // The relevant alphabet: symbols appearing on NFA transitions.
  const alphabet = [...new Set(nfa.transitions.filter((t) => t.symbol !== null).map((t) => t.symbol!))].sort();
  return assembleDfa(nfa, epsAdj, alphabet);
}

function assembleDfa(nfa: Nfa, epsAdj: Map<number, number[]>, alphabet: string[]): Dfa {
  const subsets = new Map<string, number[]>();
  const dfaStateOf = new Map<string, number>();
  const stateSubsets = new Map<number, number[]>();
  const transitions: DfaTransition[] = [];
  const states: number[] = [];
  const accepting = new Set<number>();
  let nextId = 0;

  const getKey = (subset: number[]): string => subset.join(",");

  const getOrCreate = (subset: number[]): number => {
    const key = getKey(subset);
    const existing = dfaStateOf.get(key);
    if (existing !== undefined) return existing;
    const id = nextId++;
    dfaStateOf.set(key, id);
    subsets.set(key, subset);
    stateSubsets.set(id, subset);
    states.push(id);
    if (subset.some((s) => nfa.accepting.has(s))) accepting.add(id);
    return id;
  };

  const startSubset = epsilonClosure([nfa.initial], epsAdj);
  const queue: number[][] = [startSubset];
  const visited = new Set<string>([getKey(startSubset)]);
  getOrCreate(startSubset);

  while (queue.length > 0) {
    const subset = queue.shift()!;
    const fromId = getOrCreate(subset);
    for (const symbol of alphabet) {
      const moved = move(nfa, subset, symbol);
      if (moved.length === 0) continue;
      const closure = epsilonClosure(moved, epsAdj);
      const key = getKey(closure);
      const toId = getOrCreate(closure);
      transitions.push({ from: fromId, to: toId, symbol });
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(closure);
      }
    }
  }

  states.sort((a, b) => a - b);
  transitions.sort((a, b) => a.from - b.from || a.symbol.localeCompare(b.symbol) || a.to - b.to);

  return {
    states,
    alphabet,
    transitions,
    initial: dfaStateOf.get(getKey(startSubset))!,
    accepting,
    stateSubsets,
  };
}

/* ---------------- DFA execution ---------------- */

export function runDfa(dfa: Dfa, input: string): ExecutionResult {
  const steps: ExecutionStep[] = [];
  let current = dfa.initial;
  steps.push({ stepIndex: 0, char: null, charPosition: null, stateSet: [current], isStart: true, canConsume: true });

  let stuck = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const t = dfa.transitions.find((t) => t.from === current && t.symbol === c);
    if (!t) {
      stuck = true;
      steps.push({ stepIndex: steps.length, char: c, charPosition: i, stateSet: [], isStart: false, canConsume: false });
      break;
    }
    current = t.to;
    steps.push({ stepIndex: steps.length, char: c, charPosition: i, stateSet: [current], isStart: false, canConsume: true });
  }

  const accepted = !stuck && dfa.accepting.has(current);
  const reason = stuck
    ? `Rejected at position ${steps[steps.length - 1].charPosition}: state ${current} has no transition for '${steps[steps.length - 1].char}'.`
    : accepted
      ? "Accepted: the DFA ended in an accepting state."
      : `Rejected: the DFA ended in non-accepting state ${current}.`;

  return { input, accepted, steps, reason };
}

/* ---------------- combined helpers ---------------- */

export type CompiledRegex = {
  pattern: string;
  ast: RegexNode;
  nfa: Nfa;
  dfa: Dfa;
};

export function compile(pattern: string): CompiledRegex {
  const ast = parseRegex(pattern);
  const nfa = buildNfa(ast);
  return { pattern, ast, nfa, dfa: nfaToDfa(nfa) };
}

/** Find all matches of the compiled NFA over a test string (leftmost, non-overlapping after greedy start). */
export function findAllMatches(nfa: Nfa, input: string): { start: number; end: number }[] {
  const epsAdj = buildEpsilonAdjacency(nfa);
  const matches: { start: number; end: number }[] = [];
  let i = 0;
  while (i <= input.length) {
    let best: number | null = null;
    let current = epsilonClosure([nfa.initial], epsAdj);
    for (let j = i; j < input.length; j++) {
      const moved = move(nfa, current, input[j]);
      if (moved.length === 0) break;
      current = epsilonClosure(moved, epsAdj);
      if (current.some((s) => nfa.accepting.has(s))) best = j + 1;
    }
    // empty-match check at this position
    if (best === null && current.some((s) => nfa.accepting.has(s)) && current.includes(nfa.initial)) {
      // avoid infinite loop on empty match
      i++;
      continue;
    }
    if (best === null) {
      i++;
      continue;
    }
    matches.push({ start: i, end: best });
    i = best;
  }
  return matches;
}
