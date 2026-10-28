'use client';

// The studio's Citations panel (#828): every citation found in the draft with its verified, not
// found or unknown state (`CitationStatus`, glyph plus text), a jump to its span, and `Check
// citations`. Not-found citations nobody acknowledged block the export; the panel says so and
// opens the acknowledgement dialog. Nothing here leaves the app.
import { Button } from '@causedeck/ui/button';
import { CitationStatus, type CitationStatusKind } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';

export interface CitationView {
  id: string;
  /** Block key of the paragraph the citation sits in. */
  blockId: string;
  raw: string;
  status: CitationStatusKind;
  title?: string | undefined;
  /** A not-found citation the lawyer has acknowledged. */
  acknowledged: boolean;
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
  const open = citations.filter((c) => c.status === 'not_found' && !c.acknowledged).length;
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
        {citations.map((citation) => (
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
        ))}
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
