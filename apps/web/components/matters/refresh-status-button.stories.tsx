// Refresh status (#593): the control on a watched proceeding. The refresh actions are mocked with
// `fn()`; a result shows how it was served (tier and cost) and never a captcha or court page.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { RefreshActions } from '../../lib/case-watch/refresh.ts';

import { RefreshStatusButton } from './refresh-status-button.tsx';

const actions: RefreshActions = {
  server: fn(() =>
    Promise.resolve({
      ok: true as const,
      data: {
        outcome: 'changed' as const,
        proposals: 1,
        tierUsed: 'alterlab-t2',
        costDollars: 0.25,
      },
    }),
  ),
  recordDevice: fn(),
};

const meta = {
  title: 'Matters/RefreshStatusButton',
  component: RefreshStatusButton,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    watchId: '00000000-0000-4000-8000-0000000d0001',
    actions,
  },
} satisfies Meta<typeof RefreshStatusButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    await expect(actions.server).toHaveBeenCalled();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toBeDisabled();
  },
};
