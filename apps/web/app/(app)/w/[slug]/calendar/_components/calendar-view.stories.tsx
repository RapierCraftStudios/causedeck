// Calendar view (#66): month grid, week view, day popover, legend, and the empty, loading, error,
// offline and denied states.
import type { CalendarDay } from '@causedeck/validators';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import CalendarError from '../error.tsx';
import CalendarLoading from '../loading.tsx';

import { DayPopover } from './day-popover.tsx';
import { Legend } from './legend.tsx';
import { MonthView } from './month-view.tsx';
import { OfflineNotice } from './calendar-toolbar.tsx';
import { WeekView } from './week-view.tsx';

const days: CalendarDay[] = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-11-${String(2 + i).padStart(2, '0')}`,
  counts: {
    listings: i === 1 ? 1 : 0,
    nextDates: 0,
    obligationsDue: i === 1 ? 1 : 0,
    proposed: 0,
    confirmed: i === 1 ? 2 : 0,
  },
  clash: i === 1,
  closedReason: i === 5 ? 'Diwali' : null,
  entries:
    i === 1
      ? [
          {
            kind: 'listing',
            date: '2026-11-03',
            proposed: false,
            redacted: false,
            matterId: null,
            matterTitle: 'Raman v. State (fictional)',
            proceedingId: null,
            caseLabel: null,
            forumName: null,
            hallNo: '3',
            itemNo: '4',
            label: null,
          },
          {
            kind: 'next_date',
            date: '2026-11-03',
            proposed: true,
            redacted: false,
            matterId: null,
            matterTitle: 'Iyer v. Union (fictional)',
            proceedingId: null,
            caseLabel: null,
            forumName: null,
            hallNo: null,
            itemNo: null,
            label: null,
          },
        ]
      : [],
}));
const hrefFor = (d: string) => `/w/demo/calendar?open=${d}`;

const meta = { title: 'Calendar/CalendarView', component: MonthView } satisfies Meta<
  typeof MonthView
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { days, month: '2026-11', hrefFor },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid')).toBeVisible();
  },
};

export const Empty: Story = {
  args: { days: days.map((d) => ({ ...d, entries: [], clash: false })), month: '2026-11', hrefFor },
};

export const Week: Story = {
  args: { days, month: '2026-11', hrefFor },
  render: () => <WeekView days={days.slice(0, 7)} hrefFor={hrefFor} />,
};

export const Popover: Story = {
  args: { days, month: '2026-11', hrefFor },
  render: () => (
    <DayPopover
      day={days[1] as CalendarDay}
      slug="demo"
      today="2026-11-03"
      closeHref="/w/demo/calendar"
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Open day' })).toHaveAttribute(
      'href',
      '/w/demo/today',
    );
  },
};

export const LegendStory: Story = {
  args: { days, month: '2026-11', hrefFor },
  render: () => <Legend />,
};

export const Loading: Story = {
  args: { days, month: '2026-11', hrefFor },
  render: () => <CalendarLoading />,
};

export const ErrorState: Story = {
  args: { days, month: '2026-11', hrefFor },
  render: () => <CalendarError error={new Error('x')} reset={() => undefined} />,
};

export const Offline: Story = {
  args: { days, month: '2026-11', hrefFor },
  render: () => <OfflineNotice />,
};

export const PermissionDenied: Story = {
  args: { days, month: '2026-11', hrefFor },
  render: () => <PermissionDeniedPage />,
};
