// Calendar import card (#53): the upload is a mock. Idle, and a channel that is switched off.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { ImportCard } from './import-card.tsx';

const meta = {
  title: 'Settings/Calendar/ImportCard',
  component: ImportCard,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    reviewHref: (captureId: string) => `?capture=${captureId}`,
    upload: fn(() => Promise.resolve({ ok: true as const, captureId: 'c-1', duplicate: false })),
  },
} satisfies Meta<typeof ImportCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const ChannelOff: Story = {
  args: {
    upload: fn(() => Promise.resolve({ ok: false as const, error: 'channel_off' as const })),
  },
};
