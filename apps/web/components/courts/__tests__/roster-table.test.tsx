// @vitest-environment jsdom
// Roster table (#435): roster cards with effective dates, status and hall counts, "Active today" on
// the roster in force, the halls of that roster (Hall, Bench, Portfolio) in the order given, a
// note for a bench with no judge recorded, the none-in-force state, row motion on insert/remove,
// and the Import button disabled with a note while offline. No judge aggregation.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';

import { rosterCards, rosterHalls } from './fixtures.ts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { formatDay, RosterImportLink, RosterTable } = await import('../roster-table.tsx');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RosterTable (#435)', () => {
  it('shows each version with its effective dates, status and hall count', () => {
    renderWithIntl(
      <RosterTable rosters={rosterCards()} activeRosterId="roster-oct" halls={rosterHalls()} />,
    );
    const list = screen.getByRole('list', { name: 'Roster versions' });
    const [october, september] = within(list).getAllByRole('listitem');
    expect(october?.textContent).toContain('From 5 Oct 2026');
    expect(october?.textContent).toContain('until replaced');
    expect(october?.textContent).toContain('Version 2');
    expect(october?.textContent).toContain('3 halls');
    expect(within(october as HTMLElement).getByText('Active today')).toBeTruthy();
    expect(within(october as HTMLElement).getByText('Active')).toBeTruthy();
    expect(september?.textContent).toContain('From 1 Sept 2026');
    expect(september?.textContent).toContain('until 5 Oct 2026');
    expect(within(september as HTMLElement).getByText('Superseded')).toBeTruthy();
    expect(within(september as HTMLElement).queryByText('Active today')).toBeNull();
  });

  it('puts the roster in force first', () => {
    renderWithIntl(
      <RosterTable rosters={rosterCards()} activeRosterId="roster-sep" halls={rosterHalls()} />,
    );
    const items = within(screen.getByRole('list', { name: 'Roster versions' })).getAllByRole(
      'listitem',
    );
    expect(items[0]?.querySelector('[data-roster]')?.getAttribute('data-roster')).toBe(
      'roster-sep',
    );
  });

  it('lists the halls of the roster in force with bench and portfolio', () => {
    renderWithIntl(
      <RosterTable rosters={rosterCards()} activeRosterId="roster-oct" halls={rosterHalls()} />,
    );
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Hall', 'Bench', 'Portfolio']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.getAttribute('data-roster-hall'))).toEqual(['2', '7', '12A']);
    expect(rows[1]?.textContent).toContain(
      'Justice B. Kural (fictional), Justice C. Ilai (fictional)',
    );
    expect(rows[1]?.textContent).toContain('Civil revision petitions; second appeals');
    expect(rows[2]?.textContent).toContain('Bench not recorded');
    // Court-published composition only: no per-judge counts or groupings.
    expect(table.textContent).not.toMatch(/matters|cases|disposal/i);
  });

  it('says when no roster is in force today', () => {
    renderWithIntl(<RosterTable rosters={rosterCards()} activeRosterId={null} halls={[]} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No roster in force today')).toBeTruthy();
    expect(screen.queryByText('Active today')).toBeNull();
  });

  it('animates rows in and keeps a removed row for its fade out', () => {
    vi.useFakeTimers();
    const halls = rosterHalls();
    const ui = (rows: typeof halls) => (
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
        <RosterTable rosters={rosterCards()} activeRosterId="roster-oct" halls={rows} />
      </NextIntlClientProvider>
    );
    const view = render(ui(halls));
    const row = (hall: string) => document.querySelector(`[data-roster-hall="${hall}"]`);
    expect(row('2')?.className).not.toContain('animate-slide-in');

    const next = [
      ...halls.slice(1),
      { entryId: 'entry-9', hallNo: '9', portfolioText: '', benchLabel: null },
    ];
    view.rerender(ui(next));
    expect(row('9')?.className).toContain('animate-slide-in');
    expect(row('9')?.className).toContain('motion-reduce:animate-fade-in');
    expect(row('9')?.className).toContain('[animation-duration:200ms]');
    expect(row('2')?.className).toContain('opacity-0');
    expect(row('2')?.className).toContain('motion-reduce:translate-y-0');
    expect(row('2')?.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(row('2')).toBeNull();
  });
});

describe('formatDay', () => {
  it('formats a calendar day without shifting it', () => {
    expect(formatDay('2026-10-05', 'en', { day: '2-digit', month: 'short' })).toBe('05 Oct');
  });
});

describe('RosterImportLink (#435)', () => {
  it('links to the import review', () => {
    renderWithIntl(<RosterImportLink href="/w/demo/courts/rosters/import?forum=a.b" />);
    expect(screen.getByRole('link', { name: 'Import roster' }).getAttribute('href')).toBe(
      '/w/demo/courts/rosters/import?forum=a.b',
    );
  });

  it('is disabled with a note while offline', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithIntl(<RosterImportLink href="/w/demo/courts/rosters/import" />);
    expect(screen.queryByRole('link', { name: 'Import roster' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Import roster' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Importing a roster needs a connection.')).toBeTruthy();
    onLine.mockRestore();
  });
});
