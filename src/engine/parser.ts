/* Recursive-descent parser: token stream -> AST.
 *
 * Grammar (precedence low -> high):
 *   alternation := concat ('|' concat)*
 *   concat      := repeat*
 *   repeat      := atom (STAR | PLUS | QUESTION | LBRACE n (COMMA m?)? RBRACE)*
 *   atom        := CHAR | ANY | CLASS | ESCAPED | '(' alternation ')' | ε
 */

import { isClassShorthandEscape, isDigit, tokenize, type Token } from "./tokenizer";
import type { ClassMember, RegexNode } from "./types";
import { RegexParseError } from "./types";

const SHORTHAND_LABELS: Record<string, string> = {
  d: "\\d (digit 0-9)",
  w: "\\w (word character)",
  s: "\\s (whitespace)",
  D: "\\D (non-digit)",
  W: "\\W (non-word)",
  S: "\\S (non-whitespace)",
};

export function shorthandLabel(c: string): string | null {
  return SHORTHAND_LABELS[c] ?? null;
}

class Parser {
  private tokens: Token[];
  private idx = 0;

  constructor(pattern: string) {
    this.tokens = tokenize(pattern);
  }

  private peek(): Token | undefined {
    return this.tokens[this.idx];
  }

  private next(): Token | undefined {
    return this.tokens[this.idx++];
  }

  private expect(type: string, message: string, hint?: string): Token {
    const t = this.next();
    if (!t || t.type !== type) {
      const pos = t ? t.position : this.endPosition();
      throw new RegexParseError({ message, hint, position: pos });
    }
    return t;
  }

  private endPosition(): number {
    const last = this.tokens[this.tokens.length - 1];
    return last ? last.position + last.value.length : 0;
  }

  parse(): RegexNode {
    if (this.tokens.length === 0) {
      return { type: "Empty" };
    }
    const node = this.parseAlternation();
    const trailing = this.peek();
    if (trailing) {
      throw new RegexParseError({
        message: `Unexpected '${describeToken(trailing)}'`,
        hint: describeUnexpectedHint(trailing),
        position: trailing.position,
        length: trailing.value.length,
      });
    }
    return node;
  }

  private parseAlternation(): RegexNode {
    const branches: RegexNode[] = [this.parseConcat()];
    while (this.peek()?.type === "PIPE") {
      this.next();
      branches.push(this.parseConcat());
    }
    if (branches.length === 1) return branches[0];
    return { type: "Alternation", branches };
  }

