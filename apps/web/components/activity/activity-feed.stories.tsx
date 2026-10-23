// The automation activity feed (#49): the day-grouped feed, the empty and filtered-empty states,
// a viewer (no Undo), offline, and a capture view with bulk undo and reassign. The undo dialog with
// its cascade opens from the Undo button.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { ActivityError, ActivityFeed, ActivitySkeleton } from './activity-feed.tsx';
import { actions, MEMBERS, NOW, OWNER, sampleFeed, WORKSPACE } from './__tests__/fixtures.ts';

const meta = {
  title: 'Activity/ActivityFeed',
  component: ActivityFeed,
  parameters: {
    layout: 'fullscreen',
    nextjs: { appDirectory: true, navigation: { pathname: '/w/demo/activity' } },
  },
  args: {
    workspace: WORKSPACE,
    initialPage: { items: sampleFeed(), nextCursor: null, canUndo: true },
    members: MEMBERS,
    currentUserId: OWNER,
    role: 'owner',
    filters: {},
    actions,
    nowIso: NOW.toISOString(),
  },
  decorators: [
    (Story) => (
      <div className="bg-surface text-ink p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Feed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeVisible();
  },
};

export const ExpandedItem: Story = {
  play: async ({ canvas }) => {
    const [first] = canvas.getAllByRole('button', { name: 'Show details' });
    if (first) await userEvent.click(first);
    await expect(canvas.getByText('sarvam-m')).toBeVisible();
    await expect(canvas.getByText('ap-south-1')).toBeVisible();
  },
};

export const UndoDialogWithCascade: Story = {
  play: async ({ canvas, canvasElement }) => {
    const [undo] = canvas.getAllByRole('button', { name: /^Undo: Attached order/ });
    if (undo) await userEvent.click(undo);
    const body = canvasElement.ownerDocument.body;
    await waitFor(async () => {
      await expect(body.querySelector('[data-slot="undo-cascade"] li')).not.toBeNull();
    });
  },
};

export const Empty: Story = {
  args: { initialPage: { items: [], nextCursor: null, canUndo: true } },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(
        'Nothing has happened yet. Share a cause list or an order and it will show up here.',
      ),
    ).toBeVisible();
  },
};

export const FilteredEmpty: Story = {
  args: { initialPage: { items: [], nextCursor: null, canUndo: true }, filters: { level: 'L1' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No activity matches these filters.')).toBeVisible();
  },
};

export const ViewerCannotUndo: Story = {
  args: {
    role: 'viewer',
    initialPage: { items: sampleFeed(), nextCursor: null, canUndo: false },
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /^Undo:/ })).toBeNull();
    await expect(canvas.getAllByText('View only').length).toBeGreaterThan(0);
  },
};

export const CaptureView: Story = {
  args: {
    filters: { capture: '00000000-0000-4000-8000-0000000000c1' },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('button', { name: 'Undo everything from this capture' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Moved to wrong matter? Reassign' }),
    ).toBeVisible();
  },
};

export const Loading: StoryObj = {
  render: () => <ActivitySkeleton />,
};

export const ErrorState: StoryObj = {
  render: () => <ActivityError />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};
