'use client';

// The studio's Citations panel (#828, #1137): every citation found in the draft with its verified,
// not found or unknown state (`CitationStatus`, glyph plus text), why a citation is not verified
// (unresolved, quote not in the judgment, no such paragraph or page, no such section, …), a link to
// the corpus source (`#page=` when the pinpoint page is known), a jump to its span, and `Check
// citations`. Every non-verified citation nobody acknowledged blocks the export; the panel says so
// and opens the acknowledgement dialog. The corpus link opens the public source in a new tab.
import { Button } from '@causedeck/ui/button';
import { CitationStatus, type CitationStatusKind } from '@causedeck/ui/patterns';
import type { CitationReason } from '@causedeck/validators/citation';
import { useTranslations } from 'next-intl';

export interface CitationView {
  id: string;
  /** Block key of the paragraph the citation sits in. */
  blockId: string;
  raw: string;
  status: CitationStatusKind;
  title?: string | undefined;
  /** Why the citation is not verified; a not-found citation without one is unresolved. */
  reason?: CitationReason | undefined;
  /** The judgment or statute in the corpus. */
  sourceUrl?: string | undefined;
  /** The pinpoint page, when known: the link opens the source at it. */
  page?: number | undefined;
  /** A non-verified citation the lawyer has acknowledged. */
  acknowledged: boolean;
}

/** Non-verified citations nobody acknowledged: they block the export until acknowledged. */
export function openCitationIds(citations: readonly CitationView[]): string[] {
  return citations.filter((c) => c.status !== 'verified' && !c.acknowledged).map((c) => c.id);
}

/** The reason copy key of a non-verified citation, or null for a verified one. */
function reasonKey(citation: CitationView): CitationReason | 'unresolved' | 'unknown' | null {
  if (citation.status === 'verified') return null;
  if (citation.reason !== undefined) return citation.reason;
  return citation.status === 'not_found' ? 'unresolved' : 'unknown';
}

function sourceHref(citation: CitationView): string | null {
  if (citation.sourceUrl === undefined) return null;
  return citation.page === undefined
    ? citation.sourceUrl
    : `${citation.sourceUrl}#page=${String(citation.page)}`;
}

export interface CitationPanelProps {
  citations: readonly CitationView[];
  checking?: boolean;
  /** Offline or read-only: no new check or acknowledgement. */
  disabled?: boolean;
  failed?: boolean;
  onCheck: () => void;
  onJump: (blockKey: string) => void;
  onAcknowledge: () => void;
}

const STATUS_KEY = {
  verified: 'verified',
  not_found: 'notFound',
  unknown: 'unknown',
} as const satisfies Record<CitationStatusKind, string>;

export function CitationPanel({
  citations,
  checking = false,
  disabled = false,
  failed = false,
  onCheck,
  onJump,
  onAcknowledge,
}: CitationPanelProps) {
  const t = useTranslations('drafting.panels.citations');
  const tc = useTranslations('drafting.checks.citations');
  const open = openCitationIds(citations).length;
  return (
    <section
      data-slot="citation-panel"
      aria-labelledby="citation-panel-title"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="citation-panel-title" className="text-sm font-semibold">
          {t('title')}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ms-auto"
          disabled={disabled || checking}
          onClick={onCheck}
        >
          {checking ? tc('checking') : t('check')}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-danger text-sm">
          {tc('checkFailed')}
        </p>
      ) : null}
      {citations.length === 0 ? <p className="text-ink-muted text-sm">{t('empty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {citations.map((citation) => {
          const reason = reasonKey(citation);
          const href = sourceHref(citation);
          return (
            <li
              key={citation.id}
              data-citation-id={citation.id}
              className="border-line flex flex-col gap-1 rounded-md border p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <CitationStatus
                  status={citation.status}
                  label={t(`status.${STATUS_KEY[citation.status]}`)}
                />
                {citation.acknowledged ? (
                  <span className="text-ink-muted text-xs">{tc('acknowledged')}</span>
                ) : null}
              </div>
              <span className="text-sm">{citation.raw}</span>
              {citation.title === undefined ? null : (
                <span className="text-ink-muted text-xs">{citation.title}</span>
              )}
              {reason === null ? null : (
                <span data-slot="citation-reason" className="text-ink-muted text-xs">
                  {tc(`reason.${reason}`)}
                </span>
              )}
              {href === null ? null : (
                <a
                  className="self-start text-xs underline"
                  href={href}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {tc('openSource')}
                </a>
              )}
              <Button
                type="button"
                size="sm"
                variant="link"
                className="self-start"
                onClick={() => {
                  onJump(citation.blockId);
                }}
              >
                {tc('jump', { citation: citation.raw })}
              </Button>
            </li>
          );
        })}
      </ul>
      {open > 0 ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-warn text-sm">{tc('blocked', { count: open })}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={disabled}
            onClick={onAcknowledge}
          >
            {tc('acknowledge')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
