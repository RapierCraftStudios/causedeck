import { FileText } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';
import type { Anchor, AnchorImageRegion, ProvenanceKind, ProvenanceSource } from '../types';

export interface ProvenanceLabels {
  confirmed: string;
  proposed: string;
  edited: string;
  rejected: string;
  enteredByYou: string;
  openSource: string;
  reportWrong: string;
  /** Shown instead of the actions when the caller only has view access. */
  viewOnly: string;
  /** Why the actions are disabled while offline. */
  offline: string;
  /** Who produced the fact, by source kind (the footer meta). */
  origin: Record<ProvenanceKind, string>;
  page: (page: number, pageCount?: number) => string;
  confidence: (percent: number) => string;
  /** The chip's accessible name; it must contain the visible `label` (WCAG 2.5.3). */
  chip: (parts: {
    label: string;
    title: string;
    page?: number | undefined;
    state: string;
    confidence?: number | undefined;
  }) => string;
}

export const DEFAULT_PROVENANCE_LABELS: ProvenanceLabels = {
  confirmed: 'Confirmed',
  proposed: 'Proposed',
  edited: 'Edited',
  rejected: 'Rejected',
  enteredByYou: 'Entered by you',
  openSource: 'Open source',
  reportWrong: 'Report wrong',
  viewOnly: 'View only. You can read the source but not change it.',
  offline: 'You are offline. Reconnect to open the source.',
  origin: {
    document: 'Extracted by Lawyer OS',
    capture: 'Extracted by Lawyer OS',
    ai: 'Extracted by Lawyer OS',
    adapter: 'From the court record',
    import: 'Imported by you',
    system: 'Computed by Lawyer OS',
    manual: 'Entered by you',
  },
  page: (page, pageCount) =>
    pageCount ? `Page ${String(page)} of ${String(pageCount)}` : `Page ${String(page)}`,
  confidence: (percent) => `${String(percent)}% confidence`,
  chip: ({ label, title, page, state, confidence }) =>
    [
      // axe ignores parentheticals when matching the visible label, so no brackets here.
      `Source: ${title.includes(label) ? '' : `${label}, from `}${title}${
        page === undefined ? '' : `, page ${String(page)}`
      }.`,
      `${state}.`,
      confidence === undefined ? '' : `${String(confidence)}% confidence.`,
    ]
      .filter(Boolean)
      .join(' '),
};

/** Confidence is worth showing when it is below 90% or the fact is still a proposal. */
export function showsConfidence(source: ProvenanceSource): boolean {
  return (
    source.state === 'proposed' || (source.confidence !== undefined && source.confidence < 0.9)
  );
}

export const confidencePercent = (confidence: number): number => Math.round(confidence * 100);

/** The quote with its matched span marked by an accent-soft marker underline. */
export function HighlightedQuote({
  quote,
  highlight,
}: {
  quote: string;
  highlight?: Anchor['highlight'] | undefined;
}) {
  const valid =
    highlight &&
    highlight.start >= 0 &&
    highlight.end > highlight.start &&
    highlight.end <= quote.length;
  return (
    <blockquote
      data-slot="provenance-quote"
      className="text-md text-ink font-serif wrap-anywhere italic"
    >
      {valid ? (
        <>
          {quote.slice(0, highlight.start)}
          <mark className="text-ink decoration-accent-soft bg-transparent underline decoration-[0.45em] underline-offset-[-0.2em] [text-decoration-skip-ink:none] forced-colors:decoration-current">
            {quote.slice(highlight.start, highlight.end)}
          </mark>
          {quote.slice(highlight.end)}
        </>
      ) : (
        quote
      )}
    </blockquote>
  );
}

/** Context kept around the line, as a fraction of the page. */
const REGION_MARGIN_X = 0.03;
const REGION_MARGIN_Y = 0.02;
const A4_ASPECT = 210 / 297;

