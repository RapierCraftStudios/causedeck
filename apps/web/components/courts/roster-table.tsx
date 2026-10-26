'use client';

// The rosters of one forum (#435, part 2 of #391): a card per confirmed version (effective-from as a
// serif date, status badge, hall count, an "Active today" badge on the roster in force), then the
// halls of the roster in force (Hall, Bench, Portfolio in muted ink). Benches are shown as the court
// publishes them, one row at a time: nothing here groups, counts or ranks by judge (PX-9, ME-6).
// Rows that appear rise in over 200 ms ease-out and rows that go fade out; reduced motion keeps the
// opacity fade only. `RostersLoadError` is the page's load error (`Try again` refreshes) and
// `RosterImportLink` is the owners' and advocates' Import button, disabled with a note while
// offline (the list stays readable).
import type { RostersPageForum } from '@causedeck/core/court';
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@causedeck/ui/card';
import { EmptyState } from '@causedeck/ui/empty-state';
import { ErrorState } from '@causedeck/ui/patterns';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';
import { CalendarX, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';

type Roster = RostersPageForum['rosters'][number];

/** A roster version as the card shows it. */
export type RosterCardData = Pick<
  Roster,
  'id' | 'version' | 'status' | 'effectiveFrom' | 'effectiveTo' | 'entryCount'
>;

/** A hall of the roster in force: the bench's display label, or null when no judge is recorded. */
export interface RosterHallRow {
  entryId: string;
  hallNo: string;
  portfolioText: string;
  benchLabel: string | null;
}

export interface RosterTableProps {
  rosters: readonly RosterCardData[];
  activeRosterId: string | null;
  halls: readonly RosterHallRow[];
}

const STATUS_TONE: Record<RosterCardData['status'], BadgeTone> = {
  active: 'success',
  superseded: 'neutral',
  draft: 'outline',
};

/** Row motion: 200 ms ease-out rise in, fade out; reduced motion keeps the opacity fade only. */
export const ROW_ENTER = [
  'animate-slide-in motion-reduce:animate-fade-in',
  '[animation-duration:200ms] [animation-timing-function:ease-out]',
].join(' ');
export const ROW_LEAVE = [
  'pointer-events-none opacity-0 translate-y-1 motion-reduce:translate-y-0',
  'transition-[opacity,transform] duration-200 ease-out',
].join(' ');

const LEAVE_MS = 200;

export interface Presence<T> {
  item: T;
  /** Added after the first render: animates in. */
  entering: boolean;
  /** Gone from `items`: kept for the fade out, then dropped. */
  leaving: boolean;
}

/** `items` plus, for 200 ms, the ones just removed, so rows can animate in and out. */
export function usePresence<T>(items: readonly T[], keyOf: (item: T) => string): Presence<T>[] {
  const [previous, setPrevious] = useState(items);
  const [shown, setShown] = useState<Presence<T>[]>(() =>
    items.map((item) => ({ item, entering: false, leaving: false })),
  );
  if (previous !== items) {
    setPrevious(items);
    const before = new Set(shown.filter((s) => !s.leaving).map((s) => keyOf(s.item)));
    const now = new Set(items.map(keyOf));
    setShown([
      ...items.map((item) => ({ item, entering: !before.has(keyOf(item)), leaving: false })),
      ...shown
        .filter((s) => !now.has(keyOf(s.item)))
        .map((s) => ({ item: s.item, entering: false, leaving: true })),
    ]);
  }
  useEffect(() => {
    if (!shown.some((s) => s.leaving)) return;
    const timer = setTimeout(() => {
      setShown((current) => current.filter((s) => !s.leaving));
    }, LEAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [shown]);
  return shown;
}

/** `className` for a row in `presence`. */
export function presenceClass(presence: Presence<unknown>): string | undefined {
  if (presence.leaving) return ROW_LEAVE;
  return presence.entering ? ROW_ENTER : undefined;
}

/** An ISO day (YYYY-MM-DD) as a calendar date, never shifted by the viewer's time zone. */
export function formatDay(
  day: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(`${locale}-IN`, { ...options, timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

function RosterCard({ roster, active }: { roster: RosterCardData; active: boolean }) {
  const t = useTranslations('courtsRosters.roster');
  const locale = useLocale();
  return (
    <Card data-roster={roster.id} data-roster-active={active ? '' : undefined} className="gap-3">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {active ? (
            <Badge tone="accent" data-roster-active-today="">
              {t('activeToday')}
            </Badge>
          ) : null}
          <Badge tone={STATUS_TONE[roster.status]} data-roster-status={roster.status}>
            {t(`status.${roster.status}`)}
          </Badge>
        </div>
        <CardTitle asChild>
          <h3>
            <time dateTime={roster.effectiveFrom}>
              {t('effectiveFrom', { date: formatDay(roster.effectiveFrom, locale) })}
            </time>
          </h3>
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-3 gap-y-1">
          <span>
            {roster.effectiveTo === null
              ? t('openEnded')
              : t('effectiveTo', { date: formatDay(roster.effectiveTo, locale) })}
          </span>
          <span>{t('version', { version: roster.version })}</span>
          <span data-roster-entries="">{t('entries', { count: roster.entryCount })}</span>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function HallsInForce({ halls }: { halls: readonly RosterHallRow[] }) {
  const t = useTranslations('courtsRosters.halls');
  const rows = usePresence(halls, (hall) => hall.entryId);
  return (
    <Table data-slot="roster-halls">
      <TableCaption>{t('caption')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('hall')}</TableHead>
          <TableHead scope="col">{t('bench')}</TableHead>
          <TableHead scope="col">{t('portfolio')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.item.entryId}
            data-roster-hall={row.item.hallNo}
            aria-hidden={row.leaving ? true : undefined}
            className={presenceClass(row)}
          >
            <TableCell className="font-medium">{row.item.hallNo}</TableCell>
            <TableCell>
              {row.item.benchLabel ?? (
                <span className="text-ink-muted">{t('benchNotRecorded')}</span>
              )}
            </TableCell>
            <TableCell className="text-ink-muted whitespace-normal">
              {row.item.portfolioText}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RosterTable({ rosters, activeRosterId, halls }: RosterTableProps) {
  const t = useTranslations('courtsRosters');
  const cards = usePresence(rosters, (roster) => roster.id);
  // The roster in force first, then the rest newest first (as the read model orders them).
  const ordered = [
    ...cards.filter((c) => c.item.id === activeRosterId),
    ...cards.filter((c) => c.item.id !== activeRosterId),
  ];
  return (
    <div data-slot="roster-table" className="flex flex-col gap-6">
      <ul aria-label={t('roster.listLabel')} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {ordered.map((card) => (
          <li
            key={card.item.id}
            aria-hidden={card.leaving ? true : undefined}
            className={presenceClass(card)}
          >
            <RosterCard roster={card.item} active={card.item.id === activeRosterId} />
          </li>
        ))}
      </ul>
      {activeRosterId === null ? (
        <EmptyState
          data-pattern-state="empty"
          data-roster-none-in-force=""
          icon={<CalendarX />}
          title={t('halls.noneInForce.title')}
          description={t('halls.noneInForce.hint')}
        />
      ) : (
        <HallsInForce halls={halls} />
      )}
    </div>
  );
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Whether the browser is online; true while rendering on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export interface RosterImportLinkProps {
  /** The import review route (#436) for the selected forum. */
  href: string;
}

/** `Import roster` (owners and advocates); disabled with a note while offline. */
export function RosterImportLink({ href }: RosterImportLinkProps) {
  const t = useTranslations('courtsRosters');
  const online = useOnline();
  if (!online) {
    return (
      <div data-roster-import="offline" className="flex flex-col items-start gap-1">
        <Button type="button" disabled>
          <Upload aria-hidden />
          {t('importRoster')}
        </Button>
        <p className="text-ink-muted text-xs">{t('importOffline')}</p>
      </div>
    );
  }
  return (
    <Button asChild>
      <Link href={href} data-roster-import="">
        <Upload aria-hidden />
        {t('importRoster')}
      </Link>
    </Button>
  );
}

/** The rosters page's load error: `Could not load rosters.` and `Try again` (a refresh). */
export function RostersLoadError() {
  const t = useTranslations('courtsRosters.error');
  const router = useRouter();
  return (
    <ErrorState
      data-pattern-state="error"
      title={t('title')}
      onRetry={() => {
        router.refresh();
      }}
      labels={{ retry: t('retry') }}
    />
  );
}
