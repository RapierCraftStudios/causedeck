import {
  createContext,
  use,
  useId,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Legend, ResponsiveContainer, Tooltip } from 'recharts';

import { cn } from '../../lib/cn';

/** The eight categorical chart tokens (`--chart-1` ... `--chart-8`). */
export type ChartColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ChartSeries {
  label: ReactNode;
  /** Which `--chart-N` token draws this series. */
  color: ChartColor;
  icon?: ComponentType<{ className?: string }>;
}

/**
 * Series keyed by data key. Each key gets a `--color-<key>` custom property on the container, so
 * Recharts elements take `fill="var(--color-hearings)"` and follow light and dark themes.
 */
export type ChartConfig = Record<string, ChartSeries>;

const ChartContext = createContext<ChartConfig | null>(null);

export function useChartConfig(): ChartConfig {
  const config = use(ChartContext);
  if (config === null) throw new Error('useChartConfig must be used inside <ChartContainer>');
  return config;
}

/** CSS custom properties for each series: `--color-<key>: var(--chart-N)`. */
export function chartStyle(config: ChartConfig): CSSProperties {
  const style: Record<string, string> = {};
  for (const [key, series] of Object.entries(config)) {
    style[`--color-${key}`] = `var(--chart-${String(series.color)})`;
  }
  return style;
}

export interface ChartContainerProps extends Omit<ComponentProps<'figure'>, 'children' | 'title'> {
  config: ChartConfig;
  /** Accessible name of the chart (rendered as a visually hidden caption). */
  title: string;
  /** A single Recharts chart (`<BarChart>`, `<LineChart>`, ...). */
  children: ComponentProps<typeof ResponsiveContainer>['children'];
  /** Optional accessible alternative, e.g. `<ChartDataTable>`, rendered after the chart. */
  fallback?: ReactNode;
}

/**
 * Recharts wrapper themed with the `--chart-*` tokens: axes, grid and cursor use the ink and line
 * tokens. Recharts' `isAnimationActive="auto"` default already skips animation under
 * `prefers-reduced-motion`.
 */
export function ChartContainer({
  config,
  title,
  fallback,
  className,
  style,
  children,
  ...props
}: ChartContainerProps) {
  const id = useId();
  return (
    <ChartContext value={config}>
      <figure
        data-slot="chart"
        data-chart={id}
        aria-label={title}
        className={cn(
          'text-ink-muted flex aspect-video w-full flex-col font-sans text-xs',
          '[&_.recharts-cartesian-axis-tick_text]:fill-ink-muted',
          '[&_.recharts-cartesian-grid_line]:stroke-line',
          '[&_.recharts-curve.recharts-tooltip-cursor]:stroke-line-strong',
          '[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-surface-sunken',
          '[&_.recharts-polar-grid_[stroke]]:stroke-line',
          '[&_.recharts-reference-line_[stroke]]:stroke-line-strong',
          '[&_.recharts-dot[stroke]]:stroke-surface',
          '[&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden',
          '[&_.recharts-wrapper:focus-visible]:outline-ring [&_.recharts-wrapper:focus-visible]:outline-2',
          className,
        )}
        style={{ ...chartStyle(config), ...style }}
        {...props}
      >
        <figcaption className="sr-only">{title}</figcaption>
        <div className="min-h-0 flex-1">
          <ResponsiveContainer>{children}</ResponsiveContainer>
        </div>
        {fallback}
      </figure>
    </ChartContext>
  );
}

export const ChartTooltip = Tooltip;
export const ChartLegend = Legend;

/** One entry of the payload Recharts passes to custom tooltip and legend content. */
export interface ChartPayloadItem {
  dataKey?: string | number | ((obj: never) => unknown);
  name?: string | number;
  value?: string | number | ReadonlyArray<string | number>;
  color?: string;
}

