'use client';
// Statement lines of the Brief Sheet (#61): every statement renders through `ProvenanceLink`, which
// throws for a line without provenance, so an unsourced statement cannot reach the page.
import { ProvenanceLink, type SourcedLine } from '@causedeck/ui/patterns';
import type { BriefLine, ObligationLine } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useBriefProvenanceLabels } from './use-provenance-labels.ts';

/** Where a line's chip points: a page-anchored document link, when the line has an anchor. */
export function sourceLabelOf(
  line: Pick<SourcedLine, 'source_type' | 'source_ref'>,
  fallback: string,
) {
  return line.source_ref ?? fallback;
}

export function StatementLine({
  line,
  fallbackLabel,
  offline,
  viewOnly,
  children,
}: {
  line: BriefLine;
  fallbackLabel: string;
  offline: boolean;
  viewOnly: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('brief.line');
  const labels = useBriefProvenanceLabels();
  const lang = /[஀-௿]/.test(line.text) ? 'ta' : /[ಀ-೿]/.test(line.text) ? 'kn' : undefined;
  return (
    <p data-statement className="break-inside-avoid">
      <span lang={lang}>{line.text}</span>{' '}
      {line.label ? (
        <span className="text-muted-foreground font-sans text-xs italic">{`(${line.label === 'Unconfirmed' ? t('unconfirmed') : line.label})`}</span>
      ) : null}{' '}
      <ProvenanceLink
        line={line}
        sourceLabel={sourceLabelOf(line, fallbackLabel)}
        labels={labels}
        offline={offline}
        viewOnly={viewOnly}
      />
      {children}
    </p>
  );
}

export function ObligationRow({
  line,
  owner,
  fallbackLabel,
  offline,
  viewOnly,
}: {
  line: ObligationLine;
  owner: string | null;
  fallbackLabel: string;
  offline: boolean;
  viewOnly: boolean;
}) {
  const t = useTranslations('brief.line');
  const labels = useBriefProvenanceLabels();
  return (
    <li data-obligation className="break-inside-avoid">
      <span>{line.text}</span>
      {owner ? <span className="text-muted-foreground">{` · ${owner}`}</span> : null}
      {line.due_date ? (
        <span className="text-muted-foreground">{` · ${t('dueOn', { date: line.due_date })}`}</span>
      ) : null}
      {line.overdue ? (
        <span className="text-destructive font-sans text-xs font-medium">{` ${t('overdue')}`}</span>
      ) : null}{' '}
      <ProvenanceLink
        line={{ ...line, page_no: null, quote: null }}
        sourceLabel={line.source_ref ?? fallbackLabel}
        labels={labels}
        offline={offline}
        viewOnly={viewOnly}
      />
    </li>
  );
}
