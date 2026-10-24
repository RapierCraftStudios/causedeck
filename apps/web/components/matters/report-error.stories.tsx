// Report an error (#518): the closed state, the open form with the consent checkbox, and a fix that
// review sent back ("corrected by CauseDeck review"). The action is mocked with `fn()`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import type { Result } from '../../lib/safe-action.ts';
import { ReportError, type ReportRecordErrorAction } from './report-error.tsx';

const sent = (): Promise<Result<{ id: string }>> =>
  Promise.resolve({ ok: true, data: { id: '00000000-0000-4000-8000-0000000e0001' } });

const meta = {
  title: 'Matters/ReportError',
  component: ReportError,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    proceedingId: '00000000-0000-4000-8000-0000000c0001',
    corrections: [],
    report: fn<ReportRecordErrorAction>(sent),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReportError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Report an error' })).toBeVisible();
  },
};

export const OpenWithConsent: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Report an error' }));
    await expect(canvas.getByRole('checkbox')).not.toBeChecked();
  },
};

export const Corrected: Story = {
  args: {
    corrections: [
      {
        id: '00000000-0000-4000-8000-0000000e0002',
        field: 'next_date',
        value: '2026-11-09',
        correctedAt: '2026-10-24T09:00:00.000Z',
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/corrected by CauseDeck review/)).toBeVisible();
  },
};
