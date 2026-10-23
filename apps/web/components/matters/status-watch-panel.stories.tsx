// Case-status watches on the Proceedings tab (#593): an unwatched proceeding offers Watch, a
// watched one offers Refresh status. The actions are mocked with `fn()`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { StatusWatchPanel } from './status-watch-panel.tsx';

const meta = {
  title: 'Matters/StatusWatchPanel',
  component: StatusWatchPanel,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    sources: ['in.tn.chennai-district:case_status'],
    actions: { add: fn(), refresh: { server: fn(), recordDevice: fn() } },
    targets: [
      {
        proceedingId: '00000000-0000-4000-8000-0000000c0001',
        label: 'WP 1/2024',
        cnr: null,
        caseNumber: 'WP 1/2024',
        watchId: null,
      },
      {
        proceedingId: '00000000-0000-4000-8000-0000000c0002',
        label: 'WP 2/2024',
        cnr: null,
        caseNumber: 'WP 2/2024',
        watchId: '00000000-0000-4000-8000-0000000d0002',
      },
    ],
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusWatchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
  },
};
