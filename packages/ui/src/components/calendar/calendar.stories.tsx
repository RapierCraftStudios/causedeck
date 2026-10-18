// check-stories: n/a Loading, Invalid, WithIcon (a month grid has no pending or invalid state and no icon slot; DatePicker shows typed-input errors)
import { TZDate } from '@date-fns/tz';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { COURT_HOLIDAYS_2026 } from '../__fixtures__/data';
import { Calendar, IST_TIME_ZONE, type CalendarProps } from './calendar';

const ist = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new TZDate(y ?? 2026, (m ?? 1) - 1, d ?? 1, IST_TIME_ZONE);
};

const MARCH = ist('2026-03-01');
const HOLIDAYS = COURT_HOLIDAYS_2026.map((holiday) => ist(holiday.date));
const holidayName = (date: Date) =>
  COURT_HOLIDAYS_2026.find(
    (holiday) => ist(holiday.date).getTime() === new TZDate(date, IST_TIME_ZONE).getTime(),
  )?.name;

function SingleCalendar(props: CalendarProps) {
  const [selected, setSelected] = useState<Date | undefined>(ist('2026-03-12'));
  return (
    <Calendar
      {...props}
      mode="single"
      selected={selected}
      onSelect={(date: Date | undefined) => {
        setSelected(date);
      }}
    />
  );
}

const meta = {
  title: 'Components/Calendar',
  component: SingleCalendar,
  args: { defaultMonth: MARCH, onDayClick: fn() },
} satisfies Meta<typeof SingleCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Monday-first weeks in IST; 12 March selected. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const grid = canvas.getByRole('grid', { name: 'March 2026' });
    const headers = within(grid).getAllByRole('columnheader', { hidden: true });
    await expect(headers[0]).toHaveAttribute('aria-label', 'Monday');
    await expect(canvas.getByRole('button', { name: /12 March 2026.*selected/i })).toBeVisible();
  },
};

/** Court holidays (sample data) get a dot and a "Court holiday" suffix in their name. */
export const Holidays: Story = {
  args: { holidays: HOLIDAYS, getHolidayName: holidayName },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('button', { name: /19 March 2026.*Court holiday: Ugadi/ }),
    ).toBeVisible();
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const day = canvas.getByRole('button', { name: /16 March 2026/ });
    await userEvent.hover(day);
    await expect(day.className).toMatch(/\bhover:bg-surface-sunken\b/);
  },
};

/** Keyboard: arrows move by day and week, Enter selects. */
export const FocusVisible: Story = {
  play: async ({ canvas, args }) => {
    const selected = canvas.getByRole('button', { name: /12 March 2026/ });
    selected.focus();
    await userEvent.keyboard('{ArrowRight}');
    const next = canvas.getByRole('button', { name: /13 March 2026/ });
    await expect(next).toHaveFocus();
    await expect(next.matches(':focus-visible')).toBe(true);
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('button', { name: /20 March 2026/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('button', { name: /20 March 2026.*selected/i })).toHaveFocus();
    await expect(args.onDayClick).toHaveBeenCalled();
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const day = canvas.getByRole('button', { name: /24 March 2026/ });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: day },
      { keys: '[/MouseLeft]', target: day },
    ]);
    await expect(canvas.getByRole('button', { name: /24 March 2026.*selected/i })).toBeVisible();
  },
};

/** Weekends and past days disabled, e.g. for filing deadlines. */
export const Disabled: Story = {
  args: { disabled: [{ dayOfWeek: [0, 6] }, { before: ist('2026-03-10') }] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /15 March 2026/ })).toBeDisabled();
  },
};

export const LongText: Story = {
  args: { numberOfMonths: 2, footer: 'Hearings after 30 April 2026 are listed by the Registry.' },
};

export const RtlNeutral: Story = {
  args: { dir: 'rtl' },
};

export const Tamil: Story = {
  args: {
    labels: {
      previousMonth: 'முந்தைய மாதம்',
      nextMonth: 'அடுத்த மாதம்',
      holiday: 'நீதிமன்ற விடுமுறை',
    },
    holidays: HOLIDAYS,
  },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'முந்தைய மாதம்' })).toBeVisible();
  },
};

export const Kannada: Story = {
  args: {
    labels: { previousMonth: 'ಹಿಂದಿನ ತಿಂಗಳು', nextMonth: 'ಮುಂದಿನ ತಿಂಗಳು', holiday: 'ನ್ಯಾಯಾಲಯ ರಜೆ' },
    holidays: HOLIDAYS,
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'ಮುಂದಿನ ತಿಂಗಳು' })).toBeVisible();
  },
};