  private parseConcat(): RegexNode {
    const parts: RegexNode[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.type === "PIPE" || t.type === "RPAREN") break;
      parts.push(this.parseRepeat());
    }
    if (parts.length === 0) return { type: "Empty" };
    if (parts.length === 1) return parts[0];
    return { type: "Concat", parts };
  }

  private parseRepeat(): RegexNode {
    let node = this.parseAtom();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.type === "STAR") {
        this.next();
        node = { type: "Star", node };
      } else if (t.type === "PLUS") {
        this.next();
        node = { type: "Plus", node };
      } else if (t.type === "QUESTION") {
        this.next();
        node = { type: "Optional", node };
      } else if (t.type === "LBRACE") {
        node = this.parseBoundedRepeat(node);
      } else {
        break;
      }
    }
    return node;
  }

  private parseBoundedRepeat(node: RegexNode): RegexNode {
    const open = this.next()!; // consume '{'
    let min = 0;
    let max: number | null = null;
    let sawComma = false;
    let sawClose = false;

    const t1 = this.peek();
    if (t1 && t1.type === "COMMA") {
      sawComma = true;
      this.next();
    } else if (t1 && t1.type === "CHAR" && isDigit(t1.value)) {
      min = this.readNumber();
      const t2 = this.peek();
      if (t2 && t2.type === "COMMA") {
        sawComma = true;
        this.next();
      } else if (t2 && t2.type === "RBRACE") {
        max = min;
        this.next();
        sawClose = true;
      } else {
        throw new RegexParseError({
          message: "Malformed quantifier",
          hint: "Expected ',' or '}' inside the {m,n} quantifier.",
          position: t2 ? t2.position : open.position,
        });
      }
    } else {
      throw new RegexParseError({
        message: "Malformed quantifier",
        hint: "{ must be followed by a number. Use {n}, {n,}, {n,m} — or escape it as '\\{' to match a literal brace.",
        position: t1 ? t1.position : open.position,
      });
    }

    if (!sawClose) {
      if (sawComma) {
        const t3 = this.peek();
        if (t3 && t3.type === "CHAR" && isDigit(t3.value)) {
          max = this.readNumber();
        } else {
          max = null; // {n,} — unbounded
        }
      }
      this.expect("RBRACE", "Unterminated quantifier", "The {m,n} quantifier needs a closing '}'.");
    }

    if (max !== null && min > max) {
      throw new RegexParseError({
        message: `Quantifier range is reversed ({${min},${max}})`,
        hint: "The minimum repetitions cannot exceed the maximum.",
        position: open.position,
      });
    }

    return { type: "Repeat", node, min, max };
  }

  private readNumber(): number {
    let digits = "";
    let n = 0;
    while (this.peek() && this.peek()!.type === "CHAR" && isDigit(this.peek()!.value)) {
      const d = this.next()!;
      digits += d.value;
      n++;
      if (n > 7) {
        throw new RegexParseError({
          message: "Quantifier value too large",
          hint: "Repetition counts above 999999 are not supported.",
          position: d.position,
        });
      }
    }
    const v = parseInt(digits, 10);
    if (v > 999999) {
      throw new RegexParseError({
        message: "Quantifier value too large",
        hint: "Repetition counts above 999999 are not supported (the automaton would be unmanageably large).",
        position: this.tokens[this.idx - 1].position,
      });
    }
    return v;
  }

  private parseAtom(): RegexNode {
    const t = this.next();
    if (!t) return { type: "Empty" };

    switch (t.type) {
      case "CHAR":
        return { type: "Char", char: t.value };

      case "ANY":
        return { type: "AnyChar" };

      case "ESCAPED": {
        if (isClassShorthandEscape(t.value)) {
          return charClassFromShorthand(t.value, t.position);
        }
        if ("nrt0".includes(t.value)) {
          const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0" };
          return { type: "Char", char: map[t.value] };
        }
        return { type: "Char", char: t.value };
      }

      case "CLASS": {
        const members = parseClassMembers(t.value, t.position);
        const negated = t.value.startsWith("[^");
        return { type: "CharClass", negated, members };
      }

      case "LPAREN": {
        const inner = this.parseAlternation();
        const closing = this.peek();
        if (closing?.type === "RPAREN") {
          this.next();
          return { type: "Group", node: inner, kind: "capturing" };
        }
        throw new RegexParseError({
          message: "Missing closing parenthesis",
          hint: "The group opened here was never closed with a matching ')'.",
          position: t.position,
        });
      }

      case "RPAREN":
        throw new RegexParseError({
          message: "Unmatched closing parenthesis",
          hint: "A ')' appeared without a preceding '('.",
          position: t.position,
          length: 1,
        });

      case "STAR":
      case "PLUS":
      case "QUESTION":
        throw new RegexParseError({
          message: `Nothing to repeat before '${t.value}'`,
          hint: "Repetition operators must follow a character, group or class.",
          position: t.position,
          length: 1,
        });

      case "LBRACE":
        throw new RegexParseError({
          message: "Malformed quantifier",
          hint: "{ must follow a character, group or class and contain a number.",
          position: t.position,
        });

      case "RBRACE":
        throw new RegexParseError({
          message: "Unmatched closing brace '}'",
          hint: "A '}' appeared without a preceding '{' quantifier.",
          position: t.position,
          length: 1,
        });

      case "PIPE":
        // handled by alternation; an empty branch would have consumed it
        throw new RegexParseError({
          message: "Unexpected '|'",
          hint: "Alternation branches cannot be nested like this.",
          position: t.position,
          length: 1,
        });

      default:
        throw new RegexParseError({
          message: `Unexpected token near position ${t.position}`,
          position: t.position,
        });
    }
  }
}

function describeToken(t: Token): string {
  return t.type === "CLASS" ? t.value : t.value;
}

