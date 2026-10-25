// `/w/[slug]/calendar` (#66): the week and month calendar. The placeholder renders first so its
// guards (membership, flag, dev states) run unchanged; the range comes from `getCalendarRange`.
// `?view=week|month`, `?day=` (the range's anchor), `?scope=mine|workspace`, `?open=` (the day popover).
import type { CalendarDay } from '@causedeck/validators';
import { EmptyState } from '@causedeck/ui/empty-state';
import { ShieldAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

import {
  createCalendarFeedAction,
  rotateCalendarFeedAction,
} from '../settings/integrations/calendar/actions.ts';

import { AgendaList } from './_components/agenda-list.tsx';
import { CalendarToolbar, OfflineNotice } from './_components/calendar-toolbar.tsx';
import { DayPopover } from './_components/day-popover.tsx';
import { Legend } from './_components/legend.tsx';
import { MonthView } from './_components/month-view.tsx';
import { SubscribePanel } from './_components/subscribe-panel.tsx';
import { WeekView } from './_components/week-view.tsx';

const Placeholder = placeholderPage('calendar');

const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** The Monday on or before `date`. */
const monday = (date: string) =>
  shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const validDay = (v: string | undefined) =>
  v !== undefined && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined;

/** The week of `anchor`, or the month grid (whole weeks covering the month, at most 42 days). */
function rangeOf(view: 'week' | 'month', anchor: string) {
  if (view === 'week') {
    const from = monday(anchor);
    return { from, to: shift(from, 6) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const next = new Date(Date.parse(`${first}T00:00:00Z`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = shift(next.toISOString().slice(0, 10), -1);
  const from = monday(first);
  return { from, to: shift(monday(last), 6) };
}

function shiftAnchor(view: 'week' | 'month', anchor: string, dir: 1 | -1): string {
  if (view === 'week') return shift(anchor, 7 * dir);
  const d = new Date(Date.parse(`${anchor.slice(0, 7)}-01T00:00:00Z`));
  d.setUTCMonth(d.getUTCMonth() + dir);
  return d.toISOString().slice(0, 10);
}

export default async function CalendarPage(props: WorkspacePageProps) {
  const base = await Placeholder(props);
  const [{ slug }, query] = await Promise.all([props.params, props.searchParams]);
  if (isDev() && one(query.__state) !== undefined) return base;
  const context = await getWorkspaceContext(slug);
  if (!context) return base;
  const t = await getTranslations('calendarView');

  const today = istDay.format(new Date());
  const view = one(query.view) === 'month' ? 'month' : 'week';
  const anchor = validDay(one(query.day)) ?? today;
  const canViewAll = can(context.role, 'court_day.view_all');
  const scope = one(query.scope) === 'workspace' && canViewAll ? 'workspace' : 'mine';
  const { from, to } = rangeOf(view, anchor);
  const open = validDay(one(query.open));

  const href = (over: Partial<{ view: string; day: string; scope: string; open: string }>) => {
    const p = new URLSearchParams({ view, day: anchor, scope, ...over });
    return `/w/${slug}/calendar?${p.toString()}`;
  };

  let days: CalendarDay[] = [];
  try {
    const { db } = await import('@causedeck/core/runtime');
    const { getCalendarRange } = await import('@causedeck/core/court-day');
    days = await getCalendarRange(
      { db },
      { workspaceId: context.workspace.id, userId: context.user.id },
      { from, to, scope },
    );
  } catch (error) {
    if ((error as { code?: string }).code === 'FORBIDDEN') return <PermissionDeniedPage />;
    throw error;
  }

  let feedActive = false;
  let disclosureVersion = '';
  try {
    const { db } = await import('@causedeck/core/runtime');
    const { getFeedStatus, CALENDAR_DISCLOSURE_VERSION } = await import('@causedeck/core/calendar');
    disclosureVersion = CALENDAR_DISCLOSURE_VERSION;
    feedActive =
      (await getFeedStatus(db, { workspaceId: context.workspace.id, userId: context.user.id })) !==
      null;
  } catch (error) {
    logger.error({ err: error }, 'calendar page: could not read the feed status');
  }

  const hrefFor = (date: string) => href({ open: date });
  const empty = days.every((d) => d.entries.length === 0);
  const selected = open === undefined ? undefined : days.find((d) => d.date === open);
  return (
    <div data-route="calendar" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <OfflineNotice />
      <CalendarToolbar
        view={view}
        scope={scope}
        canViewAll={canViewAll}
        from={from}
        to={to}
        links={{
          previous: href({ day: shiftAnchor(view, anchor, -1) }),
          next: href({ day: shiftAnchor(view, anchor, 1) }),
          today: href({ day: today }),
          week: href({ view: 'week' }),
          month: href({ view: 'month' }),
          mine: href({ scope: 'mine' }),
          workspace: href({ scope: 'workspace' }),
        }}
      />
      {empty ? (
        <EmptyState data-pattern-state="empty" icon={<ShieldAlert />} title={t('empty')} />
      ) : null}
      {view === 'month' ? (
        <MonthView days={days} month={anchor.slice(0, 7)} hrefFor={hrefFor} />
      ) : (
        <WeekView days={days} hrefFor={hrefFor} />
      )}
      {view === 'month' ? (
        <div className="md:hidden">
          <AgendaList
            days={days.filter((d) => d.date.startsWith(anchor.slice(0, 7)))}
            hrefFor={hrefFor}
          />
        </div>
      ) : null}
      <Legend />
      <SubscribePanel
        workspaceId={context.workspace.id}
        active={feedActive}
        disclosureVersion={disclosureVersion}
        manageHref={`/w/${slug}/settings/integrations/calendar`}
        actions={{ create: createCalendarFeedAction, rotate: rotateCalendarFeedAction }}
      />
      {selected === undefined ? null : (
        <DayPopover day={selected} slug={slug} today={today} closeHref={href({})} />
      )}
    </div>
  );
}
