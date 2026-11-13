/* Built-in sample experiments. */
import type { CustomAutomatonData } from "./experiments";

export type SampleExperiment = {
  name: string;
  pattern: string;
  description: string;
  testStrings: string[];
};

export const SAMPLES: SampleExperiment[] = [
  {
    name: "a*b — star repetition",
    pattern: "a*b",
    description: "Zero or more 'a' followed by a single 'b'. Shows a classic star loop with an epsilon skip.",
    testStrings: ["b", "ab", "aaab", "a", "ba", ""],
  },
  {
    name: "(a|b)*abb — ends in abb",
    pattern: "(a|b)*abb",
    description: "The classic Aho–Sethi–Ullman example: any string over {a,b} ending in 'abb'. Converts to a compact 4-state DFA.",
    testStrings: ["abb", "aabb", "ababb", "ab", "", "bbbab"],
  },
  {
    name: "a(b|c)+ — grouped alternation",
    pattern: "a(b|c)+",
    description: "An 'a' followed by one or more 'b' or 'c'. Demonstrates plus on a group.",
    testStrings: ["ab", "acbcc", "a", ""],
  },
  {
    name: "(0|1)*101 — binary ending 101",
    pattern: "(0|1)*101",
    description: "Binary strings ending in '101'. The DFA is a 4-state bit-pattern detector.",
    testStrings: ["101", "01101", "1010", "010", "111"],
  },
  {
    name: "ab*c — closure in the middle",
    pattern: "ab*c",
    description: "'a', any number of 'b', then 'c'. Good for comparing NFA and DFA shapes.",
    testStrings: ["ac", "abbbbbc", "abcx", ""],
  },
];

/* A hand-built example for the designer: an even-parity checker over {a,b}. */
export const DESIGNER_EXAMPLE: CustomAutomatonData = {
  states: [
    { id: "s0", x: 160, y: 180, isInitial: true, isAccepting: true },
    { id: "s1", x: 420, y: 180, isInitial: false, isAccepting: false },
  ],
  transitions: [
    { id: "t1", from: "s0", to: "s1", label: "a" },
    { id: "t2", from: "s0", to: "s1", label: "b" },
    { id: "t3", from: "s1", to: "s0", label: "a" },
    { id: "t4", from: "s1", to: "s0", label: "b" },
  ],
};
