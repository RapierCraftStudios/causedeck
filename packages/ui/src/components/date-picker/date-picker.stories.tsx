import { TZDate } from '@date-fns/tz';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarClock } from 'lucide-react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { COURT_HOLIDAYS_2026, INDIC_DATA } from '../__fixtures__/data';
import { LONG_LABEL } from '../__fixtures__/labels';
import { IST_TIME_ZONE } from '../calendar/calendar';
import { Field } from '../field/field';
import { DatePicker, DEFAULT_DATE_PICKER_LABELS, type DatePickerProps } from './date-picker';

const ist = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(new TZDate(y ?? 2026, (m ?? 1) - 1, d ?? 1, IST_TIME_ZONE).getTime());
};

const HOLIDAYS = COURT_HOLIDAYS_2026.map((holiday) => ist(holiday.date));

interface HearingProps extends DatePickerProps {
  label?: string;
  hint?: string;
  error?: string;
}

function Hearing({ label = 'Next hearing', hint, error, ...props }: HearingProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      <DatePicker {...props} />
    </Field>
  );
}

const meta = {
  title: 'Components/DatePicker',
  component: Hearing,
  args: { onChange: fn(), holidays: HOLIDAYS },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Hearing>;

export default meta;
type Story = StoryObj<typeof meta>;

const doc = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);

/** Typed dd/mm/yyyy is parsed in IST and shown as dd MMM yyyy. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole('textbox', { name: 'Next hearing' });
    await userEvent.type(input, '12/03/2026{Enter}');
    await expect(input).toHaveValue('12 Mar 2026');
    const picked = (args.onChange as ReturnType<typeof fn>).mock.calls[0]?.[0] as Date;
    await expect(picked.toISOString()).toBe('2026-03-11T18:30:00.000Z');
  },
};

/**
 * Keyboard: Alt+Down opens the Monday-first calendar on the selected day, arrows move, Enter picks
 * and focus returns to the input; Esc closes without picking.
 */
export const KeyboardInteraction: Story = {
  args: { defaultValue: ist('2026-03-12') },
  play: async ({ canvas, canvasElement }) => {
    const page = doc(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Next hearing' });
    input.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    const dialog = await page.findByRole('dialog', { name: DEFAULT_DATE_PICKER_LABELS.calendar });
    const headers = within(dialog).getAllByRole('columnheader', { hidden: true });
    await expect(headers[0]).toHaveAttribute('aria-label', 'Monday');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /12 March 2026/ })).toHaveFocus(),
    );
    await userEvent.keyboard('{ArrowRight}{ArrowDown}');
    await expect(within(dialog).getByRole('button', { name: /20 March 2026/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull());
    await expect(input).toHaveValue('20 Mar 2026');
    await expect(input).toHaveFocus();

    const button = canvas.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar });
    await userEvent.click(button);
    await page.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull());
    await expect(button).toHaveFocus();
    await expect(input).toHaveValue('20 Mar 2026');
  },
};

/** Court holidays are decorated in the calendar (sample data; real calendars come later). */
export const Holidays: Story = {
  args: { defaultValue: ist('2026-03-12') },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(
      canvas.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar }),
    );
    const dialog = await doc(canvasElement).findByRole('dialog');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: /19 March 2026.*Court holiday/ }),
      ).toBeVisible(),
    );
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox');
    await userEvent.hover(input);
    await expect(input.className).toMatch(/\bhover:border-line-control\b/);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const input = canvas.getByRole('textbox');
    await expect(input).toHaveFocus();
    await userEvent.tab();
    const button = canvas.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar });
    await expect(button).toHaveFocus();
    await expect(button.matches(':focus-visible')).toBe(true);
  },
};

export const Active: Story = {
  play: async ({ canvas, canvasElement }) => {
    const button = canvas.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: button },
      { keys: '[/MouseLeft]', target: button },
    ]);
    const dialog = await doc(canvasElement).findByRole('dialog');
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.keyboard('{Escape}');
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: ist('2026-03-12') },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toBeDisabled();
    await expect(
      canvas.getByRole('button', { name: DEFAULT_DATE_PICKER_LABELS.openCalendar }),
    ).toBeDisabled();
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-busy', 'true');
  },
};

/** Typed text that is not a date: danger border, icon and a message saying what to enter. */
export const Invalid: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox');
    await userEvent.type(input, '31/02/2026');
    await userEvent.tab();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(DEFAULT_DATE_PICKER_LABELS.invalid);
  },
};

export const WithIcon: Story = {
  args: { startIcon: <CalendarClock />, defaultValue: ist('2026-03-12') },
};

export const LongText: Story = {
  args: { label: LONG_LABEL, hint: 'Listed before the Hon’ble Division Bench, Court 12.' },
};

export const RtlNeutral: Story = {
  args: { defaultValue: ist('2026-03-12') },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: {
    label: INDIC_DATA.ta.hearingDate,
    labels: { openCalendar: INDIC_DATA.ta.pickDate, calendar: INDIC_DATA.ta.pickDate },
    defaultValue: ist('2026-03-12'),
  },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: {
    label: INDIC_DATA.kn.hearingDate,
    labels: { openCalendar: INDIC_DATA.kn.pickDate, calendar: INDIC_DATA.kn.pickDate },
    defaultValue: ist('2026-03-12'),
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
