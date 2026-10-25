// Courts offline banner (#399): "Showing saved court information" only while the browser is
// offline. The stories stub `navigator.onLine` and restore it afterwards.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor } from 'storybook/test';

import { CourtsOfflineBanner } from './courts-offline-banner.tsx';

/** Answer `navigator.onLine` with `online` until the returned cleanup runs. */
function stubOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  return () => {
    // The own property shadows the prototype getter; removing it restores the real value.
    Reflect.deleteProperty(navigator, 'onLine');
  };
}

const meta = {
  title: 'Courts/CourtsOfflineBanner',
  component: CourtsOfflineBanner,
} satisfies Meta<typeof CourtsOfflineBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offline: Story = {
  beforeEach: () => stubOnline(false),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-courts-offline]')).not.toBeNull(),
    );
  },
};

/** Online: nothing renders. */
export const Online: Story = {
  beforeEach: () => stubOnline(true),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-courts-offline]')).toBeNull();
  },
};

export const Tamil: Story = { beforeEach: () => stubOnline(false), globals: { locale: 'ta' } };

export const Kannada: Story = { beforeEach: () => stubOnline(false), globals: { locale: 'kn' } };
