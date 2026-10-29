'use client';
// A small accessible line chart (#85), plain SVG so the route stays light. Series are told apart by
// marker shape and line style as well as by their `--chart-N` colour (never colour alone), the
// gridlines sit at 10 percent ink, and the whole chart is one focusable group: the arrow keys move
// across the weeks and an `aria-live` line announces the values. It fades in once (400 ms; 100 ms
// under reduced motion); there is no looping animation.
import { useEffect, useId, useState } from 'react';

export interface ChartSeriesData {
  key: string;
  label: string;
  values: readonly (number | null)[];
  /** Which `--chart-N` token draws it. */
  color: 1 | 2 | 3;
}

export interface LineChartProps {
  title: string;
  description: string;
  /** One label per x position (the ISO weeks). */
  categories: readonly string[];
  series: readonly ChartSeriesData[];
  /** Scale bounds, default 1 to 5. */
  min?: number;
  max?: number;
  /** The announcement for the active x position. */
  announce: (category: string, values: { label: string; value: number | null }[]) => string;
}

const W = 320;
const H = 150;
const PAD = { left: 28, right: 10, top: 10, bottom: 22 };
const MARKERS = ['circle', 'square', 'triangle'] as const;
const DASHES = [undefined, '5 3', '2 3'] as const;

function Marker({
  shape,
  x,
  y,
  color,
}: {
  shape: (typeof MARKERS)[number];
  x: number;
  y: number;
  color: number;
}) {
  const fill = `var(--chart-${String(color)})`;
  if (shape === 'circle') return <circle cx={x} cy={y} r={3.5} fill={fill} />;
  if (shape === 'square') return <rect x={x - 3.5} y={y - 3.5} width={7} height={7} fill={fill} />;
  return (
    <polygon
      points={`${String(x)},${String(y - 4.5)} ${String(x + 4)},${String(y + 3.5)} ${String(x - 4)},${String(y + 3.5)}`}
      fill={fill}
    />
  );
}

export function LineChart({
  title,
  description,
  categories,
  series,
  min = 1,
  max = 5,
  announce,
}: LineChartProps) {
  const id = useId();
  const [active, setActive] = useState(categories.length - 1);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(true);
  }, []);

  const last = Math.max(categories.length - 1, 0);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (last === 0 ? plotW / 2 : (i / last) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH;
  const ticks = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const at = Math.min(Math.max(active, 0), last);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (step !== 0) setActive((a) => Math.min(Math.max(a + step, 0), last));
    else return;
    event.preventDefault();
  };

  const current = categories[at] ?? '';
  return (
    <div
      role="group"
      tabIndex={0}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      onKeyDown={onKeyDown}
      data-slot="insights-chart"
      className="focus-visible:outline-focus rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <p id={`${id}-t`} className="text-ink text-sm font-medium">
        {title}
      </p>
      <p id={`${id}-d`} className="sr-only">
        {description}
      </p>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        aria-hidden="true"
        className={`text-ink h-auto w-full transition-opacity duration-[400ms] ease-out motion-reduce:duration-100 ${shown ? 'opacity-100' : 'opacity-0'}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              strokeOpacity={0.1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {tick}
            </text>
          </g>
        ))}
        {categories.length > 0 ? (
          <line
            x1={x(at)}
            x2={x(at)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="currentColor"
            strokeOpacity={0.25}
          />
        ) : null}
        {series.map((s, si) => {
          const dash = DASHES[si % DASHES.length];
          const shape = MARKERS[si % MARKERS.length] ?? 'circle';
          const points = s.values.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)] as const]));
          return (
            <g key={s.key} data-series={s.key}>
              <polyline
                fill="none"
                stroke={`var(--chart-${String(s.color)})`}
                strokeWidth={2}
                {...(dash === undefined ? {} : { strokeDasharray: dash })}
                points={points.map(([px, py]) => `${String(px)},${String(py)}`).join(' ')}
              />
              {points.map(([px, py]) => (
                <Marker
                  key={`${String(px)}-${String(py)}`}
                  shape={shape}
                  x={px}
                  y={py}
                  color={s.color}
                />
              ))}
            </g>
          );
        })}
        {categories.map((category, i) =>
          i === 0 || i === last || categories.length <= 6 ? (
            <text
              key={category}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {category.slice(-3)}
            </text>
          ) : null,
        )}
      </svg>
      {series.length > 1 ? (
        <ul className="text-ink-muted flex flex-wrap gap-x-4 text-xs">
          {series.map((s, si) => (
            <li key={s.key} className="flex items-center gap-1">
              <svg width={14} height={10} aria-hidden="true">
                <Marker
                  shape={MARKERS[si % MARKERS.length] ?? 'circle'}
                  x={7}
                  y={5}
                  color={s.color}
                />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="text-ink-muted mt-1 min-h-4 text-xs">
        {categories.length === 0
          ? ''
          : announce(
              current,
              series.map((s) => ({ label: s.label, value: s.values[at] ?? null })),
            )}
      </p>
    </div>
  );
}
