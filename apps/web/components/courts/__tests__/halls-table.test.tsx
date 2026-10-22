// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { HallsTable } from '../halls-table.tsx';

import { hallsSeen } from './fixtures.ts';

afterEach(cleanup);

describe('HallsTable (#400)', () => {
  it('lists each hall with its last list date and an unreadable indicator', () => {
    renderWithIntl(<HallsTable halls={hallsSeen()} />);
    const table = screen.getByRole('table', { name: 'Halls seen in your lists' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Hall', 'Last list', 'Reading']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.getAttribute('data-hall'))).toEqual(['2', '7', '12A']);
    expect(rows[1]?.querySelector('[data-hall-unreadable]')?.textContent).toBe('Unreadable');
    expect(rows[0]?.textContent).toContain('Read');
    expect(rows[0]?.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-10-21T04:00:00.000Z',
    );
    expect(rows[0]?.querySelector('time')?.textContent).toMatch(/2026/);
  });

  it('teaches where halls come from when there are none', () => {
    const { container } = renderWithIntl(<HallsTable halls={[]} />);
    expect(screen.queryByRole('table')).toBeNull();
    const empty = container.querySelector('[data-pattern-state="empty"]');
    expect(empty?.textContent).toContain('No halls seen yet');
    expect(empty?.textContent).toContain('after you share a cause list');
  });
});
