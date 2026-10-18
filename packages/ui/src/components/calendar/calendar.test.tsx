// @vitest-environment jsdom
import { TZDate } from '@date-fns/tz';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Calendar, DEFAULT_CALENDAR_LABELS, IST_TIME_ZONE } from './calendar';

const MARCH_2026 = new TZDate(2026, 2, 1, IST_TIME_ZONE);
const ugadi = new TZDate(2026, 2, 19, IST_TIME_ZONE);

describe('Calendar', () => {
  it('starts weeks on Monday', () => {
    render(<Calendar defaultMonth={MARCH_2026} />);
    const headers = within(screen.getByRole('grid')).getAllByRole('columnheader', { hidden: true });
    expect(headers[0]).toHaveAttribute('aria-label', 'Monday');
    expect(headers[6]).toHaveAttribute('aria-label', 'Sunday');
  });

  it('can still start on Sunday when asked', () => {
    render(<Calendar defaultMonth={MARCH_2026} weekStartsOn={0} />);
    const headers = within(screen.getByRole('grid')).getAllByRole('columnheader', { hidden: true });
    expect(headers[0]).toHaveAttribute('aria-label', 'Sunday');
  });

  it('decorates court holidays with a class and an accessible suffix', () => {
    render(
      <Calendar
        mode="single"
        defaultMonth={MARCH_2026}
        holidays={[ugadi]}
        getHolidayName={(date) => (date.getDate() === 19 ? 'Ugadi' : undefined)}
      />,
    );
    const day = screen.getByRole('button', { name: /19.*Court holiday: Ugadi/ });
    expect(day.closest('td')?.className).toMatch(/after:bg-warning/);
    expect(screen.getAllByRole('button', { name: /Court holiday/ })).toHaveLength(1);
  });

  it('names its navigation through labels', () => {
    const { unmount } = render(<Calendar defaultMonth={MARCH_2026} />);
    expect(
      screen.getByRole('button', { name: DEFAULT_CALENDAR_LABELS.previousMonth }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: DEFAULT_CALENDAR_LABELS.nextMonth }),
    ).toBeInTheDocument();
    unmount();
    render(
      <Calendar
        defaultMonth={MARCH_2026}
        labels={{ previousMonth: 'முந்தைய மாதம்', nextMonth: 'அடுத்த மாதம்' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'முந்தைய மாதம்' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'அடுத்த மாதம்' })).toBeInTheDocument();
  });

  it('selects a day in IST', async () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" defaultMonth={MARCH_2026} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /12 March 2026/ }));
    const picked = onSelect.mock.calls[0]?.[0] as Date;
    expect(picked.getTime()).toBe(Date.parse('2026-03-11T18:30:00.000Z'));
  });
});
