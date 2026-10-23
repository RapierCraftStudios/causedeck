// Calendar feed card (#53): the actions are mocks. States: empty (disclosure to acknowledge), a feed
// with a never-fetched status, the URL shown once after creating, and a workspace-scope owner.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { FeedCard, type CalendarFeedStatus, type IssuedFeedResult } from './feed-card.tsx';

const FEED: CalendarFeedStatus = {
  id: '00000000-0000-4000-8000-0000000000f1',
  scope: 'mine',
  includeParties: false,
  createdAt: new Date('2026-10-01T09:00:00Z'),
  rotatedAt: null,
  lastFetchedAt: null,
};
const ISSUED: IssuedFeedResult = {
  ...FEED,
  url: 'https://app.example.test/api/ics/EXAMPLE_TOKEN_NOT_REAL_0123456789abcdefghijk',
};

const meta = {
  title: 'Settings/Calendar/FeedCard',
  component: FeedCard,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    status: null,
    isOwner: false,
    disclosureVersion: '2026-10-v1',
    masked: 'https://app.example.test/api/ics/••••••••',
    actions: {
      create: fn(() => Promise.resolve({ ok: true as const, data: ISSUED })),
      rotate: fn(() => Promise.resolve({ ok: true as const, data: ISSUED })),
      revoke: fn(() => Promise.resolve({ ok: true as const, data: { revoked: true as const } })),
      setParties: fn(() => Promise.resolve({ ok: true as const, data: FEED })),
    },
  },
} satisfies Meta<typeof FeedCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Create feed' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('checkbox'));
    await expect(canvas.getByRole('button', { name: 'Create feed' })).toBeEnabled();
  },
};

export const WithFeed: Story = { args: { status: FEED } };

export const OwnerChoosesScope: Story = { args: { isOwner: true } };

export const CreatedShowsUrlOnce: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('checkbox'));
    await userEvent.click(canvas.getByRole('button', { name: 'Create feed' }));
    await expect(await canvas.findByRole('button', { name: 'Copy URL' })).toBeVisible();
  },
};
