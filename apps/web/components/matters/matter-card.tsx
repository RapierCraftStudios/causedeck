'use client';
// A matter in the phone list (#388, < 768 px): the serif title, `Petitioner v. Respondent` muted,
// the forum and the stage, and the canonical next date right-aligned with its relative day. The
// whole card is one link named `Open matter {title}, next date {date}`. The pieces shared with the
// table (lock badge, stage, next date) live here too. Status never relies on colour alone: every
// pill carries its word.
import { Badge } from '@causedeck/ui/badge';
import { STAGE_MAP, StageBadge, type Stage } from '@causedeck/ui/patterns';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { MatterRowView } from '../../lib/matters/graph-deps.ts';

/** Join class names, skipping empty values. */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

function isStage(value: string): value is Stage {
  return Object.hasOwn(STAGE_MAP, value);
}

/** The `Sensitive` lock badge (CA-10). */
export function SensitiveBadge() {
  const t = useTranslations('matters');
  return (
    <Badge tone="outline" data-matter-sensitive="" className="gap-1">
      <Lock aria-hidden="true" className="size-3" />
      {t('sensitive')}
    </Badge>
  );
}

/** The next-date listing's stage: a `StageBadge` for a known stage, else its printed text. */
export function MatterStage({ stage }: { stage: string | null }) {
  if (stage === null) return null;
  if (isStage(stage)) return <StageBadge stage={stage} />;
  return <span className="text-ink-muted text-xs">{stage}</span>;
}

/** The accessible name of a row: `Open matter {title}, next date {date}`. */
export function useRowName() {
  const t = useTranslations('matters');
  return (row: MatterRowView) =>
    t('row.open', { title: row.title, date: row.nextDate?.text ?? t('nextDate.none') });
}

/** `Petitioner v. Respondent`, or whichever side is known. */
export function useParties() {
  const t = useTranslations('matters');
  return (row: MatterRowView): string | null => {
    if (row.petitioner !== null && row.respondent !== null) {
      return t('row.versus', { petitioner: row.petitioner, respondent: row.respondent });
    }
    return row.petitioner ?? row.respondent;
  };
}

/** The canonical next date with its confirmation pill, or `No next date`. */
export function NextDate({
  nextDate,
  align = 'start',
}: {
  nextDate: MatterRowView['nextDate'];
  align?: 'start' | 'end';
}) {
  const t = useTranslations('matters');
  if (nextDate === null) {
    return <span className="text-ink-muted text-sm">{t('nextDate.none')}</span>;
  }
  return (
    <span
      data-matter-next-date=""
      className={cn('flex flex-col gap-0.5', align === 'end' ? 'items-end' : 'items-start')}
    >
      <span className="text-accent font-semibold tabular-nums">{nextDate.text}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-ink-muted text-xs tabular-nums">{nextDate.relative}</span>
        <Badge
          tone={nextDate.confirmed ? 'success' : 'warning'}
          data-confirmation={nextDate.confirmed ? 'confirmed' : 'proposed'}
        >
          {nextDate.confirmed ? t('nextDate.confirmed') : t('nextDate.toConfirm')}
        </Badge>
      </span>
    </span>
  );
}

export interface MatterCardProps {
  row: MatterRowView;
  index: number;
  active?: boolean;
}

export function MatterCard({ row, index, active = false }: MatterCardProps) {
  const t = useTranslations('matters');
  const nameOf = useRowName();
  const partiesOf = useParties();
  const parties = partiesOf(row);
  return (
    <li>
      <Link
        href={row.href}
        aria-label={nameOf(row)}
        data-matter-row={row.id}
        data-index={index}
        data-active={active ? '' : undefined}
        className={cn(
          'border-line bg-surface focus-visible:outline-ring flex flex-col gap-2 rounded-md border p-4 outline-none focus-visible:outline-2',
          active && 'border-accent',
        )}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-serif text-[17px] leading-6 font-medium wrap-break-word">
              {row.title}
            </span>
            {parties === null ? null : (
              <span className="text-ink-muted text-sm wrap-break-word">{parties}</span>
            )}
          </span>
          <NextDate nextDate={row.nextDate} align="end" />
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {row.forum === null ? null : <Badge tone="neutral">{row.forum}</Badge>}
          <MatterStage stage={row.stage} />
          {row.sensitive ? <SensitiveBadge /> : null}
        </span>
        <span className="text-ink-muted flex flex-wrap gap-x-3 text-xs tabular-nums">
          <span>{t('proceedings', { count: row.proceedingCount })}</span>
          <span>{row.owner ?? t('row.noOwner')}</span>
          <span>{t('row.updated', { date: row.updated })}</span>
        </span>
      </Link>
    </li>
  );
}
