// One activity in the feed (#49): auto-applied with its undo countdown, undone, window ended, view
// only, offline (Undo paused) and a row about a matter the member may not read.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { ActivityItem } from './activity-item.tsx';
import { activity, MEMBERS, NOW, OWNER } from './__tests__/fixtures.ts';

const names = new Map(MEMBERS.map((m) => [m.userId, m.name]));

const meta = {
  title: 'Activity/ActivityItem',
  component: ActivityItem,
  args: {
    item: activity(),
    workspaceSlug: 'demo',
    now: NOW,
    names,
    canUndo: true,
    offline: false,
    focused: true,
    undone: undefined,
    onUndo: () => undefined,
    onOpenCapture: () => undefined,
    onFocus: () => undefined,
  },
  decorators: [
    (Story) => (
      <ul className="max-w-3xl p-4">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof ActivityItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AutoApplied: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /^Undo: Attached order/ })).toBeVisible();
    await expect(canvas.getByText('Undo available for 6 more days')).toBeVisible();
  },
};

export const Undone: Story = {
  args: {
    item: activity({ undoneAt: '2026-10-21T05:00:00.000Z', undoneBy: OWNER, undoable: false }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^Undone by Asha Rao at /)).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /^Undo:/ })).toBeNull();
  },
};

export const WindowEnded: Story = {
  args: {
    item: activity({
      createdAt: '2026-10-10T05:00:00.000Z',
      undoExpiresAt: '2026-10-17T05:00:00.000Z',
      undoable: false,
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Undo window ended')).toBeVisible();
  },
};

export const ViewOnly: Story = {
  args: { canUndo: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('View only')).toBeVisible();
  },
};

export const Offline: Story = {
  args: { offline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /^Undo:/ })).toBeDisabled();
    await expect(canvas.getByText('Undo needs a connection.')).toBeVisible();
  },
};

export const Redacted: Story = {
  args: {
    item: activity({ summary: null, redacted: true, matterId: null, matterTitle: null }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('A change to a restricted matter')).toBeVisible();
  },
};
