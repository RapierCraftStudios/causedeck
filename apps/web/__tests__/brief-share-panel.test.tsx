// @vitest-environment jsdom
// The owner's brief sharing panel (#507): create a link with the chosen expiry and show it once
// with Copy, list the active links, revoke one, show the rate-limit message, and offer no create
// controls without a listing or without `canShare`.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BriefSharePanel,
  type BriefSharePanelProps,
  type ShareLinkView,
} from '../components/shares/brief-share-panel.tsx';

import { catalogs } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/w/demo' }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const WS = '00000000-0000-4000-8000-00000000a001';
const LISTING = '00000000-0000-4000-8000-0000000c0001';
const t = catalogs.en.share.manage;

const link: ShareLinkView = {
  id: 'share-1',
  matterTitle: 'Ravi v State',
  createdAt: '2026-10-25T04:00:00.000Z',
  expiresAt: '2026-11-01T04:00:00.000Z',
  canRevoke: true,
};

function setup(overrides: Partial<BriefSharePanelProps> = {}) {
  const actions = {
    create: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { id: 'share-2', path: '/share/tok_secret', expiresAt: '2026-11-08T04:00:00.000Z' },
      }),
    ),
    revoke: vi.fn(() => Promise.resolve({ ok: true as const, data: { id: 'share-1' } })),
  };
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <BriefSharePanel
        workspaceId={WS}
        listingId={LISTING}
        canShare
        shares={[link]}
        actions={actions}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
  return actions;
}

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BriefSharePanel', () => {
  it('creates a link with the chosen expiry and shows the absolute URL once, with Copy', async () => {
    const actions = setup();
    fireEvent.change(screen.getByLabelText(t.expiry), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    await waitFor(() => {
      expect(actions.create).toHaveBeenCalledWith({
        workspaceId: WS,
        listingId: LISTING,
        expiresInDays: 14,
      });
    });
    const input = await screen.findByLabelText<HTMLInputElement>(t.linkLabel);
    expect(input.value).toBe(`${window.location.origin}/share/tok_secret`);
    expect(router.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.copy }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(input.value);
    });
    expect(toast.success).toHaveBeenCalledWith(t.copied);
  });

  it('lists the active links and revokes one', async () => {
    const actions = setup();
    const row = document.querySelector('[data-share="share-1"]') as HTMLElement;
    expect(within(row).getByText('Ravi v State')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: /Revoke the link for Ravi v State/ }));
    await waitFor(() => {
      expect(actions.revoke).toHaveBeenCalledWith({ workspaceId: WS, shareId: 'share-1' });
    });
    expect(toast.success).toHaveBeenCalledWith(t.revoked);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows the empty state, and no Revoke on a link the viewer may not revoke', () => {
    setup({ shares: [] });
    expect(screen.getByText(t.empty)).toBeTruthy();
    cleanup();
    setup({ shares: [{ ...link, canRevoke: false }] });
    expect(document.querySelector('[data-share-revoke]')).toBeNull();
  });

  it('shows the rate-limit message and no URL when creating is refused', async () => {
    const actions = setup();
    actions.create.mockResolvedValueOnce({
      ok: false,
      error: { code: 'CONFLICT', message: 'RATE_LIMITED' },
    } as never);
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.errors.rateLimited);
    expect(screen.queryByLabelText(t.linkLabel)).toBeNull();
  });

  it('offers no create control without a listing or without canShare', () => {
    setup({ listingId: null });
    expect(screen.getByText(t.noListing)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.create })).toBeNull();
    cleanup();
    setup({ canShare: false });
    expect(screen.queryByRole('button', { name: t.create })).toBeNull();
  });
});
