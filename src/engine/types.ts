/* Core automata & regex engine types. Pure data, no UI concerns. */

/* ---------------- Regex AST ---------------- */

export type RegexNode =
  | { type: "Empty" } // matches empty string (ε)
  | { type: "Char"; char: string }
  | { type: "AnyChar" } // dot
  | { type: "CharClass"; negated: boolean; members: ClassMember[] }
  | { type: "Concat"; parts: RegexNode[] }
  | { type: "Alternation"; branches: RegexNode[] }
  | { type: "Star"; node: RegexNode }
  | { type: "Plus"; node: RegexNode }
  | { type: "Optional"; node: RegexNode }
  | { type: "Repeat"; node: RegexNode; min: number; max: number | null } // max null = unbounded
  | { type: "Group"; node: RegexNode; kind: "capturing" | "non-capturing" };

export type ClassMember =
  | { kind: "char"; char: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "class"; negated: boolean; members: ClassMember[] };

/* ---------------- Finite automata ---------------- */

export type NfaTransition = {
  from: number;
  to: number;
  /** null symbol = epsilon transition */
  symbol: string | null;
};

export type Nfa = {
  states: number[]; // 0..n-1 for convenience
  alphabet: string[]; // concrete symbols (chars / class descriptors)
  transitions: NfaTransition[];
  initial: number;
  accepting: Set<number>;
};

export type DfaTransition = {
  from: number;
  to: number;
  symbol: string; // DFA has no epsilon transitions
};

export type Dfa = {
  states: number[];
  alphabet: string[];
  transitions: DfaTransition[];
  initial: number;
  accepting: Set<number>;
  /** which NFA states each DFA state represents */
  stateSubsets: Map<number, number[]>;
};

/* ---------------- Execution traces ---------------- */

export type ExecutionStep = {
  stepIndex: number;
  char: string | null; // null for initial state
  charPosition: number | null;
  /** NFA: epsilon-closure sets; DFA: single-state sets */
  stateSet: number[];
  isStart: boolean;
  canConsume: boolean; // false when stuck (no valid transition)
};

export type ExecutionResult = {
  input: string;
  accepted: boolean;
  steps: ExecutionStep[];
  reason: string;
};

/* ---------------- Errors ---------------- */

export type RegexError = {
  message: string;
  hint?: string;
  position: number;
  length?: number;
};

export class RegexParseError extends Error {
  readonly info: RegexError;
  constructor(info: RegexError) {
    super(info.message);
    this.name = "RegexParseError";
    this.info = info;
  }
}