function seriesKey(item: ChartPayloadItem): string {
  if (typeof item.dataKey === 'string' || typeof item.dataKey === 'number') {
    return String(item.dataKey);
  }
  return String(item.name ?? '');
}

export interface ChartTooltipContentProps {
  /** Injected by Recharts. */
  active?: boolean;
  payload?: ReadonlyArray<ChartPayloadItem>;
  label?: ReactNode;
  hideLabel?: boolean;
  labelFormatter?: (label: ReactNode) => ReactNode;
  valueFormatter?: (value: ChartPayloadItem['value'], key: string) => ReactNode;
  className?: string;
}

/** Tooltip body: the category label, then a dot, series label and value per series. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
  labelFormatter,
  valueFormatter,
  className,
}: ChartTooltipContentProps) {
  const config = useChartConfig();
  if (active !== true || payload === undefined || payload.length === 0) return null;
  return (
    <div
      data-slot="chart-tooltip"
      className={cn(
        'border-line bg-surface-overlay text-ink shadow-2 grid min-w-32 gap-1.5 rounded-md border px-3 py-2 text-xs',
        className,
      )}
    >
      {hideLabel ? null : (
        <div className="font-medium">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      {payload.map((item) => {
        const key = seriesKey(item);
        const series = config[key];
        return (
          <div key={key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-xs bg-(color:--dot) forced-colors:bg-[CanvasText]"
              style={{ '--dot': series ? `var(--color-${key})` : item.color } as CSSProperties}
            />
            <span className="text-ink-muted flex-1">{series?.label ?? item.name}</span>
            <span className="font-mono tabular-nums">
              {valueFormatter ? valueFormatter(item.value, key) : item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface ChartLegendContentProps {
  /** Injected by Recharts. */
  payload?: ReadonlyArray<ChartPayloadItem>;
  className?: string;
}

/** Legend: series icon (or colour swatch) and label from the config. */
export function ChartLegendContent({ payload, className }: ChartLegendContentProps) {
  const config = useChartConfig();
  if (payload === undefined || payload.length === 0) return null;
  return (
    <ul
      data-slot="chart-legend"
      className={cn('flex flex-wrap items-center justify-center gap-4 pt-3', className)}
    >
      {payload.map((item) => {
        const key = seriesKey(item);
        const series = config[key];
        const Icon = series?.icon;
        return (
          <li
            key={key}
            className="text-ink-muted flex items-center gap-1.5"
            style={{ '--dot': series ? `var(--color-${key})` : item.color } as CSSProperties}
          >
            {Icon ? (
              <Icon className="size-3 text-(color:--dot)" />
            ) : (
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-xs bg-(color:--dot) forced-colors:bg-[CanvasText]"
              />
            )}
            <span>{series?.label ?? item.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface ChartDataTableProps extends Omit<ComponentProps<'table'>, 'children'> {
  data: ReadonlyArray<Record<string, string | number>>;
  /** Category column (e.g. `month`). */
  categoryKey: string;
  categoryLabel: ReactNode;
  caption?: ReactNode;
  /** Show the table instead of keeping it for screen readers only. */
  visible?: boolean;
}

/** The chart's data as a table: an accessible alternative to the graphic. */
export function ChartDataTable({
  data,
  categoryKey,
  categoryLabel,
  caption,
  visible = false,
  className,
  ...props
}: ChartDataTableProps) {
  const config = useChartConfig();
  const keys = Object.keys(config);
  return (
    <table
      data-slot="chart-data-table"
      className={cn(visible ? 'w-full text-start text-xs' : 'sr-only', className)}
      {...props}
    >
      {caption === undefined ? null : <caption>{caption}</caption>}
      <thead>
        <tr>
          <th scope="col">{categoryLabel}</th>
          {keys.map((key) => (
            <th key={key} scope="col">
              {config[key]?.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={String(row[categoryKey])}>
            <th scope="row">{row[categoryKey]}</th>
            {keys.map((key) => (
              <td key={key}>{row[key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
