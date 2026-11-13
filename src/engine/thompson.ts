/* Thompson's construction: AST -> NFA with epsilon transitions.
 *
 * Each fragment has exactly one start state and one accept state.
 * State count grows linearly with pattern size.
 */

import type { ClassMember, Nfa, NfaTransition, RegexNode } from "./types";
import { classMemberMatches } from "./parser";

type Fragment = {
  start: number;
  accept: number;
};

type Builder = {
  transitions: NfaTransition[];
  alphabet: Set<string>;
  nextId: number;
};

function newState(b: Builder): number {
  return b.nextId++;
}

function addTransition(b: Builder, from: number, to: number, symbol: string | null): void {
  b.transitions.push({ from, to, symbol });
  if (symbol !== null) b.alphabet.add(symbol);
}

/** Human-readable label for a symbol the automaton reads. */
export function symbolLabel(symbol: string | null): string {
  if (symbol === null) return "ε";
  return symbol === "\n" ? "\\n" : symbol === "\t" ? "\\t" : symbol === "\r" ? "\\r" : symbol === "\0" ? "\\0" : symbol;
}

function classMatchesChar(negated: boolean, members: ClassMember[], c: string): boolean {
  if (!negated) {
    return members.some((m) => classMemberMatches(m, c));
  }
  return !members.some((m) => classMemberMatches(m, c));
}

function charClassNodeMatches(node: Extract<RegexNode, { type: "CharClass" }>, c: string): boolean {
  return classMatchesChar(node.negated, node.members, c);
}

function classLabel(negated: boolean, members: ClassMember[]): string {
  const body = members
    .map((m) => {
      switch (m.kind) {
        case "char":
          return escapeForClass(m.char);
        case "range":
          return `${escapeForClass(m.from)}-${escapeForClass(m.to)}`;
        case "class":
          return classLabel(m.negated, m.members);
      }
    })
    .join("");
  return `[${negated ? "^" : ""}${body}]`;
}

function escapeForClass(c: string): string {
  if (c === "\n") return "\\n";
  if (c === "\t") return "\\t";
  if (c === "\r") return "\\r";
  if (c === "\0") return "\\0";
  return c;
}

function build(node: RegexNode, b: Builder): Fragment {
  switch (node.type) {
    case "Empty": {
      const s = newState(b);
      const a = newState(b);
      addTransition(b, s, a, null);
      return { start: s, accept: a };
    }

    case "Char": {
      const s = newState(b);
      const a = newState(b);
      addTransition(b, s, a, node.char);
      return { start: s, accept: a };
    }

    case "AnyChar": {
      const s = newState(b);
      const a = newState(b);
      // dot is modeled as the printable-ASCII alphabet minus newline;
      // expand to a bounded set so the DFA stays finite
      const alphabet = printableAlphabet();
      for (const c of alphabet) {
        if (c !== "\n") addTransition(b, s, a, c);
      }
      return { start: s, accept: a };
    }

    case "CharClass": {
      const s = newState(b);
      const a = newState(b);
      const alphabet = printableAlphabet();
      for (const c of alphabet) {
        if (charClassNodeMatches(node, c)) {
          addTransition(b, s, a, c);
        }
      }
      return { start: s, accept: a };
    }

    case "Concat": {
      let acc = build(node.parts[0], b);
      for (let i = 1; i < node.parts.length; i++) {
        const next = build(node.parts[i], b);
        addTransition(b, acc.accept, next.start, null);
        acc = { start: acc.start, accept: next.accept };
      }
      return acc;
    }

    case "Alternation": {
      const s = newState(b);
      const a = newState(b);
      for (const branch of node.branches) {
        const f = build(branch, b);
        addTransition(b, s, f.start, null);
        addTransition(b, f.accept, a, null);
      }
      return { start: s, accept: a };
    }

    case "Star": {
      const inner = build(node.node, b);
      const s = newState(b);
      const a = newState(b);
      addTransition(b, s, inner.start, null);
      addTransition(b, s, a, null); // zero repetitions
      addTransition(b, inner.accept, a, null);
      addTransition(b, inner.accept, inner.start, null); // loop back
      return { start: s, accept: a };
    }

    case "Plus": {
      const inner = build(node.node, b);
      const s = newState(b);
      const a = newState(b);
      addTransition(b, s, inner.start, null);
      addTransition(b, inner.accept, a, null);
      addTransition(b, inner.accept, inner.start, null); // at least one, then loop
      return { start: s, accept: a };
    }

    case "Optional": {
      const inner = build(node.node, b);
      const s = newState(b);
      const a = newState(b);
      addTransition(b, s, inner.start, null);
      addTransition(b, s, a, null);
      addTransition(b, inner.accept, a, null);
      return { start: s, accept: a };
    }

    case "Repeat": {
      // build `min` mandatory copies, then:
      //   max === null  -> star on a fresh copy
      //   max === min   -> exactly that many copies
      //   otherwise     -> (max - min) optional copies
      let first: Fragment | null = null;
      let last: Fragment | null = null;

      for (let i = 0; i < node.min; i++) {
        const f = build(node.node, b);
        if (!first) first = f;
        if (last) addTransition(b, last.accept, f.start, null);
        last = f;
      }

      const start = first ? first.start : newState(b);
      let accept = last ? last.accept : start;

      if (node.max === null) {
        const star = build({ type: "Star", node: node.node }, b);
        if (!first) {
          // {0,} == star
          return star;
        }
        addTransition(b, last!.accept, star.start, null);
        accept = star.accept;
      } else {
        const optionalCopies = node.max - node.min;
        for (let i = 0; i < optionalCopies; i++) {
          const f = build(node.node, b);
          if (last) addTransition(b, last.accept, f.start, null);
          else first = f;
          // optional branch: skip f entirely
          if (last) addTransition(b, last.accept, f.accept, null);
          last = f;
        }
        if (!last) {
          // min === max === 0: match empty string
          accept = start;
        } else {
          accept = last.accept;
        }
        if (!first) {
          addTransition(b, start, accept, null);
        }
      }

      return { start, accept };
    }

    case "Group":
      return build(node.node, b);
  }
}

let cachedPrintable: string[] | null = null;

/** The concrete alphabet any `.` / class can match: printable ASCII + whitespace. */
export function printableAlphabet(): string[] {
  if (cachedPrintable) return cachedPrintable;
  const chars: string[] = [];
  for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCharCode(c));
  chars.push("\t", "\n", "\r");
  cachedPrintable = chars;
  return chars;
}

export function buildNfa(ast: RegexNode): Nfa {
  const b: Builder = { transitions: [], alphabet: new Set(), nextId: 0 };
  const frag = build(ast, b);
  const states: number[] = [];
  for (let i = 0; i < b.nextId; i++) states.push(i);
  return {
    states,
    alphabet: [...b.alphabet].sort(),
    transitions: b.transitions,
    initial: frag.start,
    accepting: new Set([frag.accept]),
  };
}
