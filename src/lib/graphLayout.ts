/* Layout + rendering math for automata graphs (pure functions, SVG-agnostic). */

export type GraphNode = {
  id: number;
  label: string;
  x: number;
  y: number;
  isInitial: boolean;
  isAccepting: boolean;
  /** nfa state ids represented (dfa only); equals [id] for nfa */
  members?: number[];
};

export type GraphEdge = {
  id: string;
  from: number;
  to: number;
  /** joined label, e.g. "a, b" or "ε" */
  label: string;
  /** raw symbols, used for active-edge checks */
  symbols: (string | null)[];
  /** true when from === to */
  isSelfLoop: boolean;
  /** true when a reverse edge exists (curve this edge) */
  isReciprocal: boolean;
};

export type GraphLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
};

const R = 26; // node radius
const PADDING = 50;
const SELF_LOOP_DX = 34;

/** Deterministic layout: layered by BFS depth from the initial state, x by layer, y by order. */
export function layoutGraph(
  states: number[],
  initial: number,
  accepting: Set<number>,
  transitions: { from: number; to: number; symbol: string | null }[],
  options: { labelFor?: (id: number) => string; membersFor?: (id: number) => number[] } = {}
): GraphLayout {
  const labelFor = options.labelFor ?? ((id: number) => `q${id}`);
  const membersFor = options.membersFor;

  // ---- BFS layering ----
  const adj = new Map<number, number[]>();
  for (const s of states) adj.set(s, []);
  for (const t of transitions) {
    if (t.from !== t.to && !adj.get(t.from)!.includes(t.to)) adj.get(t.from)!.push(t.to);
  }

  const depth = new Map<number, number>();
  const queue = [initial];
  depth.set(initial, 0);
  while (queue.length > 0) {
    const s = queue.shift()!;
    for (const n of adj.get(s) ?? []) {
      if (!depth.has(n)) {
        depth.set(n, depth.get(s)! + 1);
        queue.push(n);
      }
    }
  }
  // unreachable states go into a trailing layer
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const s of states) {
    if (!depth.has(s)) depth.set(s, maxDepth + 1);
  }

  const layers = new Map<number, number[]>();
  for (const s of states) {
    const d = depth.get(s)!;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(s);
  }
  for (const list of layers.values()) list.sort((a, b) => a - b);

  const sortedDepths = [...layers.keys()].sort((a, b) => a - b);
  const maxPerRow = Math.max(...sortedDepths.map((d) => layers.get(d)!.length), 1);

  const nodeH = 2 * R + 46;
  const nodeW = 2 * R + 56;
  const width = PADDING * 2 + Math.max(sortedDepths.length, 1) * nodeW;
  const height = PADDING * 2 + maxPerRow * nodeH;

  const nodes: GraphNode[] = [];
  for (const d of sortedDepths) {
    const row = layers.get(d)!;
    const rowCount = row.length;
    row.forEach((s, i) => {
      // center rows vertically
      const yOffset = (maxPerRow - rowCount) / 2;
      nodes.push({
        id: s,
        label: labelFor(s),
        x: PADDING + R + d * nodeW,
        y: PADDING + R + (i + yOffset) * nodeH,
        isInitial: s === initial,
        isAccepting: accepting.has(s),
        members: membersFor ? membersFor(s) : [s],
      });
    });
  }

  const pos = new Map<number, { x: number; y: number }>();
  for (const n of nodes) pos.set(n.id, { x: n.x, y: n.y });

  // ---- edge merging (same from+to => one edge with joined label) ----
  const merged = new Map<string, { from: number; to: number; symbols: (string | null)[] }>();
  for (const t of transitions) {
    const key = `${t.from}->${t.to}`;
    if (!merged.has(key)) merged.set(key, { from: t.from, to: t.to, symbols: [] });
    merged.get(key)!.symbols.push(t.symbol);
  }

  const pairs = new Set([...merged.values()].map((m) => `${m.from}->${m.to}`));
  const edges: GraphEdge[] = [];
  for (const m of merged.values()) {
    const symbols = [...new Set(m.symbols.map((s) => (s === null ? "ε" : s)))];
    symbols.sort((a, b) => (a === "ε" ? 1 : b === "ε" ? -1 : a.localeCompare(b)));
    edges.push({
      id: `${m.from}-${m.to}`,
      from: m.from,
      to: m.to,
      label: symbols.join(", "),
      symbols: m.symbols,
      isSelfLoop: m.from === m.to,
      isReciprocal: m.from !== m.to && pairs.has(`${m.to}->${m.from}`),
    });
  }
  edges.sort((a, b) => a.from - b.from || a.to - b.to);

  return { nodes, edges, width, height };
}

/* ---------------- SVG geometry helpers ---------------- */

export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }, isReciprocal: boolean): { d: string; midX: number; midY: number; angle: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const start = { x: from.x + ux * R, y: from.y + uy * R };
  const end = { x: to.x - ux * R, y: to.y - uy * R };

  if (!isReciprocal) {
    return {
      d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      midX: (start.x + end.x) / 2,
      midY: (start.y + end.y) / 2,
      angle: Math.atan2(end.y - start.y, end.x - start.x),
    };
  }

  // curve sideways for reciprocal pairs
  const nx = -uy;
  const ny = ux;
  const bend = 34;
  const cx = (start.x + end.x) / 2 + nx * bend;
  const cy = (start.y + end.y) / 2 + ny * bend;
  return {
    d: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`,
    midX: cx,
    midY: cy,
    angle: Math.atan2(end.y - cy, end.x - cx),
  };
}

export function selfLoopPath(node: { x: number; y: number }): { d: string; midX: number; midY: number; angle: number } {
  // loop up-and-over from the top-right of the node
  const sx = node.x + R * 0.72;
  const sy = node.y - R * 0.72;
  const ex = node.x - R * 0.72;
  const ey = node.y - R * 0.72;
  const lift = SELF_LOOP_DX + 22;
  return {
    d: `M ${sx} ${sy} C ${node.x + SELF_LOOP_DX} ${sy - lift}, ${node.x - SELF_LOOP_DX} ${ey - lift}, ${ex} ${ey}`,
    midX: node.x,
    midY: sy - lift + 8,
    angle: 0,
  };
}

export function arrowHead(angle: number, x: number, y: number): string {
  const s = 7;
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  return `M ${x} ${y} L ${x + Math.cos(a1) * s} ${y + Math.sin(a1) * s} L ${x + Math.cos(a2) * s} ${y + Math.sin(a2) * s} Z`;
}

/** Point just before the target node rim along a straight line. */
export function rimPoint(from: { x: number; y: number }, to: { x: number; y: number }, offset = R + 2): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: to.x - (dx / dist) * offset, y: to.y - (dy / dist) * offset };
}

export const NODE_RADIUS = R;
