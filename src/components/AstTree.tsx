/* Interactive AST tree rendering. */
import type { ClassMember, RegexNode } from "../engine/types";

type Props = { ast: RegexNode };

const NODE_TYPE_LABEL: Record<RegexNode["type"], string> = {
  Empty: "ε empty",
  Char: "literal",
  AnyChar: "any char",
  CharClass: "class",
  Concat: "concat",
  Alternation: "alternation",
  Star: "star *",
  Plus: "plus +",
  Optional: "optional ?",
  Repeat: "repeat {m,n}",
  Group: "group",
};

function describe(node: RegexNode): string {
  switch (node.type) {
    case "Char":
      return node.char === "\n" ? "\\n" : node.char;
    case "Repeat":
      return `{${node.min},${node.max ?? ""}}`;
    case "CharClass": {
      const body = node.members.map(memberLabel).join("");
      return `${node.negated ? "^" : ""}${body}`;
    }
    default:
      return "";
  }
}

function memberLabel(m: ClassMember): string {
  switch (m.kind) {
    case "char":
      return m.char;
    case "range":
      return `${m.from}-${m.to}`;
    case "class":
      return "…";
  }
}

function AstNodeView({ node, depth }: { node: RegexNode; depth: number }) {
  const label = NODE_TYPE_LABEL[node.type];
  const detail = describe(node);
  const isLeaf = ["Char", "AnyChar", "CharClass", "Empty"].includes(node.type);

  return (
    <div className="flex flex-col gap-0.5" style={{ paddingLeft: depth === 0 ? 0 : 18 }}>
      <div
        className={`flex items-center gap-2 rounded border px-2 py-1 text-xs transition-colors ${
          isLeaf
            ? "border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-200"
            : "border-white/[0.07] bg-white/[0.03] text-slate-200"
        }`}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
        {detail && <span className="font-mono text-cyan-300">{detail}</span>}
      </div>
      {node.type === "Concat" && node.parts.map((p, i) => <AstNodeView key={i} node={p} depth={depth + 1} />)}
      {node.type === "Alternation" && node.branches.map((b, i) => <AstNodeView key={i} node={b} depth={depth + 1} />)}
      {node.type === "Star" && <AstNodeView node={node.node} depth={depth + 1} />}
      {node.type === "Plus" && <AstNodeView node={node.node} depth={depth + 1} />}
      {node.type === "Optional" && <AstNodeView node={node.node} depth={depth + 1} />}
      {node.type === "Repeat" && <AstNodeView node={node.node} depth={depth + 1} />}
      {node.type === "Group" && <AstNodeView node={node.node} depth={depth + 1} />}
    </div>
  );
}

export function AstTree({ ast }: Props) {
  return (
    <div className="scroll-slim max-h-full overflow-auto p-3">
      <AstNodeView node={ast} depth={0} />
    </div>
  );
}
