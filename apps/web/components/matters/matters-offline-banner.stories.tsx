// Matters offline banner (#388): says the list is the last saved one and changes will not save.
// `forced` shows it without the browser going offline.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { MattersOfflineBanner } from './matters-offline-banner.tsx';

const meta = {
  title: 'Matters/MattersOfflineBanner',
  component: MattersOfflineBanner,
} satisfies Meta<typeof MattersOfflineBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Online: nothing renders. */
export const Online: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByText(/offline/i)).toBeNull();
  },
};

export const Offline: Story = {
  args: { forced: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/You're offline/)).toBeVisible();
  },
};

export const Tamil: Story = { args: { forced: true }, globals: { locale: 'ta' } };

export const Kannada: Story = { args: { forced: true }, globals: { locale: 'kn' } };
