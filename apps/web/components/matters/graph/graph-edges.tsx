'use client';
// The connectors behind the graph's nodes (#41): one SVG path per edge from `layoutGraph`. Line
// styles say the relationship without colour: `parent_of` solid (indent), `appeal_from` solid with
// an arrowhead and the word "appeal", `connected` dashed, `lower_court` dotted. 1.5 px strokes in
// `ink-muted`; the edges of the selected proceedings take the accent. The SVG is decorative: the
// same relations are text in each node's description. A selected edge pulses for 150 ms unless the
// viewer prefers reduced motion.
import { useId } from 'react';

import type { Layout, LayoutEdgeKind } from './graph-layout.ts';

export const EDGE_DASH: Record<LayoutEdgeKind, string | undefined> = {
  parent_of: undefined,
  appeal_from: undefined,
  connected: '6 4',
  lower_court: '1.5 4',
};

export interface GraphEdgesProps {
  layout: Layout;
  /** Items whose edges are drawn in the accent. */
  highlighted: ReadonlySet<string>;
  appealLabel: string;
}

export function GraphEdges({ layout, highlighted, appealLabel }: GraphEdgesProps) {
  const marker = useId();
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-slot="graph-edges"
      width={layout.width + 24}
      height={layout.height}
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
        </marker>
      </defs>
      {layout.edges.map((edge) => {
        const active = highlighted.has(edge.source) || highlighted.has(edge.target);
        return (
          <g
            key={edge.id}
            data-edge-kind={edge.kind}
            className={active ? 'text-accent' : 'text-ink-muted'}
          >
            <path
              d={edge.path}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap={edge.kind === 'lower_court' ? 'round' : 'butt'}
              strokeDasharray={EDGE_DASH[edge.kind]}
              markerEnd={edge.kind === 'appeal_from' ? `url(#${marker})` : undefined}
              className={active ? 'motion-safe:animate-fade-in' : undefined}
            />
            {edge.kind === 'appeal_from' ? (
              <text
                x={edge.label.x}
                y={edge.label.y - 4}
                textAnchor="middle"
                className="fill-current text-[10px]"
              >
                {appealLabel}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
