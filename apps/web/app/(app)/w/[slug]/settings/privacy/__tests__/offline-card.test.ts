// @vitest-environment jsdom
// The privacy page's offline card (#65 part 5) reads the browser: no IndexedDB shows the
// unavailable notice, a blocked one the denied notice, otherwise the quota meter; confirming
// `Clear saved data` deletes the offline databases and refreshes the numbers.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../../../../../__tests__/helpers/intl.ts';
import { OfflineCard } from '../_offline-card.tsx';

const deleteAllOfflineDbs = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../../../../../../lib/offline/db.ts', () => ({ deleteAllOfflineDbs }));

const mount = () =>
  render(
    createElement(NextIntlClientProvider, {
      locale: 'en',
      messages: catalogs.en,
      children: createElement(OfflineCard),
    }),
  );

const stubBrowser = (databases: () => Promise<{ name: string }[]>, usage: number) => {
  vi.stubGlobal('indexedDB', { databases });
  vi.stubGlobal('navigator', {
    storage: { estimate: () => Promise.resolve({ usage, quota: 1000 }) },
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  deleteAllOfflineDbs.mockClear();
});

describe('OfflineCard', () => {
  it('shows the unavailable notice without IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    mount();
    expect(await screen.findByText('This browser cannot save data for offline use.')).toBeTruthy();
  });

  it('shows the denied notice when the browser blocks site data', async () => {
    stubBrowser(() => Promise.reject(new Error('SecurityError')), 0);
    mount();
    expect(await screen.findByText(/blocked offline storage/)).toBeTruthy();
  });

  it('clears the offline databases after the confirmation and refreshes', async () => {
    let names = [{ name: 'causedeck-offline:u1:w1' }, { name: 'other-app' }];
    stubBrowser(() => Promise.resolve(names), 500);
    deleteAllOfflineDbs.mockImplementationOnce(() => {
      names = [];
      return Promise.resolve();
    });
    mount();
    expect(await screen.findByText('500 B of 1000 B used')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved data' }));
    expect(deleteAllOfflineDbs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved data' }));
    await waitFor(() => {
      expect(deleteAllOfflineDbs).toHaveBeenCalledOnce();
    });
    expect(await screen.findByText('Saved data removed from this device')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear saved data' })).toBeNull();
  });

  it('reports a failed clear', async () => {
    stubBrowser(() => Promise.resolve([{ name: 'causedeck-offline:u1:w1' }]), 5);
    deleteAllOfflineDbs.mockRejectedValueOnce(new Error('blocked'));
    mount();
    await screen.findByText(/used/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved data' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be removed/);
  });
});
