// @vitest-environment jsdom
// Offline UI (#65 part 5): the banner is a polite warning-tone live region, sync status offers
// Try again and Keep local when failed and toasts once on reconnect, the meter and the card read
// from the offline namespace and clear only after a confirmation.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../../../../__tests__/helpers/intl.ts';
import { OfflineCardView } from '../../settings/privacy/_offline-card.tsx';
import { OfflineBanner } from '../offline-banner.tsx';
import { formatBytes, StorageMeter } from '../storage-meter.tsx';
import { SyncStatus } from '../sync-status.tsx';

const toast = vi.hoisted(() => vi.fn<(message: string) => void>());
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const wrap = (ui: ReactElement, locale: keyof typeof catalogs = 'en') =>
  render(
    createElement(NextIntlClientProvider, {
      locale,
      messages: catalogs[locale],
      timeZone: 'Asia/Kolkata',
      children: ui,
    }),
  );

const SAVED = new Date('2026-10-24T05:12:00Z');

afterEach(() => {
  cleanup();
  toast.mockReset();
});

describe('OfflineBanner', () => {
  it('is a polite live region with a warning tone, never danger, with the saved time', () => {
    wrap(createElement(OfflineBanner, { savedAt: SAVED, online: false, now: SAVED.getTime() }));
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    const banner = region.querySelector('[data-slot="offline-banner"]');
    expect(banner?.getAttribute('data-tone')).toBe('warning');
    expect(banner?.className).not.toMatch(/danger|red/);
    expect(banner?.textContent).toMatch(/You are offline.*Saved .*10:42/);
  });

  it('says the data may be out of date once it is stale', () => {
    wrap(
      createElement(OfflineBanner, {
        savedAt: SAVED,
        online: false,
        now: SAVED.getTime() + 2 * 86_400_000,
      }),
    );
    expect(screen.getByRole('status').textContent).toMatch(/out of date/);
  });

  it('keeps an empty live region while online', () => {
    wrap(createElement(OfflineBanner, { savedAt: SAVED, online: true }));
    expect(screen.getByRole('status').childElementCount).toBe(0);
  });
});

describe('SyncStatus', () => {
  it('failed: Try again and Keep local call back', () => {
    const onRetry = vi.fn();
    const onKeepLocal = vi.fn();
    wrap(createElement(SyncStatus, { state: 'failed', online: true, onRetry, onKeepLocal }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep local' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onKeepLocal).toHaveBeenCalledOnce();
  });

  it('syncing: the spinner stops under reduced motion', () => {
    const { container } = wrap(createElement(SyncStatus, { state: 'syncing', online: true }));
    expect(container.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-reduce:animate-none',
    );
  });

  it('shows the pending count and no retry when idle', () => {
    wrap(createElement(SyncStatus, { state: 'idle', online: true, pending: 2 }));
    expect(screen.getByText('2 changes waiting to sync')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('toasts Back online once when the connection returns', () => {
    const view = (online: boolean) =>
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: catalogs.en,
        children: createElement(SyncStatus, { state: 'idle', online }),
      });
    const { rerender } = render(view(false));
    expect(toast).not.toHaveBeenCalled();
    act(() => {
      rerender(view(true));
    });
    expect(toast).toHaveBeenCalledExactlyOnceWith('Back online. Syncing.');
  });
});

describe('StorageMeter', () => {
  it('formats bytes and shows used of quota', () => {
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
    expect(formatBytes(2048)).toBe('2.0 KB');
    wrap(createElement(StorageMeter, { used: 12 * 1024 * 1024, quota: 500 * 1024 * 1024 }));
    expect(screen.getByText('12 MB of 500 MB used')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Offline storage' })).toBeTruthy();
  });

  it('says so when the device is out of space', () => {
    wrap(createElement(StorageMeter, { used: 100, quota: 100 }));
    expect(screen.getByText(/out of space/)).toBeTruthy();
  });
});

describe('OfflineCardView', () => {
  const base = { status: 'ready', used: 10, quota: 1000, hasData: true } as const;

  it('clears only after the confirmation', () => {
    const onClear = vi.fn();
    wrap(createElement(OfflineCardView, { ...base, onClear }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved data' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('shows the IndexedDB-unavailable notice instead of the meter', () => {
    wrap(
      createElement(OfflineCardView, {
        status: 'unsupported',
        used: null,
        quota: null,
        hasData: false,
        onClear: vi.fn(),
      }),
    );
    expect(screen.getByText('This browser cannot save data for offline use.')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear saved data' })).toBeNull();
  });

  it('shows the denied and opted-out notices', () => {
    const props = { used: null, quota: null, hasData: false, onClear: vi.fn() };
    wrap(createElement(OfflineCardView, { ...props, status: 'denied' }));
    expect(screen.getByText(/blocked offline storage/)).toBeTruthy();
    cleanup();
    wrap(createElement(OfflineCardView, { ...props, status: 'optedOut' }));
    expect(screen.getByText('Offline saving is turned off on this device.')).toBeTruthy();
  });

  it('shows the empty state without a clear button', () => {
    wrap(createElement(OfflineCardView, { ...base, hasData: false, onClear: vi.fn() }));
    expect(screen.getByText('Nothing is saved on this device yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear saved data' })).toBeNull();
  });
});
