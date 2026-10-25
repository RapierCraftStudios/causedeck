// @vitest-environment jsdom
import type { CalendarDay, CalendarEntry } from '@causedeck/validators';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../../../../components/shell/__tests__/helpers.tsx';

import { AgendaList } from './agenda-list.tsx';
import { CalendarToolbar, OfflineNotice } from './calendar-toolbar.tsx';
import { DayPopover, openDayHref } from './day-popover.tsx';
import { Legend } from './legend.tsx';
import { MonthView } from './month-view.tsx';
import { WeekView } from './week-view.tsx';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.unstubAllGlobals();
});

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  kind: 'listing',
  date: '2026-11-03',
  proposed: false,
  redacted: false,
  matterId: null,
  matterTitle: 'Raman v. State',
  proceedingId: null,
  caseLabel: null,
  forumName: null,
  hallNo: '3',
  itemNo: '4',
  label: null,
  ...over,
});
const day = (date: string, over: Partial<CalendarDay> = {}): CalendarDay => ({
  date,
  counts: { listings: 0, nextDates: 0, obligationsDue: 0, proposed: 0, confirmed: 0 },
  clash: false,
  closedReason: null,
  entries: [],
  ...over,
});
const DAYS = Array.from({ length: 14 }, (_, i) => {
  const date = `2026-11-${String(2 + i).padStart(2, '0')}`;
  return i === 1
    ? day(date, {
        counts: { listings: 1, nextDates: 0, obligationsDue: 1, proposed: 1, confirmed: 1 },
        clash: true,
        entries: [
          entry({}),
          entry({ kind: 'next_date', proposed: true, hallNo: null, itemNo: null }),
        ],
      })
    : day(date);
});
const hrefFor = (d: string) => `/x?open=${d}`;

describe('calendar view (#66)', () => {
  it('month view is a grid with per-day labels, counts and markers', () => {
    renderWithIntl(<MonthView days={DAYS} month="2026-11" hrefFor={hrefFor} />);
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    const link = screen.getByRole('link', { name: /2026-11-03, 1 listing, 1 deadline, Clash/ });
    expect(link.textContent).toContain('⚠');
  });

  it('arrow keys move focus across days and Enter opens the day', () => {
    renderWithIntl(<MonthView days={DAYS} month="2026-11" hrefFor={hrefFor} />);
    const links = screen.getAllByRole('link');
    links[0]?.focus();
    fireEvent.keyDown(links[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(links[8]);
    fireEvent.keyDown(links[8] as HTMLElement, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/x?open=2026-11-10');
  });

  it('marks a proposed next date as Proposed and dashed, with kind text', () => {
    const { container } = renderWithIntl(<AgendaList days={DAYS.slice(0, 3)} hrefFor={hrefFor} />);
    const proposed = container.querySelector('[data-entry="next_date"]');
    expect(proposed?.getAttribute('data-proposed')).toBe('true');
    expect(proposed?.textContent).toContain('Next date');
    expect(proposed?.textContent).toContain('Proposed');
  });

  it('week view groups listings by hall', () => {
    const { container } = renderWithIntl(<WeekView days={DAYS.slice(0, 7)} hrefFor={hrefFor} />);
    expect(container.querySelector('[data-hall-group="3"]')?.textContent).toContain('Hall 3');
    expect(container.querySelector('[data-hall-group="other"]')).not.toBeNull();
  });

  it('shows a redacted entry as a restricted matter', () => {
    const redacted = day('2026-11-03', {
      entries: [entry({ redacted: true, matterTitle: null, hallNo: null, itemNo: null })],
    });
    renderWithIntl(<AgendaList days={[redacted]} hrefFor={hrefFor} />);
    expect(screen.getByText('Restricted matter')).toBeTruthy();
  });

  it('popover: Open day uses today and tomorrow aliases, else calendar?day=', () => {
    expect(openDayHref('demo', '2026-11-03', '2026-11-03')).toBe('/w/demo/today');
    expect(openDayHref('demo', '2026-11-04', '2026-11-03')).toBe('/w/demo/tomorrow');
    expect(openDayHref('demo', '2026-11-09', '2026-11-03')).toBe('/w/demo/calendar?day=2026-11-09');
    renderWithIntl(
      <DayPopover day={DAYS[1] as CalendarDay} slug="demo" today="2026-11-03" closeHref="/c" />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Open day' }).getAttribute('href')).toBe(
      '/w/demo/today',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(push).toHaveBeenCalledWith('/c');
  });

  it('popover states an empty day', () => {
    renderWithIntl(
      <DayPopover day={DAYS[0] as CalendarDay} slug="demo" today="2026-11-03" closeHref="/c" />,
    );
    expect(screen.getByText('Nothing listed.')).toBeTruthy();
  });

  it('toolbar shortcuts navigate; the whole-chamber toggle needs view_all', () => {
    const links = {
      previous: '/p',
      next: '/n',
      today: '/t',
      week: '/w',
      month: '/m',
      mine: '/a',
      workspace: '/b',
    };
    renderWithIntl(
      <CalendarToolbar
        links={links}
        view="week"
        scope="mine"
        canViewAll={false}
        from="2026-11-02"
        to="2026-11-08"
      />,
    );
    expect(screen.queryByRole('link', { name: 'Whole chamber' })).toBeNull();
    fireEvent.keyDown(window, { key: 'm' });
    expect(push).toHaveBeenLastCalledWith('/m');
    fireEvent.keyDown(window, { key: ']' });
    expect(push).toHaveBeenLastCalledWith('/n');
    fireEvent.keyDown(window, { key: 't' });
    expect(push).toHaveBeenLastCalledWith('/t');
    cleanup();
    renderWithIntl(
      <CalendarToolbar
        links={links}
        view="week"
        scope="mine"
        canViewAll
        from="2026-11-02"
        to="2026-11-08"
      />,
    );
    expect(screen.getByRole('link', { name: 'Whole chamber' })).toBeTruthy();
  });

  it('legend lists every kind with a label', () => {
    renderWithIntl(<Legend />);
    for (const k of ['Listing', 'Next date', 'Due', 'Holiday', 'Vacation']) {
      expect(screen.getByText(k)).toBeTruthy();
    }
  });

  it('offline notice appears only when offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    renderWithIntl(<OfflineNotice />);
    expect(screen.getByRole('status').textContent).toContain('offline');
  });
});
