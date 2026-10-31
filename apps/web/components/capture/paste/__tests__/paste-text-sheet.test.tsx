// @vitest-environment jsdom
// The paste-text capture sheet (#1074): Save is off until there is text and a connection, a save
// goes through the capture action, the saved state offers another or Done, and refusals are said.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../../__tests__/helpers/intl.ts';
import { mockMatchMedia, stubResizeObserver } from '../../../shell/__tests__/helpers.tsx';

const action = vi.hoisted(() => ({ pasteTextCaptureAction: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
const search = vi.hoisted(() => ({ value: 'capture=paste&x=1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/w/demo/inbox',
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock('../../../../app/(app)/w/[slug]/inbox/actions.ts', () => action);

const { PasteHost, PasteTextSheet } = await import('../paste-text-sheet.tsx');
const t = catalogs.en.shell.pasteText;
const WS = '00000000-0000-4000-8000-000000000a01';

const intl = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {node}
    </NextIntlClientProvider>,
  );

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

const save = () => screen.getByRole('button', { name: t.save });
const type = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: t.label }), { target: { value } });
};

beforeEach(() => {
  mockMatchMedia();
  stubResizeObserver();
  search.value = 'capture=paste&x=1';
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setOnline(true);
});

describe('PasteTextSheet', () => {
  it('keeps Save off until there is text', () => {
    intl(<PasteTextSheet open onOpenChange={vi.fn()} workspaceId={WS} />);
    expect(save().hasAttribute('disabled')).toBe(true);
    type('   ');
    expect(save().hasAttribute('disabled')).toBe(true);
    type('Order dated 12 Nov 2026: list on 03 Dec 2026');
    expect(save().hasAttribute('disabled')).toBe(false);
  });

  it('saves the trimmed text as a capture and offers another or Done', async () => {
    action.pasteTextCaptureAction.mockResolvedValue({ ok: true, data: { captureId: 'c1' } });
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    intl(<PasteTextSheet open onOpenChange={onOpenChange} workspaceId={WS} onSaved={onSaved} />);
    type('  Next hearing 3 Dec 2026  ');
    fireEvent.click(save());
    expect(await screen.findByText(t.saved)).toBeTruthy();
    expect(action.pasteTextCaptureAction).toHaveBeenCalledWith({
      workspaceId: WS,
      text: 'Next hearing 3 Dec 2026',
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: t.another }));
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: t.label }).value).toBe('');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: true, data: { error: 'channelOff' } }, t.errors.channelOff],
    [{ ok: true, data: { error: 'tooLong' } }, t.errors.tooLong],
    [{ ok: false, error: { code: 'FORBIDDEN', message: 'no' } }, t.errors.forbidden],
    [{ ok: false, error: { code: 'INTERNAL', message: 'x' } }, t.errors.generic],
  ])('says why a save was refused and keeps the text (%j)', async (result, message) => {
    action.pasteTextCaptureAction.mockResolvedValue(result);
    intl(<PasteTextSheet open onOpenChange={vi.fn()} workspaceId={WS} />);
    type('Keep me');
    fireEvent.click(save());
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: t.label }).value).toBe(
      'Keep me',
    );
    expect(save().hasAttribute('disabled')).toBe(false);
  });

  it('reports a thrown action as the generic error', async () => {
    action.pasteTextCaptureAction.mockRejectedValue(new Error('network'));
    intl(<PasteTextSheet open onOpenChange={vi.fn()} workspaceId={WS} />);
    type('Keep me');
    fireEvent.click(save());
    expect(await screen.findByText(t.errors.generic)).toBeTruthy();
  });

  it('turns Save off and says why while offline', () => {
    setOnline(false);
    intl(<PasteTextSheet open onOpenChange={vi.fn()} workspaceId={WS} />);
    type('Some text');
    expect(screen.getByText(t.offline)).toBeTruthy();
    expect(save().hasAttribute('disabled')).toBe(true);
    expect(action.pasteTextCaptureAction).not.toHaveBeenCalled();
  });
});

describe('PasteHost', () => {
  it('opens on ?capture=paste and drops only that parameter when it closes', async () => {
    intl(<PasteHost workspaceId={WS} />);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/w/demo/inbox?x=1');
    });
  });

  it('stays closed without the parameter', () => {
    search.value = 'capture=voice';
    intl(<PasteHost workspaceId={WS} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refreshes the page after a save so the inbox shows the new capture', async () => {
    action.pasteTextCaptureAction.mockResolvedValue({ ok: true, data: { captureId: 'c1' } });
    intl(<PasteHost workspaceId={WS} />);
    type('A note');
    fireEvent.click(save());
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
    });
  });
});
