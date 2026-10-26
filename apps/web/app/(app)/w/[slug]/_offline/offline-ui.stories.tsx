// Offline UI (#65 part 5): banner, sync status and storage meter in every state, with interaction
// tests. Offline and denied are covered by the banner (`online: false`) and the meter's no-quota
// state; the card's own states are in settings/privacy/_offline-card.stories.tsx.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import { OfflineBanner } from './offline-banner.tsx';
import { StorageMeter } from './storage-meter.tsx';
import { SyncStatus } from './sync-status.tsx';

const SAVED = new Date('2026-10-24T10:42:00+05:30');

const banner = {
  title: 'Offline/OfflineBanner',
  component: OfflineBanner,
  args: { savedAt: SAVED, online: false, now: SAVED.getTime() },
} satisfies Meta<typeof OfflineBanner>;

export default banner;
type Banner = StoryObj<typeof banner>;

/** Offline with a saved time: a polite live region in the warning tone. */
export const Offline: Banner = {
  play: async ({ canvas }) => {
    const region = canvas.getByRole('status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(canvas.getByText(/You are offline/)).toBeVisible();
    await expect(canvas.getByText(/Saved/)).toBeVisible();
    await expect(region.querySelector('[data-tone="warning"]')).not.toBeNull();
  },
};

/** Saved more than a day ago: says it may be out of date. */
export const Stale: Banner = {
  args: { now: SAVED.getTime() + 2 * 24 * 60 * 60 * 1000 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/out of date/)).toBeVisible();
  },
};

/** Offline with nothing saved yet. */
export const Empty: Banner = {
  args: { savedAt: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/You are offline/)).toBeVisible();
    await expect(canvas.queryByText(/Saved/)).toBeNull();
  },
};

/** Online: the live region stays mounted and empty. */
export const BannerOnline: Banner = {
  args: { online: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement();
  },
};

export const Tamil: Banner = { globals: { locale: 'ta' } };
export const Kannada: Banner = { globals: { locale: 'kn' } };

export const SyncDefault: StoryObj<typeof SyncStatus> = {
  name: 'Sync status/Default',
  render: () => <SyncStatus state="idle" online lastSyncedAt={SAVED} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Everything is saved')).toBeVisible();
  },
};

export const SyncPending: StoryObj<typeof SyncStatus> = {
  name: 'Sync status/Pending',
  render: () => <SyncStatus state="idle" online pending={3} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('3 changes waiting to sync')).toBeVisible();
  },
};

/** The spinner stops under reduced motion (`motion-reduce:animate-none`). */
export const SyncLoading: StoryObj<typeof SyncStatus> = {
  name: 'Sync status/Loading',
  render: () => <SyncStatus state="syncing" online />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Syncing')).toBeVisible();
  },
};

export const SyncError: StoryObj<typeof SyncStatus> = {
  name: 'Sync status/Error',
  render: () => {
    const onRetry = fn();
    const onKeepLocal = fn();
    return <SyncStatus state="failed" online onRetry={onRetry} onKeepLocal={onKeepLocal} />;
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Some changes could not sync')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Keep local' }));
  },
};

export const SyncOffline: StoryObj<typeof SyncStatus> = {
  name: 'Sync status/Offline',
  render: () => <SyncStatus state="idle" online={false} pending={2} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('2 changes waiting to sync')).toBeVisible();
  },
};

export const MeterDefault: StoryObj<typeof StorageMeter> = {
  name: 'Storage meter/Default',
  render: () => <StorageMeter used={12 * 1024 * 1024} quota={500 * 1024 * 1024} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('12 MB of 500 MB used')).toBeVisible();
    await expect(canvas.getByRole('progressbar', { name: 'Offline storage' })).toBeVisible();
  },
};

export const MeterEmpty: StoryObj<typeof StorageMeter> = {
  name: 'Storage meter/Empty',
  render: () => <StorageMeter used={0} quota={500 * 1024 * 1024} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('0 B of 500 MB used')).toBeVisible();
  },
};

export const MeterLoading: StoryObj<typeof StorageMeter> = {
  name: 'Storage meter/Loading',
  render: () => <StorageMeter used={null} quota={null} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Checking saved data')).toBeVisible();
  },
};

/** Browser reports no quota (denied or unsupported estimate): the size alone. */
export const MeterDenied: StoryObj<typeof StorageMeter> = {
  name: 'Storage meter/Denied',
  render: () => <StorageMeter used={2048} quota={null} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('2.0 KB saved on this device')).toBeVisible();
  },
};

export const MeterFull: StoryObj<typeof StorageMeter> = {
  name: 'Storage meter/Error',
  render: () => <StorageMeter used={500 * 1024 * 1024} quota={500 * 1024 * 1024} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/out of space/)).toBeVisible();
  },
};
