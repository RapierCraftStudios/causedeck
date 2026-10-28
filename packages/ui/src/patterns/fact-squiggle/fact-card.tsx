import { Button } from '../../components/button';
import { cn } from '../../lib/cn';
import type { LucideIcon } from 'lucide-react';

export interface FactCardLabels {
  source: string;
  noSource: string;
  fix: string;
  ignore: string;
  ignoreForMatter: string;
  markAssertion: string;
  page: (page: number) => string;
  openPage: (page: number) => string;
}

export interface FactSource {
  document: string;
  page: number | null;
  quote: string;
  /** `[start, end)` inside `quote` to highlight. */
  highlight?: { start: number; end: number } | undefined;
}

export interface FactCardActions {
  onFix?: (() => void) | undefined;
  onIgnore?: (() => void) | undefined;
  onIgnoreForMatter?: (() => void) | undefined;
  onMarkAssertion?: (() => void) | undefined;
  onOpenPage?: ((page: number) => void) | undefined;
}

export interface FactCardBodyProps extends FactCardActions {
  status: string;
  /** The verdict text, e.g. "Does not match the record". */
  statusLabel: string;
  Icon: LucideIcon;
  /** Icon colour utility. */
  tone: string;
  source: FactSource | undefined;
  labels: FactCardLabels;
  titleId: string;
  /** Called after an action so the host closes the card. */
  onDone: () => void;
}

function Quote({ source }: { source: FactSource }) {
  const { quote, highlight } = source;
  const valid =
    highlight &&
    highlight.start >= 0 &&
    highlight.end > highlight.start &&
    highlight.end <= quote.length;
  return (
    <blockquote data-slot="fact-quote" className="text-md text-ink font-serif wrap-anywhere italic">
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

/** Verdict card content: icon plus text, the source quote and the four actions. */
export function FactCardBody({
  status,
  statusLabel,
  Icon,
  tone,
  source,
  labels,
  titleId,
  onFix,
  onIgnore,
  onIgnoreForMatter,
  onMarkAssertion,
  onOpenPage,
  onDone,
}: FactCardBodyProps) {
  const act = (fn: (() => void) | undefined) =>
    fn
      ? () => {
          fn();
          onDone();
        }
      : undefined;
  const actions: [string, (() => void) | undefined, 'primary' | 'secondary' | 'ghost'][] = [
    [labels.fix, act(onFix), 'secondary'],
    [labels.ignore, act(onIgnore), 'ghost'],
    [labels.ignoreForMatter, act(onIgnoreForMatter), 'ghost'],
    [labels.markAssertion, act(onMarkAssertion), 'ghost'],
  ];
  return (
    <div data-slot="fact-card" data-status={status} className="flex flex-col gap-3">
      <p id={titleId} className="text-ink flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', tone)} />
        <span className="min-w-0 wrap-break-word">{statusLabel}</span>
      </p>
      {source ? (
        <>
          <p className="text-ink-muted text-xs">{labels.source}</p>
          <Quote source={source} />
          <p
            data-slot="fact-meta"
            className="text-ink-muted flex flex-wrap items-center gap-x-1 text-xs"
          >
            <span className="wrap-anywhere">{source.document}</span>
            {source.page !== null ? (
              <>
                <span aria-hidden="true">·</span>
                {onOpenPage ? (
                  <button
                    type="button"
                    className="text-seal focus-visible:outline-ring underline outline-offset-2 focus-visible:outline-2"
                    aria-label={labels.openPage(source.page)}
                    onClick={() => {
                      onOpenPage(source.page ?? 0);
                    }}
                  >
                    {labels.page(source.page)}
                  </button>
                ) : (
                  <span>{labels.page(source.page)}</span>
                )}
              </>
            ) : null}
          </p>
        </>
      ) : (
        <p className="text-ink-muted text-xs">{labels.noSource}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {actions.map(([label, onClick, variant]) =>
          onClick ? (
            <Button key={label} size="sm" variant={variant} onClick={onClick}>
              {label}
            </Button>
          ) : null,
        )}
      </div>
    </div>
  );
}
