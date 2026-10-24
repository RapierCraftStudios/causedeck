// The email channel card (#54): the data-flow note and the switch, off and on.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ChannelCard } from './channel-card.tsx';

const meta = {
  title: 'Settings/Email/ChannelCard',
  component: ChannelCard,
  args: {
    workspaceId: 'ws-1',
    enabled: true,
    channelOn: false,
    enable: () =>
      Promise.resolve({ ok: true as const, data: { enabled: true, disclosureVersion: 'v1' } }),
  },
} satisfies Meta<typeof ChannelCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = { args: { channelOn: true } };

export const NotEnabled: Story = { args: { enabled: false } };
