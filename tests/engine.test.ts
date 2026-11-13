/**
 * Engine test suite. Run with: npx tsx tests/engine.test.ts (or via vitest-lite runner below).
 * Self-contained runner so no extra test dependency is required.
 */

import { tokenize } from "../src/engine/tokenizer";
import { parseRegex, tryParseRegex } from "../src/engine/parser";
import { buildNfa, symbolLabel } from "../src/engine/thompson";
import {
  buildEpsilonAdjacency,
  epsilonClosure,
  nfaToDfa,
  runDfa,
  runNfa,
  compile,
  findAllMatches,
} from "../src/engine/automata";
import type { Nfa, RegexNode } from "../src/engine/types";

/* ---------------- tiny test runner ---------------- */

type Test = { name: string; fn: () => void };

const tests: Test[] = [];
function test(name: string, fn: () => void) {
  tests.push({ name, fn });
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEqual(actual: unknown, expected: unknown, msg = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} — expected ${e}, got ${a}`);
}
function assertThrowsParse(pattern: string, contains: string): void {
  const r = tryParseRegex(pattern);
  if (r.ok) throw new Error(`expected '${pattern}' to fail parsing`);
  if (!r.error.info.message.toLowerCase().includes(contains.toLowerCase())) {
    throw new Error(`expected error for '${pattern}' to mention '${contains}', got: ${r.error.info.message}`);
  }
}

/* ---------------- tokenizer ---------------- */

test("tokenizer: literals and operators", () => {
  const t = tokenize("ab*c|d");
  assertEqual(t.map((x) => x.type), ["CHAR", "CHAR", "STAR", "CHAR", "PIPE", "CHAR"]);
});

test("tokenizer: escaped metacharacters", () => {
  const t = tokenize("a\\*b");
  assertEqual(t.map((x) => x.type), ["CHAR", "ESCAPED", "CHAR"]);
  assertEqual(t[1].value, "*");
});

test("tokenizer: character class as one token", () => {
  const t = tokenize("[a-z0-9_]+");
  assertEqual(t.length, 2);
  assertEqual(t[0].type, "CLASS");
  assertEqual(t[0].value, "[a-z0-9_]");
});

test("tokenizer: rejects trailing backslash", () => {
  let threw = false;
  try {
    tokenize("ab\\");
  } catch {
    threw = true;
  }
  assert(threw, "trailing backslash must throw");
});

test("tokenizer: rejects unterminated class", () => {
  let threw = false;
  try {
    tokenize("[abc");
  } catch {
    threw = true;
  }
  assert(threw, "unterminated class must throw");
});

test("tokenizer: class starting with ] treats it as literal", () => {
  const t = tokenize("[]a]");
  assertEqual(t[0].type, "CLASS");
  assertEqual(t[0].value, "[]a]");
});

/* ---------------- parser / AST ---------------- */

test("parser: precedence — alternation lowest", () => {
  const ast = parseRegex("ab|c");
  assertEqual(ast.type, "Alternation");
  if (ast.type !== "Alternation") return;
  assertEqual(ast.branches[0].type, "Concat");
  assertEqual(ast.branches[1].type, "Char");
});

test("parser: repetition binds tighter than concatenation", () => {
  const ast = parseRegex("ab*c");
  assertEqual(ast.type, "Concat");
  if (ast.type !== "Concat") return;
  assertEqual(ast.parts.length, 3);
  assertEqual(ast.parts[1].type, "Star");
});

test("parser: group overrides precedence", () => {
  const ast = parseRegex("a(b|c)");
  assertEqual(ast.type, "Concat");
  if (ast.type !== "Concat") return;
  assertEqual(ast.parts[1].type, "Group");
});

test("parser: nested groups", () => {
  const ast = parseRegex("((a))");
  assertEqual(ast.type, "Group");
});

test("parser: star of group", () => {
  const ast = parseRegex("(a|b)*abb");
  assertEqual(ast.type, "Concat");
  if (ast.type !== "Concat") return;
  assertEqual(ast.parts[0].type, "Star");
});

test("parser: bounded repeat {2,4}", () => {
  const ast = parseRegex("a{2,4}");
  assertEqual(ast.type, "Repeat");
  if (ast.type !== "Repeat") return;
  assertEqual([ast.min, ast.max], [2, 4]);
});

test("parser: bounded repeat {3,} unbounded", () => {
  const ast = parseRegex("a{3,}");
  if (ast.type !== "Repeat") throw new Error("expected Repeat");
  assertEqual([ast.min, ast.max], [3, null]);
});

test("parser: error — unmatched paren", () => {
  assertThrowsParse("(ab", "missing closing paren");
});

test("parser: error — dangling star", () => {
  assertThrowsParse("*a", "nothing to repeat");
});

test("parser: error — reversed class range", () => {
  assertThrowsParse("[z-a]", "out of order");
});

test("parser: error — reversed quantifier", () => {
  assertThrowsParse("a{3,2}", "reversed");
});

test("parser: error — anchor not supported", () => {
  assertThrowsParse("^abc", "anchor");
});

test("parser: empty pattern parses to Empty", () => {
  assertEqual(parseRegex("").type, "Empty");
});

/* ---------------- epsilon closure ---------------- */

const abStarAst = (): RegexNode => parseRegex("a*b");
const abStarNfa = (): Nfa => buildNfa(abStarAst());

test("epsilon closure of initial state includes epsilon-reachable states", () => {
  const nfa = abStarNfa();
  const epsAdj = buildEpsilonAdjacency(nfa);
  const closure = epsilonClosure([nfa.initial], epsAdj);
  assert(closure.includes(nfa.initial), "closure must include the start state");
  assert(closure.length >= 2, "a*b closure should span the skip transition");
});

test("epsilon closure is idempotent", () => {
  const nfa = abStarNfa();
  const epsAdj = buildEpsilonAdjacency(nfa);
  const c1 = epsilonClosure([nfa.initial], epsAdj);
  const c2 = epsilonClosure(c1, epsAdj);
  assertEqual(c1, c2);
});

/* ---------------- NFA execution ---------------- */

function nfaAccepts(pattern: string, input: string): boolean {
  return runNfa(buildNfa(parseRegex(pattern)), input).accepted;
}

test("nfa: a*b accepts b, ab, aaab; rejects a", () => {
  assert(nfaAccepts("a*b", "b"), "b");
  assert(nfaAccepts("a*b", "ab"), "ab");
  assert(nfaAccepts("a*b", "aaab"), "aaab");
  assert(!nfaAccepts("a*b", "a"), "a must be rejected");
  assert(!nfaAccepts("a*b", "ba"), "ba must be rejected");
});

test("nfa: (a|b)*abb accepts aabb, ababb; rejects abb-empty variants", () => {
  assert(nfaAccepts("(a|b)*abb", "aabb"));
  assert(nfaAccepts("(a|b)*abb", "ababb"));
  assert(nfaAccepts("(a|b)*abb", "abb"));
  assert(!nfaAccepts("(a|b)*abb", "ab"));
  assert(!nfaAccepts("(a|b)*abb", ""));
});

test("nfa: a(b|c)+ requires at least one of b|c", () => {
  assert(nfaAccepts("a(b|c)+", "ab"));
  assert(nfaAccepts("a(b|c)+", "acbcc"));
  assert(!nfaAccepts("a(b|c)+", "a"));
  assert(!nfaAccepts("a(b|c)+", ""));
});

test("nfa: (0|1)*101 binary suffix", () => {
  assert(nfaAccepts("(0|1)*101", "101"));
  assert(nfaAccepts("(0|1)*101", "01101"));
  assert(!nfaAccepts("(0|1)*101", "1010"));
  assert(!nfaAccepts("(0|1)*101", "010"));
});

test("nfa: ab*c", () => {
  assert(nfaAccepts("ab*c", "ac"));
  assert(nfaAccepts("ab*c", "abbbbbc"));
  assert(!nfaAccepts("ab*c", "abcx"));
  assert(!nfaAccepts("ab*c", ""));
});

test("nfa: optional a?bc", () => {
  assert(nfaAccepts("a?bc", "abc"));
  assert(nfaAccepts("a?bc", "bc"));
  assert(!nfaAccepts("a?bc", "aabc"));
});

test("nfa: exact repeat a{3}", () => {
  assert(nfaAccepts("a{3}", "aaa"));
  assert(!nfaAccepts("a{3}", "aa"));
  assert(!nfaAccepts("a{3}", "aaaa"));
});

test("nfa: bounded repeat a{2,}", () => {
  assert(!nfaAccepts("a{2,}", "a"));
  assert(nfaAccepts("a{2,}", "aaaaa"));
});

test("nfa: character classes and ranges", () => {
  assert(nfaAccepts("[a-z]+x", "abcx"));
  assert(!nfaAccepts("[a-z]+x", "aBx"));
  assert(nfaAccepts("[^abc]d", "xd"));
  assert(!nfaAccepts("[^abc]d", "ad"));
  assert(nfaAccepts("\\d{2,4}", "1234"));
  assert(!nfaAccepts("\\d{2,4}", "1"));
  assert(nfaAccepts("\\w+@\\w+", "user_9@host"));
});

test("nfa: escaped metacharacters match literally", () => {
  assert(nfaAccepts("a\\*b", "a*b"));
  assert(!nfaAccepts("a\\*b", "aab"));
});

test("nfa: empty pattern accepts empty string only", () => {
  assert(nfaAccepts("", ""));
  assert(!nfaAccepts("", "a"));
});

test("nfa: alternation with empty-ish branches via a?", () => {
  assert(nfaAccepts("x|y", "x"));
  assert(nfaAccepts("x|y", "y"));
  assert(!nfaAccepts("x|y", "z"));
});

/* ---------------- DFA ---------------- */

test("dfa conversion: subset counts bounded", () => {
  const { nfa, dfa } = compile("(a|b)*abb");
  assert(dfa.states.length <= 32, `too many DFA states: ${dfa.states.length}`);
  assert(dfa.states.length >= 4, "suspiciously few DFA states");
  assert(nfa.states.length >= dfa.states.length, "NFA should typically have >= states than DFA here");
});

test("dfa has no epsilon transitions", () => {
  const { dfa } = compile("a*b");
  assert(dfa.transitions.every((t) => t.symbol !== null), "no epsilon in DFA");
});

test("dfa: transition table is deterministic", () => {
  const { dfa } = compile("a*b");
  const seen = new Set<string>();
  for (const t of dfa.transitions) {
    const key = `${t.from}:${t.symbol}`;
    assert(!seen.has(key), `duplicate transition from ${t.from} on ${t.symbol}`);
    seen.add(key);
  }
});

test("dfa: accepting states correspond to subsets containing nfa accept", () => {
  const { nfa, dfa } = compile("(0|1)*101");
  for (const d of dfa.accepting) {
    const subset = dfa.stateSubsets.get(d)!;
    assert(subset.some((s) => nfa.accepting.has(s)), `dfa state ${d} must contain an accepting nfa state`);
  }
});

function dfaAccepts(pattern: string, input: string): boolean {
  return runDfa(compile(pattern).dfa, input).accepted;
}

test("dfa: a*b acceptance matches nfa", () => {
  assert(dfaAccepts("a*b", "aaab"));
  assert(!dfaAccepts("a*b", "a"));
});

test("dfa: (a|b)*abb", () => {
  assert(dfaAccepts("(a|b)*abb", "ababb"));
  assert(!dfaAccepts("(a|b)*abb", "ab"));
});

test("dfa: quantifier edge a{2,3}b", () => {
  assert(dfaAccepts("a{2,3}b", "aab"));
  assert(dfaAccepts("a{2,3}b", "aaab"));
  assert(!dfaAccepts("a{2,3}b", "ab"));
  assert(!dfaAccepts("a{2,3}b", "aaaab"));
});

test("dfa: rejects on stuck transition", () => {
  const r = runDfa(compile("ab").dfa, "axb");
  assert(!r.accepted);
  assert(r.steps[r.steps.length - 1].canConsume === false, "last step should mark a stuck transition");
});

/* ---------------- NFA/DFA equivalence ---------------- */

const EQUIV_PATTERNS = ["a*b", "(a|b)*abb", "a(b|c)+", "(0|1)*101", "ab*c", "a?bc", "[a-c]{2,3}d", "\\d+x", "x|y|z"];
const EQUIV_INPUTS = ["", "a", "b", "ab", "abb", "aabb", "ababb", "ac", "acb", "101", "01101", "010", "abc", "abcd", "123x", "xx", "yyz", "zzzz", "bc", "aab"];

test("equivalence: nfa and dfa agree on every pattern/input pair", () => {
  for (const p of EQUIV_PATTERNS) {
    const { nfa, dfa } = compile(p);
    for (const input of EQUIV_INPUTS) {
      const n = runNfa(nfa, input).accepted;
      const d = runDfa(dfa, input).accepted;
      assertEqual(n, d, `pattern '${p}' input '${input}'`);
    }
  }
});

/* ---------------- findAllMatches ---------------- */

test("findAllMatches: (a|b)*abb finds leftmost-longest", () => {
  const { nfa } = compile("(a|b)*abb");
  const m = findAllMatches(nfa, "aababb");
  assertEqual(m, [{ start: 0, end: 6 }]);
});

test("findAllMatches: multiple matches", () => {
  const { nfa } = compile("ab");
  const m = findAllMatches(nfa, "abxabab");
  assertEqual(m, [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 5, end: 7 },
  ]);
});

/* ---------------- run ---------------- */

let passed = 0;
const failures: string[] = [];
for (const t of tests) {
  try {
    t.fn();
    passed++;
  } catch (e) {
    failures.push(`${t.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n${passed}/${tests.length} tests passed`);
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
