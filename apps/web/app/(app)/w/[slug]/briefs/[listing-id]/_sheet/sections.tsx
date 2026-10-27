'use client';
// The sections of the sheet (#61, R1) in PRD PR-1 order. Each statement goes through
// `StatementLine`, so each carries a Provenance Chip (a footnote in print).
import { SectionLabel } from '@causedeck/ui/patterns';
import type { Brief } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { CarrySection } from './carry-section.tsx';
import { ObligationRow, StatementLine } from './lines.tsx';
import { sectionDomId, type SectionKey } from './model.ts';
import { PrintToggle } from './print-toggle.tsx';
import { sectionLabelKey } from './section-index.tsx';
import { SynopsisSection } from './synopsis-section.tsx';

export interface SectionsProps {
  workspaceId: string;
  listingId: string;
  brief: Brief;
  keys: readonly SectionKey[];
  members: Record<string, string>;
  canWrite: boolean;
  offline: boolean;
  printNotes: boolean;
  onPrintNotes: (next: boolean) => void;
  /** Section keys whose data failed to load, for the section-level error state. */
  failed?: readonly SectionKey[];
}

function Section({
  id,
  title,
  children,
  className,
}: {
  id: SectionKey;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const dom = sectionDomId(id);
  return (
    <section
      id={dom}
      aria-labelledby={`${dom}-h`}
      tabIndex={-1}
      data-section={id}
      className={`mb-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 print:mb-3 print:break-inside-avoid ${className ?? ''}`}
    >
      <SectionLabel id={`${dom}-h`} className="mb-1.5">
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

export function Sections({
  workspaceId,
  listingId,
  brief,
  keys,
  members,
  canWrite,
  offline,
  printNotes,
  onPrintNotes,
  failed = [],
}: SectionsProps) {
  const t = useTranslations('brief');
  const viewOnly = !canWrite;
  const none = <p className="text-muted-foreground">{t('empty.section')}</p>;
  const line = { fallbackLabel: t('provenance.source'), offline, viewOnly };

  const body = (key: SectionKey): ReactNode => {
    if (failed.includes(key)) {
      return (
        <p role="alert" className="text-destructive font-sans text-sm">
          {t('error.section')}
        </p>
      );
    }
    switch (key) {
      case 'stage':
        return brief.stage ? <StatementLine line={brief.stage} {...line} /> : none;
      case 'last_order':
        return brief.last_order.length === 0 ? (
          none
        ) : (
          <div className="grid gap-1.5">
            {brief.last_order.map((l, i) => (
              <StatementLine key={`${l.text}-${String(i)}`} line={l} {...line} />
            ))}
          </div>
        );
      case 'obligations':
        return (
          <div className="grid gap-1">
            {brief.obligations.open.length === 0 ? (
              none
            ) : (
              <ul className="grid list-disc gap-1 pl-5">
                {brief.obligations.open.map((o) => (
                  <ObligationRow
                    key={o.obligation_id}
                    line={o}
                    owner={o.owner_member_id ? (members[o.owner_member_id] ?? null) : null}
                    {...line}
                  />
                ))}
              </ul>
            )}
            <p className="text-muted-foreground font-sans text-xs print:text-black">
              {t('line.closedCount', { count: brief.obligations.closed_count })}
            </p>
          </div>
        );
      case 'carry':
        return (
          <CarrySection
            workspaceId={workspaceId}
            listingId={listingId}
            items={brief.carry}
            reviewed={brief.carry_reviewed}
            canWrite={canWrite}
            offline={offline}
          />
        );
      case 'synopsis':
        return brief.synopsis ? (
          <SynopsisSection
            workspaceId={workspaceId}
            listingId={listingId}
            matterId={brief.matter_id}
            synopsis={brief.synopsis}
            note={brief.note}
            canWrite={canWrite}
            offline={offline}
            fallbackLabel={line.fallbackLabel}
          />
        ) : (
          none
        );
      case 'last_hearing':
        return brief.last_hearing ? <StatementLine line={brief.last_hearing} {...line} /> : none;
      case 'court_notes':
        return (
          <div className="grid gap-1.5">
            <PrintToggle workspaceId={workspaceId} checked={printNotes} onChange={onPrintNotes} />
            {(brief.court_notes ?? []).length === 0
              ? none
              : (brief.court_notes ?? []).map((l, i) => (
                  <StatementLine key={`${l.text}-${String(i)}`} line={l} {...line} />
                ))}
          </div>
        );
      case 'context':
        return brief.context.length === 0 ? (
          none
        ) : (
          <ul className="grid gap-1.5">
            {brief.context.map((p) => (
              <li
                key={`${p.document_id}-${String(p.page_no)}-${p.quote.slice(0, 24)}`}
                className="break-inside-avoid"
              >
                <blockquote className="border-border border-l-2 pl-3">{p.quote}</blockquote>
                <span className="text-muted-foreground font-sans text-xs print:text-black">
                  {t('line.page', { page: p.page_no })}
                </span>
              </li>
            ))}
          </ul>
        );
    }
  };

  return (
    <>
      {keys.map((key) => (
        <Section
          key={key}
          id={key}
          title={t(`sections.${sectionLabelKey(key)}`)}
          className={key === 'court_notes' && !printNotes ? 'print:hidden' : ''}
        >
          {body(key)}
        </Section>
      ))}
    </>
  );
}
