// Bench-notice alerts (#496): a special-bench notice with its source and official link, several
// alerts, the empty state (renders nothing); dark mode.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { BenchNoticeAlerts, type BenchNoticeAlertView } from './bench-notice-alerts.tsx';

const alert: BenchNoticeAlertView = {
  noticeId: 'n-1',
  title: 'Special bench for W.P. matters (fictional)',
  url: 'https://court.example.test/notices/special-bench.pdf',
  kind: 'circular',
  type: 'special_bench',
  sourceName: 'Madras High Court (fictional)',
  matterId: 'matter-1',
  matterTitle: 'Raman v. State (fictional)',
  listDates: ['2026-11-05', '2026-11-06'],
};

const meta = {
  title: 'Courts/BenchNoticeAlerts',
  component: BenchNoticeAlerts,
  args: { slug: 'demo', alerts: [alert] },
} satisfies Meta<typeof BenchNoticeAlerts>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Raman v. State (fictional)' })).toHaveAttribute(
      'href',
      '/w/demo/matters/matter-1',
    );
  },
};

export const Several: Story = {
  args: {
    alerts: [
      alert,
      {
        ...alert,
        noticeId: 'n-2',
        title: 'Judge on leave (fictional)',
        type: 'leave',
        matterId: 'matter-2',
        matterTitle: 'Iyer v. Union (fictional)',
        listDates: ['2026-11-07'],
      },
    ],
  },
};

export const Empty: Story = { args: { alerts: [] } };

export const Dark: Story = { globals: { theme: 'dark' } };

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