function describeUnexpectedHint(t: Token): string {
  switch (t.type) {
    case "RPAREN":
      return "Try removing the extra ')' or adding a matching '('.";
    case "RBRACE":
      return "A '}' must close a {m,n} quantifier. Escape it as '\\}' to match a literal brace.";
    case "PIPE":
      return "Empty alternation branches are not supported — give both sides of '|' content.";
    default:
      return "Remove or escape this character (prefix it with a backslash to match it literally).";
  }
}

/* ---------------- character class body parsing ---------------- */

export function parseClassMembers(raw: string, position: number): ClassMember[] {
  // raw is the full slice like "[^a-z_]" — strip brackets
  const body = raw.slice(1, raw.length - 1).replace(/^\^/, "");
  const members: ClassMember[] = [];
  let i = 0;

  const readRawChar = (): string | null => {
    if (i >= body.length) return null;
    const c = body[i];
    if (c === "\\" && i + 1 < body.length) {
      i += 2;
      const e = body[i - 1];
      const map: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
      return map[e] ?? e;
    }
    i++;
    return c;
  };

  while (i < body.length) {
    const start = readRawChar();
    if (start === null) break;
    // range?
    if (i < body.length && body[i] === "-" && i + 1 < body.length && body[i + 1] !== "]") {
      i++; // consume '-'
      const end = readRawChar();
      if (end === null) {
        members.push({ kind: "char", char: start });
        members.push({ kind: "char", char: "-" });
        break;
      }
      if (start.charCodeAt(0) > end.charCodeAt(0)) {
        throw new RegexParseError({
          message: `Character class range out of order: ${start}-${end}`,
          hint: `In a range like a-z, the first character must come before the second in Unicode order.`,
          position,
        });
      }
      members.push({ kind: "range", from: start, to: end });
    } else {
      members.push({ kind: "char", char: start });
    }
  }

  // expand shorthand escapes that slipped through readRawChar as plain chars
  return members;
}

export function classMemberMatches(member: ClassMember, c: string): boolean {
  switch (member.kind) {
    case "char":
      return c === member.char;
    case "range":
      return c >= member.from && c <= member.to;
    case "class":
      return shorthandMatches(member.negated, member.members, c);
  }
}

export function shorthandMatches(negated: boolean, members: ClassMember[], c: string): boolean {
  const hit = members.some((m) => classMemberMatches(m, c));
  return negated ? !hit : hit;
}

export function charClassFromShorthand(escape: string, position: number): RegexNode {
  switch (escape) {
    case "d":
      return digitClass(false);
    case "D":
      return digitClass(true);
    case "w":
      return wordClass(false);
    case "W":
      return wordClass(true);
    case "s":
      return spaceClass(false);
    case "S":
      return spaceClass(true);
    default:
      throw new RegexParseError({ message: `Unknown escape '\\${escape}'`, position });
  }
}

function digitClass(negated: boolean): RegexNode {
  return {
    type: "CharClass",
    negated,
    members: [{ kind: "range", from: "0", to: "9" }],
  };
}

function wordClass(negated: boolean): RegexNode {
  return {
    type: "CharClass",
    negated,
    members: [
      { kind: "char", char: "_" },
      { kind: "range", from: "a", to: "z" },
      { kind: "range", from: "A", to: "Z" },
      { kind: "range", from: "0", to: "9" },
    ],
  };
}

function spaceClass(negated: boolean): RegexNode {
  return {
    type: "CharClass",
    negated,
    members: [{ kind: "char", char: " " }, { kind: "char", char: "\t" }, { kind: "char", char: "\n" }, { kind: "char", char: "\r" }],
  };
}

/* ---------------- public API ---------------- */

export function parseRegex(pattern: string): RegexNode {
  return new Parser(pattern).parse();
}

export function tryParseRegex(pattern: string): { ok: true; ast: RegexNode } | { ok: false; error: RegexParseError } {
  try {
    return { ok: true, ast: parseRegex(pattern) };
  } catch (e) {
    if (e instanceof RegexParseError) return { ok: false, error: e };
    throw e;
  }
}
