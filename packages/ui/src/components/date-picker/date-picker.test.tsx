// @vitest-environment jsdom
import { TZDate } from '@date-fns/tz';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IST_TIME_ZONE } from '../calendar/calendar';
import { Field } from '../field/field';
import {
  DatePicker,
  DEFAULT_DATE_PICKER_LABELS,
  formatDisplayDate,
  parseDateInput,
} from './date-picker';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

/** Midnight IST on 12 March 2026 as a UTC instant. */
const MARCH_12_IST = '2026-03-11T18:30:00.000Z';

describe('parseDateInput', () => {
  it('reads 12/03/2026 as 12 March 2026 at midnight IST, whatever the device zone', () => {
    const date = parseDateInput('12/03/2026');
    expect(date?.toISOString()).toBe(MARCH_12_IST);
  });

  it('accepts single digits, other separators and the display format', () => {
    expect(parseDateInput('1/3/2026')?.toISOString()).toBe('2026-02-28T18:30:00.000Z');
    expect(parseDateInput(' 12-03-2026 ')?.toISOString()).toBe(MARCH_12_IST);
    expect(parseDateInput('12.03.2026')?.toISOString()).toBe(MARCH_12_IST);
    expect(parseDateInput('12 Mar 2026')?.toISOString()).toBe(MARCH_12_IST);
  });

  it('rejects impossible or non-date input', () => {
    for (const text of ['31/02/2026', '29/02/2026', '12/13/2026', '00/03/2026', 'tomorrow', '']) {
      expect(parseDateInput(text), text).toBeNull();
    }
    expect(parseDateInput('29/02/2028')?.toISOString()).toBe('2028-02-28T18:30:00.000Z');
  });

  it('parses in another zone when asked', () => {
    expect(parseDateInput('12/03/2026', 'UTC')?.toISOString()).toBe('2026-03-12T00:00:00.000Z');
  });
});

describe('formatDisplayDate', () => {
  it('formats dd MMM yyyy on the IST calendar', () => {
    expect(formatDisplayDate(new TZDate(2026, 2, 12, IST_TIME_ZONE))).toBe('12 Mar 2026');
    // 19:00 UTC on 11 March is already 12 March in India.
    expect(formatDisplayDate(new Date('2026-03-11T19:00:00Z'))).toBe('12 Mar 2026');
    expect(formatDisplayDate(new Date('2026-03-11T18:00:00Z'))).toBe('11 Mar 2026');
  });
});

describe('DatePicker', () => {
  it('commits typed dd/mm/yyyy on Enter and shows dd MMM yyyy', async () => {
    const onChange = vi.fn();
    render(<DatePicker aria-label="Hearing date" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Hearing date' });
    expect(input).toHaveAttribute('placeholder', DEFAULT_DATE_PICKER_LABELS.placeholder);
    await userEvent.type(input, '12/03/2026{Enter}');
    expect(input).toHaveValue('12 Mar 2026');
    expect((onChange.mock.calls[0]?.[0] as Date).toISOString()).toBe(MARCH_12_IST);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks unparseable input invalid on blur and describes the fix', async () => {
    const onChange = vi.fn();
    render(<DatePicker aria-label="Hearing date" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Hearing date' });
    await userEvent.type(input, '31/02/2026');
    await userEvent.tab();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(DEFAULT_DATE_PICKER_LABELS.invalid);
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, '12/03/2026');
    await userEvent.tab();
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('clearing the text commits null', async () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        aria-label="Hearing date"
        defaultValue={new Date(MARCH_12_IST)}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Hearing date' });
    expect(input).toHaveValue('12 Mar 2026');
    await userEvent.clear(input);
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('opens a Monday-first calendar with the court holidays decorated', async () => {
    render(
      <DatePicker
        aria-label="Hearing date"
        defaultValue={new Date(MARCH_12_IST)}
        holidays={[new TZDate(2026, 2, 19, IST_TIME_ZONE)]}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar }),
    );
    const dialog = screen.getByRole('dialog', { name: DEFAULT_DATE_PICKER_LABELS.calendar });
    const headers = within(dialog).getAllByRole('columnheader', { hidden: true });
    expect(headers[0]).toHaveAttribute('aria-label', 'Monday');
    expect(within(dialog).getByRole('button', { name: /19.*Court holiday/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /12 March 2026.*selected/i })).toHaveFocus();
  });

  it('keyboard: Alt+Down opens, arrows move, Enter picks, focus returns to the input', async () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        aria-label="Hearing date"
        defaultValue={new Date(MARCH_12_IST)}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Hearing date' });
    input.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /13 March 2026/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input).toHaveValue('13 Mar 2026');
    expect(input).toHaveFocus();
    expect((onChange.mock.calls[0]?.[0] as Date).toISOString()).toBe('2026-03-12T18:30:00.000Z');
  });

  it('Escape closes the calendar and returns focus to the opener', async () => {
    render(<DatePicker aria-label="Hearing date" />);
    const button = screen.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar });
    await userEvent.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('wires to a Field and stays closed when disabled', async () => {
    render(
      <Field label="Next hearing" disabled>
        <DatePicker />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Next hearing' });
    expect(input).toBeDisabled();
    const button = screen.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
