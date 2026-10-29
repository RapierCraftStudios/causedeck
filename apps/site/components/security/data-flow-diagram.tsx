// Data-flow diagram as inline SVG: tokens only, so it works in light and dark, with a role, title
// and description as its text alternative. Static: nothing animates, so reduced motion is moot.
import type { SecurityCopy } from '../../content/security.ts';

function Node({
  x,
  y,
  width,
  label,
  muted = false,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  muted?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={64}
        rx={10}
        className={
          muted ? 'fill-surface-sunken stroke-line-strong' : 'fill-surface-raised stroke-accent'
        }
        strokeWidth={1.5}
        strokeDasharray={muted ? '5 4' : undefined}
      />
      <foreignObject x={x + 8} y={y + 6} width={width - 16} height={52}>
        <p className="text-ink flex h-full items-center justify-center text-center text-xs leading-snug">
          {label}
        </p>
      </foreignObject>
    </g>
  );
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className="stroke-ink-muted"
      strokeWidth={1.5}
      markerEnd="url(#cd-arrow)"
    />
  );
}

export function DataFlowDiagram({ copy }: { copy: SecurityCopy }) {
  const { diagramNodes: n } = copy;
  return (
    <figure className="my-8">
      <svg
        role="img"
        aria-labelledby="flow-title flow-desc"
        viewBox="0 0 720 250"
        className="h-auto w-full"
      >
        <title id="flow-title">{copy.diagramTitle}</title>
        <desc id="flow-desc">{copy.diagramDescription}</desc>
        <defs>
          <marker
            id="cd-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 z" className="fill-ink-muted" />
          </marker>
        </defs>
        <Node x={10} y={20} width={200} label={n.device} />
        <Node x={260} y={20} width={200} label={n.app} />
        <Node x={510} y={20} width={200} label={n.ai} />
        <Arrow x1={210} y1={52} x2={258} y2={52} />
        <Arrow x1={460} y1={52} x2={508} y2={52} />
        <text x={234} y={44} textAnchor="middle" className="fill-ink-subtle text-[10px]">
          TLS
        </text>
        <rect
          x={248}
          y={6}
          width={472}
          height={92}
          rx={12}
          className="stroke-success fill-none"
          strokeDasharray="4 4"
        />
        <text x={720} y={112} textAnchor="end" className="fill-ink-muted text-[11px]">
          {copy.diagramLegend}
        </text>
        <Node x={260} y={150} width={200} label={n.site} muted />
      </svg>
      <figcaption className="text-ink-muted mt-2 text-sm">{copy.diagramDescription}</figcaption>
    </figure>
  );
}
