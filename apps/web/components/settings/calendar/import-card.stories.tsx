// Calendar import card (#53): the upload is a stub. Idle, and a channel that is switched off.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ImportCard, type CalendarUpload } from './import-card.tsx';

const meta = {
  title: 'Settings/Calendar/ImportCard',
  component: ImportCard,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    reviewHrefBase: '',
    upload: (): Promise<CalendarUpload> =>
      Promise.resolve({ ok: true, captureId: 'c-1', duplicate: false }),
  },
} satisfies Meta<typeof ImportCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const ChannelOff: Story = {
  args: {
    upload: (): Promise<CalendarUpload> => Promise.resolve({ ok: false, error: 'channel_off' }),
  },
};