/** The photographed line, cropped out of the page image with the line itself outlined (#52). */
export function ImageRegion({ region }: { region: AnchorImageRegion }) {
  const [x0, y0, x1, y1] = region.bbox;
  const aspect = region.aspect ?? A4_ASPECT;
  const cx0 = Math.max(0, x0 - REGION_MARGIN_X);
  const cy0 = Math.max(0, y0 - REGION_MARGIN_Y);
  const cx1 = Math.min(1, x1 + REGION_MARGIN_X);
  const cy1 = Math.min(1, y1 + REGION_MARGIN_Y);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  const pct = (value: number) => `${String(value * 100)}%`;
  return (
    <div
      data-slot="provenance-image-region"
      role="img"
      aria-label={region.alt ?? ''}
      className="border-line bg-surface-sunken relative w-full overflow-hidden rounded-md border"
      style={{ aspectRatio: String((cw * aspect) / ch) }}
    >
      <img
        src={region.src}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        style={{ width: pct(1 / cw), left: pct(-cx0 / cw), top: pct(-cy0 / ch) }}
      />
      <div
        data-slot="provenance-image-highlight"
        aria-hidden="true"
        className="border-seal absolute rounded-sm border-2 forced-colors:border-[Highlight]"
        style={{
          left: pct((x0 - cx0) / cw),
          top: pct((y0 - cy0) / ch),
          width: pct((x1 - x0) / cw),
          height: pct((y1 - y0) / ch),
        }}
      />
    </div>
  );
}

export interface ProvenancePopoverBodyProps extends Omit<ComponentProps<'div'>, 'title'> {
  source: ProvenanceSource;
  anchor?: Anchor | undefined;
  labels?: Partial<ProvenanceLabels> | undefined;
  onOpenSource?: (() => void) | undefined;
  onReportWrong?: (() => void) | undefined;
  /** Read-only while offline: actions stay visible but disabled, with the reason. */
  offline?: boolean | undefined;
  /** Permission denied: actions are hidden and a view-only note is shown. */
  viewOnly?: boolean | undefined;
  /** Element used for the title (the sheet passes its accessible title). */
  renderTitle?: (title: string) => ReactNode;
}

/**
 * What the chip opens: document title, the quoted source text, page and origin meta, and the
 * `Open source` / `Report wrong` callbacks. Shared by the pointer popover and the mobile sheet.
 */
export function ProvenancePopoverBody({
  source,
  anchor,
  labels,
  onOpenSource,
  onReportWrong,
  offline = false,
  viewOnly = false,
  renderTitle,
  className,
  ...props
}: ProvenancePopoverBodyProps) {
  const text = { ...DEFAULT_PROVENANCE_LABELS, ...labels };
  const manual = source.kind === 'manual';
  const title = anchor?.documentTitle ?? (manual ? text.enteredByYou : source.label);
  const quote = anchor?.quote ?? source.quote;
  const page = anchor?.page ?? source.page;
  const meta = [
    page === undefined ? undefined : text.page(page, anchor?.pageCount),
    text.origin[source.kind],
    source.confidence === undefined || manual
      ? undefined
      : text.confidence(confidencePercent(source.confidence)),
  ].filter((part): part is string => part !== undefined);
  const hasActions = Boolean(onOpenSource ?? onReportWrong);

  return (
    <div
      data-slot="provenance-popover"
      className={cn('flex flex-col gap-3 text-sm', className)}
      {...props}
    >
      <div className="text-ink flex items-center gap-2 font-medium">
        <FileText aria-hidden="true" className="text-ink-muted size-4 shrink-0" />
        {renderTitle ? (
          renderTitle(title)
        ) : (
          <span className="min-w-0 wrap-break-word">{title}</span>
        )}
      </div>
      {anchor?.imageRegion ? <ImageRegion region={anchor.imageRegion} /> : null}
      {quote ? <HighlightedQuote quote={quote} highlight={anchor?.highlight} /> : null}
      <p data-slot="provenance-meta" className="text-ink-muted text-xs">
        {meta.join(' · ')}
      </p>
      {viewOnly ? (
        <p data-slot="provenance-view-only" className="text-ink-muted text-xs">
          {text.viewOnly}
        </p>
      ) : hasActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {onOpenSource ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={offline}
              title={offline ? text.offline : undefined}
              onClick={onOpenSource}
            >
              {text.openSource}
            </Button>
          ) : null}
          {onReportWrong ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={offline}
              title={offline ? text.offline : undefined}
              onClick={onReportWrong}
            >
              {text.reportWrong}
            </Button>
          ) : null}
        </div>
      ) : null}
      {offline && !viewOnly && hasActions ? (
        <p data-slot="provenance-offline" className="text-ink-muted text-xs">
          {text.offline}
        </p>
      ) : null}
    </div>
  );
}
