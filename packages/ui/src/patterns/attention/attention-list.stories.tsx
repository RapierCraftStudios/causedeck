import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { AttentionList, type AttentionFlagView } from './attention-list';

const FLAGS: AttentionFlagView[] = [
  {
    key: 'a',
    matterTitle: 'Asha v. State',
    rule: 'no_next_date',
    evidence: 'No next date since 2026-11-01',
    since: '2026-11-01',
    suggestedAction: 'Set the next date',
  },
  {
    key: 'c',
    matterTitle: 'Mala v. State',
    rule: 'no_recent_update',
    evidence: 'No update in 40 days',
    since: '2026-10-01',
    suggestedAction: 'Ask the junior for an update',
  },
];

const meta = {
  title: 'Patterns/AttentionList',
  component: AttentionList,
  args: { flags: FLAGS, onOpen: fn(), onClose: fn(), onSnooze: fn(), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AttentionList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement);
    await expect(c.getByText('No next date (1)')).toBeInTheDocument();
    const [first] = c.getAllByRole('listitem');
    first?.focus();
    await userEvent.keyboard('s');
    await expect(args.onSnooze).toHaveBeenCalledWith('a');
    await userEvent.keyboard('{Enter}');
    await expect(args.onOpen).toHaveBeenCalledWith('a');
  },
};
export const Open: Story = { args: { openKey: 'a' } };
export const Empty: Story = {
  args: { state: 'empty', flags: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Nothing needs you right now.'),
    ).toBeInTheDocument();
  },
};
export const Loading: Story = { args: { state: 'loading' } };
export const ErrorState: Story = {
  args: { state: 'error' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
export const Offline: Story = { args: { state: 'offline' } };
export const Denied: Story = { args: { state: 'denied' } };
export const ReadOnly: Story = { args: { readOnly: true } };
