/* Regex Studio: pattern editor, live validation, test strings with match highlighting. */

import { useMemo } from "react";
import { CheckCircle2, XCircle, Plus, Trash2, AlertTriangle } from "lucide-react";
import type { RegexError } from "../engine/types";
import { findAllMatches } from "../engine/automata";
import type { Nfa } from "../engine/types";

type Props = {
  pattern: string;
  onPatternChange: (p: string) => void;
  error: RegexError | null;
  nfa: Nfa | null;
  testStrings: string[];
  onTestStringsChange: (list: string[]) => void;
};

export function RegexStudio({ pattern, onPatternChange, error, nfa, testStrings, onTestStringsChange }: Props) {
  const segments = useMemo(() => highlightSegments(pattern), [pattern]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scroll-slim p-4 lg:p-6">
      <section>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Pattern
        </label>
        <div
          className={`relative rounded-md border bg-black/40 font-mono text-base transition-colors ${
            error ? "border-rose-500/60" : "border-white/10 focus-within:border-cyan-500/60"
          }`}
        >
          {/* syntax-highlighted mirror */}
          <div className="pointer-events-none absolute inset-0 px-3 py-2.5 whitespace-pre" aria-hidden>
            {segments.map((s, i) =>
              s.kind === "plain" ? (
                <span key={i} className="text-transparent">{s.text}</span>
              ) : s.kind === "meta" ? (
                <span key={i} className="text-transparent">{s.text}</span>
              ) : null
            )}
          </div>
          <input
            type="text"
            value={pattern}
            onChange={(e) => onPatternChange(e.target.value)}
            spellCheck={false}
            placeholder="e.g. (a|b)*abb"
            className="w-full bg-transparent px-3 py-2.5 font-mono text-base text-cyan-100 caret-cyan-300 placeholder:text-slate-600 focus:outline-none"
          />
        </div>

        {error ? (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2 text-sm">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <p className="text-rose-200">{error.message}</p>
              {error.hint && <p className="mt-0.5 text-xs text-rose-300/70">{error.hint}</p>}
              <p className="mt-1 font-mono text-[10px] text-rose-400/70">position {error.position}</p>
            </div>
          </div>
        ) : (
          pattern.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400/90">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Valid pattern — NFA and DFA are up to date.
            </div>
          )
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Test strings
          </label>
          <button
            className="btn-ghost text-[11px]"
            onClick={() => onTestStringsChange([...testStrings, ""])}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" /> Add string
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {testStrings.length === 0 && (
            <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">
              Add a test string to see live match highlighting.
            </p>
          )}
          {testStrings.map((s, i) => (
            <TestStringRow
              key={i}
              value={s}
              nfa={nfa}
              error={error}
              onChange={(v) => {
                const next = [...testStrings];
                next[i] = v;
                onTestStringsChange(next);
              }}
              onRemove={() => onTestStringsChange(testStrings.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TestStringRow({
  value,
  nfa,
  error,
  onChange,
  onRemove,
}: {
  value: string;
  nfa: Nfa | null;
  error: RegexError | null;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const result = useMemo(() => {
    if (!nfa || error) return null;
    try {
      return findAllMatches(nfa, value);
    } catch {
      return null;
    }
  }, [nfa, value, error]);

  const matches = result ?? [];

  return (
    <div className="group relative">
      <div className="pointer-events-none absolute inset-0 rounded-md px-3 py-2 font-mono text-sm whitespace-pre" aria-hidden>
        {renderHighlighted(value, matches)}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder="test string…"
        className="input-dark font-mono pr-9 text-transparent caret-cyan-200"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {result ? (
          matches.length > 0 ? (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
              {matches.length} match{matches.length !== 1 ? "es" : ""}
            </span>
          ) : value.length > 0 ? (
            <span className="rounded bg-slate-600/30 px-1.5 py-0.5 text-[10px] text-slate-400">no match</span>
          ) : null
        ) : value.length > 0 ? (
          <AlertTriangle className="h-3.5 w-3.5 text-slate-600" />
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-slate-600 opacity-0 transition-opacity hover:bg-rose-500/15 hover:text-rose-300 group-hover:opacity-100"
          aria-label="Remove test string"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function renderHighlighted(value: string, matches: { start: number; end: number }[]) {
  if (!value) return <span className="text-transparent">{""}</span>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.start > cursor) out.push(<span key={`p${i}`} className="text-transparent">{value.slice(cursor, m.start)}</span>);
    out.push(
      <span key={`m${i}`} className="rounded-[3px] bg-cyan-500/25 text-cyan-100 shadow-[inset_0_-1px_0_rgba(34,211,238,0.6)]">
        {value.slice(m.start, m.end) || "ε"}
      </span>
    );
    cursor = m.end;
  }
  if (cursor < value.length) out.push(<span key="tail" className="text-transparent">{value.slice(cursor)}</span>);
  return out;
}

function highlightSegments(pattern: string) {
  // lightweight pattern coloring for the mirror layer
  const segments: { text: string; kind: "plain" | "meta" }[] = [];
  let buf = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const meta = "*+?()|{}".includes(c) || (c === "\\" && i + 1 < pattern.length);
    if (c === "[") inClass = true;
    if (c === "]") inClass = false;
    const kind = inClass || meta ? "meta" : "plain";
    if (kind === "meta" && buf) {
      segments.push({ text: buf, kind: "plain" });
      buf = "";
    }
    if (kind === "meta") {
      if (c === "\\" && i + 1 < pattern.length) {
        segments.push({ text: c + pattern[i + 1], kind: "meta" });
        i++;
      } else {
        segments.push({ text: c, kind: "meta" });
      }
    } else {
      buf += c;
    }
  }
  if (buf) segments.push({ text: buf, kind: "plain" });
  return segments;
}
