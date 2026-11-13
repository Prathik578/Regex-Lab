/* Tokenizer for the supported regex syntax. */

import type { RegexError } from "./types";
import { RegexParseError } from "./types";

export type TokenType =
  | "CHAR" // literal character
  | "ANY" // .
  | "CLASS" // [...]  (raw slice, parsed later by parser)
  | "LPAREN"
  | "RPAREN"
  | "STAR"
  | "PLUS"
  | "QUESTION"
  | "LBRACE" // {
  | "RBRACE"
  | "COMMA"
  | "PIPE"
  | "ESCAPED"; // \x

export type Token = {
  type: TokenType;
  value: string;
  position: number;
};

const REGEX_META_CHARS = new Set([".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "^", "$", "\\"]);

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

export function isClassShorthandEscape(c: string): boolean {
  return c === "d" || c === "w" || c === "s" || c === "D" || c === "W" || c === "S";
}

export function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i];
    const pos = i;

    switch (c) {
      case "\\":
        if (i + 1 >= pattern.length) {
          throw new RegexParseError({
            message: "Trailing backslash",
            hint: "A backslash at the end of the pattern escapes nothing. Add a character after it, or remove it.",
            position: pos,
            length: 1,
          });
        }
        tokens.push({ type: "ESCAPED", value: pattern[i + 1], position: pos });
        i += 2;
        break;

      case "[":
        // scan raw class slice including nested escapes and negation
        let j = i + 1;
        let negated = false;
        if (j < pattern.length && pattern[j] === "^") {
          negated = true;
          j++;
        }
        // A ']' or '-' as the very first member is a literal (common convention).
        let sawFirst = false;
        let closed = false;
        while (j < pattern.length) {
          if (pattern[j] === "\\") {
            if (j + 1 >= pattern.length) {
              throw new RegexParseError({
                message: "Trailing backslash in character class",
                hint: "Escape sequences inside [...] must be followed by a character.",
                position: j,
                length: 1,
              });
            }
            j += 2;
            sawFirst = true;
            continue;
          }
          if (pattern[j] === "]") {
            if (!sawFirst) {
              // literal ']'
              sawFirst = true;
              j++;
              continue;
            }
            closed = true;
            break;
          }
          sawFirst = true;
          j++;
        }
        if (!closed) {
          throw new RegexParseError({
            message: "Unterminated character class",
            hint: "The character class started here was never closed with a matching ']'.",
            position: pos,
          });
        }
        tokens.push({ type: "CLASS", value: pattern.slice(i, j + 1), position: pos });
        i = j + 1;
        break;

      case ".":
        tokens.push({ type: "ANY", value: ".", position: pos });
        i++;
        break;

      case "(":
        tokens.push({ type: "LPAREN", value: "(", position: pos });
        i++;
        break;

      case ")":
        tokens.push({ type: "RPAREN", value: ")", position: pos });
        i++;
        break;

      case "*":
        tokens.push({ type: "STAR", value: "*", position: pos });
        i++;
        break;

      case "+":
        tokens.push({ type: "PLUS", value: "+", position: pos });
        i++;
        break;

      case "?":
        tokens.push({ type: "QUESTION", value: "?", position: pos });
        i++;
        break;

      case "{":
        tokens.push({ type: "LBRACE", value: "{", position: pos });
        i++;
        break;

      case "}":
        tokens.push({ type: "RBRACE", value: "}", position: pos });
        i++;
        break;

      case ",":
        tokens.push({ type: "COMMA", value: ",", position: pos });
        i++;
        break;

      case "|":
        tokens.push({ type: "PIPE", value: "|", position: pos });
        i++;
        break;

      case "^":
      case "$":
        // anchors are outside the supported fragment; be explicit
        throw new RegexParseError({
          message: `Anchor '${c}' is not supported`,
          hint: "RegexLab works on pattern fragments (no anchors). The pattern implicitly matches against the whole test token.",
          position: pos,
          length: 1,
        });

      case "]":
        throw new RegexParseError({
          message: "Unmatched closing bracket ']'",
          hint: "A ']' appeared without a preceding '[' character class.",
          position: pos,
          length: 1,
        });

      case "}":
        throw new RegexParseError({
          message: "Unmatched closing brace '}'",
          hint: "A '}' appeared without a preceding '{' quantifier.",
          position: pos,
          length: 1,
        });

      default:
        tokens.push({ type: "CHAR", value: c, position: pos });
        i++;
        break;
    }
  }

  return tokens;
}

export function validateLiteralChar(c: string): boolean {
  return !REGEX_META_CHARS.has(c);
}

export { isDigit };
