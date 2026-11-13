/* SVG automata graph renderer. Shared by NFA view, DFA view and the designer. */

import { edgePath, selfLoopPath, NODE_RADIUS, type GraphLayout } from "../lib/graphLayout";

type Props = {
  layout: GraphLayout;
  /** nodes in the current active set (highlighted cyan) */
  activeNodes?: Set<number>;
  /** edge ids on the transition currently being taken */
  activeEdges?: Set<string>;
  /** nodes visited during execution so far (softer highlight) */
  visitedNodes?: Set<number>;
  /** error styling: edge that could not be taken */
  stuckChar?: string | null;
  selectedNode?: number | null;
  onNodeClick?: (id: number) => void;
  onEdgeClick?: (id: string) => void;
  className?: string;
};

export function AutomataGraph({
  layout,
  activeNodes,
  activeEdges,
  visitedNodes,
  selectedNode,
  onNodeClick,
  onEdgeClick,
  className,
}: Props) {
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className={className ?? "h-full w-full"}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 Z" fill="#64748b" />
        </marker>
        <marker id="arrow-active" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 Z" fill="#22d3ee" />
        </marker>
      </defs>

      {/* edges */}
      {layout.edges.map((e) => {
        const from = layout.nodes.find((n) => n.id === e.from);
        const to = layout.nodes.find((n) => n.id === e.to);
        if (!from || !to) return null;
        const isActive = activeEdges?.has(e.id);
        const geom = e.isSelfLoop ? selfLoopPath(from) : edgePath(from, to, e.isReciprocal);
        const marker = isActive ? "url(#arrow-active)" : "url(#arrow)";

        return (
          <g key={e.id} onClick={() => onEdgeClick?.(e.id)} className={onEdgeClick ? "cursor-pointer" : undefined}>
            <path d={geom.d} className={`edge-path ${isActive ? "edge-active" : ""}`} markerEnd={marker} />
            <path d={geom.d} stroke="transparent" strokeWidth="14" fill="none" />
            <rect
              x={geom.midX - Math.max(e.label.length * 3.6, 8) - 2}
              y={geom.midY - 9}
              width={Math.max(e.label.length * 7.2, 16) + 4}
              height={18}
              rx={4}
              className="edge-label-bg"
            />
            <text x={geom.midX} y={geom.midY} textAnchor="middle" dominantBaseline="central" className={`edge-label ${isActive ? "fill-cyan-300" : ""}`}>
              {e.label}
            </text>
          </g>
        );
      })}

      {/* initial arrow */}
      {layout.nodes
        .filter((n) => n.isInitial)
        .map((n) => (
          <g key={`init-${n.id}`}>
            <line x1={n.x - NODE_RADIUS - 34} y1={n.y} x2={n.x - NODE_RADIUS - 4} y2={n.y} stroke="#64748b" strokeWidth="1.6" markerEnd="url(#arrow)" />
            <text x={n.x - NODE_RADIUS - 20} y={n.y - 10} textAnchor="middle" className="edge-label fill-slate-500">
              start
            </text>
          </g>
        ))}

      {/* nodes */}
      {layout.nodes.map((n) => {
        const active = activeNodes?.has(n.id);
        const visited = visitedNodes?.has(n.id);
        const selected = selectedNode === n.id;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x} ${n.y})`}
            onClick={() => onNodeClick?.(n.id)}
            className={onNodeClick ? "cursor-pointer" : undefined}
          >
            {n.isAccepting && <circle r={NODE_RADIUS + 5} className={`state-accept-ring ${active ? "stroke-cyan-400" : visited ? "stroke-cyan-700" : ""}`} />}
            <circle
              r={NODE_RADIUS}
              className={`state-circle ${active ? "state-active" : ""} ${selected ? "stroke-cyan-300" : ""}`}
              strokeWidth={selected ? 2.4 : undefined}
            />
            <text className="state-label">{n.label}</text>
            {n.members && n.members.length > 1 && (
              <text y={NODE_RADIUS + 16} textAnchor="middle" className="fill-slate-500 font-mono text-[9px]" >
                {`{${n.members.join(",")}}`}
            </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

