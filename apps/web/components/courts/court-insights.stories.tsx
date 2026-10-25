// Court insights (#512): figures, a withheld figure and the empty state.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { CourtInsightsView } from './court-insights.tsx';

const meta = {
  title: 'Courts/CourtInsights',
  component: CourtInsightsView,
  args: {
    filters: { forumId: '', caseType: '' },
    insights: {
      window: { from: '2021-01-01', to: '2026-10-24' },
      minCell: 5,
      coverage: { proceedings: 21, hearings: 33 },
      forums: [{ id: 'f1', code: 'in.tn.madras-hc', court: 'Madras High Court' }],
      cells: [
        {
          forumId: 'f1',
          caseTypeCode: 'WP',
          stage: 'admission',
          period: '2026',
          listingDelayDays: { value: 12, n: 9 },
          adjournmentRate: { value: 0.4, n: 9 },
          disposalDays: { value: null, n: null },
          backlog: { value: 7, n: 7 },
          suppressed: false,
        },
      ],
    },
  },
} satisfies Meta<typeof CourtInsightsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Figures: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table')).toBeVisible();
    await expect(canvas.getByText('Not enough data')).toBeVisible();
  },
};

export const Empty: Story = {
  args: { insights: { ...meta.args.insights, cells: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No figures yet')).toBeVisible();
  },
};
