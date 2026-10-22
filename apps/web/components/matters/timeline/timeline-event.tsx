'use client';
// One event of the timeline (#41): the date (tabular), the kind icon, a one-line summary in the
// editorial serif, the proceeding it belongs to, its Provenance Chip and, for facts not yet
// confirmed, a `To confirm` pill so a proposal is never styled as fact. Past events are in normal
// ink, future ones muted with a dotted connector; orders and state changes carry a heavier icon
// weight than documents. The chip opens the source quote and page; "Open source" (revealed on
// hover and focus, always reachable by keyboard) opens `DocumentPreviewSheet` at that page. Bench
// shows only as a change of composition: no counts, no per-judge figures anywhere here.
import { ProvenanceChip } from '@causedeck/ui/patterns';
import {
  Gavel,
  FileText,
  GitBranch,
  ListChecks,
  Paperclip,
  Scale,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { TimelineEventView } from '../../../lib/matters/timeline.ts';
import {
  QUALIFIER_KEYS,
  isQualifier,
  type TimelineKind,
} from '../../../lib/matters/timeline-tab.ts';
import { STATE_KEYS } from '../graph/graph-node.tsx';
import { cn } from '../matter-card.tsx';

export const KIND_ICONS: Record<TimelineKind, LucideIcon> = {
  listing: Scale,
  hearing: Gavel,
  order: FileText,
  obligation_due: ListChecks,
  obligation_closed: ListChecks,
  state_change: GitBranch,
  document_added: Paperclip,
  bench_change: Users,
};

/** Orders and state changes outweigh documents. */
const HEAVY: ReadonlySet<TimelineKind> = new Set(['order', 'state_change']);

function isState(value: string | null): value is keyof typeof STATE_KEYS {
  return value !== null && value in STATE_KEYS;
}

/** The kind label for the event's icon (for screen readers) and the lanes' headings. */
export function useEventSummary(event: TimelineEventView): string {
  const t = useTranslations('matterTimeline');
  const tense = event.future ? 'future' : 'past';
  const subject = event.subject ?? '';
  const qualifier = isQualifier(event.qualifier) ? t(QUALIFIER_KEYS[event.qualifier]) : '';
  switch (event.kind) {
    case 'listing':
      return t('summary.listing', { tense, subject });
    case 'hearing':
      return t('summary.hearing', { hasSubject: subject === '' ? 'no' : 'yes', subject });
    case 'order':
      return t('summary.order', { qualifier });
    case 'obligation_due':
      return t('summary.obligationDue', { tense, subject });
    case 'obligation_closed':
      return t('summary.obligationClosed', { subject });
    case 'state_change':
      return t('summary.stateChange', {
        from: isState(event.fromState) ? t(STATE_KEYS[event.fromState]) : '',
        to: isState(event.toState) ? t(STATE_KEYS[event.toState]) : '',
      });
    case 'document_added':
      return t('summary.documentAdded', { qualifier });
    case 'bench_change':
      return t('summary.benchChange');
  }
}

export interface TimelineEventCardProps {
  event: TimelineEventView;
  /** Offline: the source still opens, nothing else changes. */
  offline?: boolean | undefined;
  /** Lanes: the proceeding chip is redundant under a lane heading. */
  hideProceeding?: boolean | undefined;
  className?: string | undefined;
}

export function TimelineEventCard({
  event,
  offline,
  hideProceeding,
  className,
}: TimelineEventCardProps) {
  const t = useTranslations('matterTimeline');
  const router = useRouter();
  const summary = useEventSummary(event);
  const Icon = KIND_ICONS[event.kind];
  const detail = event.kind === 'state_change' ? event.subject : null;
  return (
    <article
      data-event-id={event.id}
      data-kind={event.kind}
      data-future={event.future ? '' : undefined}
      data-proposed={event.proposed ? '' : undefined}
      className={cn(
        'group border-line bg-surface-elevated relative flex min-w-0 flex-col gap-1.5 rounded-lg border p-3',
        'motion-safe:transition-opacity',
        event.future && 'text-ink-muted border-dashed',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            'mt-0.5 size-4 shrink-0',
            HEAVY.has(event.kind) ? 'stroke-[2.5]' : 'stroke-[1.5]',
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <time dateTime={event.date} className="text-ink-muted text-xs tabular-nums">
            {event.dateText}
          </time>
          <p className="max-w-[72ch] font-serif text-[15px] leading-[22px]" dir="auto">
            {summary}
          </p>
          {detail === null || detail === '' ? null : (
            <p className="text-ink-muted max-w-[72ch] text-sm" dir="auto">
              {detail}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hideProceeding || event.proceedingLabel === null ? null : (
          <span className="border-line text-ink-muted rounded-full border px-2 text-xs tabular-nums">
            {event.proceedingLabel}
          </span>
        )}
        {event.proposed ? (
          <span
            data-slot="to-confirm"
            className="bg-warning-soft text-warning rounded-full px-2 text-xs font-medium"
          >
            {t('event.toConfirm')}
          </span>
        ) : null}
        <ProvenanceChip
          source={event.source}
          anchor={event.anchor ?? undefined}
          offline={offline}
          onOpenSource={
            event.openSourceHref === null
              ? undefined
              : () => {
                  if (event.openSourceHref !== null) router.push(event.openSourceHref);
                }
          }
        />
        {event.openSourceHref === null ? null : (
          <Link
            href={event.openSourceHref}
            className={cn(
              'text-accent text-sm underline-offset-4 hover:underline',
              'pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center',
              'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
            )}
          >
            {t('event.openSource')}
          </Link>
        )}
      </div>
    </article>
  );
}
