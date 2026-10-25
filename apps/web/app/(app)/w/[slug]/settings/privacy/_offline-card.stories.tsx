// Offline card on the privacy page (#65 part 5): every state, with the clear flow tested.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import { OfflineCardView } from './_offline-card.tsx';

const MB = 1024 * 1024;

const meta = {
  title: 'Settings/OfflineCard',
  component: OfflineCardView,
  args: {
    status: 'ready',
    used: 12 * MB,
    quota: 500 * MB,
    hasData: true,
    onClear: fn(),
  },
} satisfies Meta<typeof OfflineCardView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `Clear saved data` asks first; confirming calls `onClear`, cancelling does not. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('12 MB of 500 MB used')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear saved data' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onClear).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear saved data' }));
    await expect(canvas.getByText(/Remove all saved court days/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear saved data' }));
    await expect(args.onClear).toHaveBeenCalledOnce();
  },
};

export const Empty: Story = {
  args: { used: 0, hasData: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing is saved on this device yet')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Clear saved data' })).toBeNull();
  },
};

export const Loading: Story = {
  args: { status: 'loading', used: null, quota: null, hasData: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Checking saved data')).toBeVisible();
  },
};

export const ClearFailed: Story = {
  args: { error: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('could not be removed');
  },
};

export const Cleared: Story = {
  args: { cleared: true, used: 0, hasData: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Saved data removed from this device')).toBeVisible();
  },
};

/** Offline: the card still works, the data is on this device. */
export const Offline: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Clear saved data' })).toBeEnabled();
  },
};

export const Denied: Story = {
  args: { status: 'denied', used: null, quota: null, hasData: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/blocked offline storage/)).toBeVisible();
  },
};

export const OptedOut: Story = {
  args: { status: 'optedOut', used: null, quota: null, hasData: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Offline saving is turned off on this device.')).toBeVisible();
  },
};

export const StorageFull: Story = {
  args: { used: 500 * MB },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/out of space/)).toBeVisible();
  },
};

export const IndexedDbUnavailable: Story = {
  args: { status: 'unsupported', used: null, quota: null, hasData: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('This browser cannot save data for offline use.')).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };
export const Kannada: Story = { globals: { locale: 'kn' } };
