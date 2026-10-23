// @vitest-environment jsdom
// The PWA screens (#50): outbox indicator and sheet, share-target states, install banner, update
// toast and the offline screen, against the real English catalog. Fictional file names only.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import type { OutboxItem } from '../../../lib/pwa/outbox/db.ts';
import { InstallBannerView } from '../install-banner.tsx';
import { OfflineScreenView } from '../offline-screen.tsx';
import { OutboxIndicatorView } from '../outbox-indicator.tsx';
import { OutboxSheetView } from '../outbox-sheet.tsx';
import {
  ShareTargetView,
  type ShareTargetViewProps,
  type ShareWorkspace,
} from '../share-target-screen.tsx';
import { UpdateToastView } from '../update-toast.tsx';

const t = catalogs.en.pwa;

afterEach(cleanup);

const withIntl = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const row = (patch: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'item-1',
  batchId: 'batch-1',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  channel: 'share',
  name: 'order-copy.pdf',
  mime: 'application/pdf',
  size: 2_400_000,
  sha256: 'a'.repeat(64),
  createdAt: 0,
  state: 'queued',
  attempts: 0,
  lastError: null,
  encryptedBlob: new ArrayBuffer(8),
  iv: new Uint8Array(12),
  ...patch,
});

const summary = (patch: Partial<Parameters<typeof OutboxIndicatorView>[0]['summary']> = {}) => ({
  waiting: 0,
  uploading: 0,
  failed: 0,
  total: 0,
  position: 0,
  ...patch,
});

describe('OutboxIndicatorView', () => {
  it('renders nothing when nothing is waiting', () => {
    withIntl(<OutboxIndicatorView summary={summary()} onOpen={vi.fn()} />);
    expect(document.querySelector('[data-outbox-indicator]')).toBeNull();
  });

  it('says how many are waiting', () => {
    withIntl(<OutboxIndicatorView summary={summary({ waiting: 3, total: 3 })} onOpen={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toContain('3 waiting to upload');
  });

  it('says which one is uploading', () => {
    withIntl(
      <OutboxIndicatorView
        summary={summary({ waiting: 2, uploading: 1, total: 3, position: 1 })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('Uploading 1 of 3');
  });

  it('puts a failure first and opens the sheet on tap', () => {
    const onOpen = vi.fn();
    withIntl(
      <OutboxIndicatorView
        summary={summary({ waiting: 2, failed: 1, total: 3 })}
        onOpen={onOpen}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('1 failed, tap to retry');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('OutboxSheetView', () => {
  const handlers = { onRetry: vi.fn(), onRemove: vi.fn(), onUploadNow: vi.fn() };

  it('lists items with size, age and retry/remove actions', () => {
    withIntl(
      <OutboxSheetView
        open
        onOpenChange={vi.fn()}
        now={3 * 60 * 60 * 1000}
        items={[
          row(),
          row({ id: 'item-2', name: 'photo.jpg', state: 'failed', lastError: 'too_large' }),
        ]}
        {...handlers}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const items = dialog.querySelectorAll('[data-outbox-item]');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('2.3 MB');
    expect(items[0]?.textContent).toContain('3 hours ago');
    expect(items[1]?.textContent).toContain(t.share.reason.too_large);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry photo.jpg' }));
    expect(handlers.onRetry).toHaveBeenCalledWith('item-2');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove order-copy.pdf from this device' }),
    );
    expect(handlers.onRemove).toHaveBeenCalledWith('item-1');
    fireEvent.click(within(dialog).getByRole('button', { name: t.outbox.sheet.uploadNow }));
    expect(handlers.onUploadNow).toHaveBeenCalled();
  });

  it('warns at 80% of the cap and blocks at 100%', () => {
    const { rerender } = withIntl(
      <OutboxSheetView
        open
        onOpenChange={vi.fn()}
        items={[row({ size: 85 })]}
        capBytes={100}
        {...handlers}
      />,
    );
    expect(screen.getByText(/almost full \(85%\)/)).toBeTruthy();
    rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
        <OutboxSheetView
          open
          onOpenChange={vi.fn()}
          items={[row({ size: 100 })]}
          capBytes={100}
          {...handlers}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(t.outbox.sheet.capFull)).toBeTruthy();
  });

  it('says so when nothing is waiting', () => {
    withIntl(<OutboxSheetView open onOpenChange={vi.fn()} items={[]} {...handlers} />);
    expect(screen.getByText(t.outbox.sheet.empty)).toBeTruthy();
  });
});

const workspace = (patch: Partial<ShareWorkspace> = {}): ShareWorkspace => ({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'rao-chambers',
  name: 'Rao Chambers (fictional)',
  shareEnabled: true,
  canManage: true,
  ...patch,
});

function shareProps(patch: Partial<ShareTargetViewProps> = {}): ShareTargetViewProps {
  const chosen = workspace();
  return {
    signedIn: true,
    signInHref: '/sign-in?next=%2Fshare-target',
    workspace: chosen,
    workspaces: [chosen],
    matters: [],
    items: [row()],
    error: null,
    online: true,
    dataSaver: false,
    matterHintId: '',
    enabling: false,
    enableFailed: false,
    batchId: 'batch-1',
    onMatterHint: vi.fn(),
    onEnable: vi.fn(),
    onRetry: vi.fn(),
    onUploadNow: vi.fn(),
    onFiles: vi.fn(),
    ...patch,
  };
}

describe('ShareTargetView', () => {
  it('reassures first: saved, uploading when online', () => {
    withIntl(<ShareTargetView {...shareProps()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.share.title);
    expect(screen.getByRole('status').textContent).toBe("Saved. Uploading when you're online.");
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByRole('link', { name: 'Open Inbox' }).getAttribute('href')).toBe(
      '/w/rao-chambers/inbox',
    );
  });

  it('treats offline as a calm state, not an error', () => {
    withIntl(<ShareTargetView {...shareProps({ online: false })} />);
    expect(screen.getByRole('status').textContent).toBe(t.share.savedOffline);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows progress for the file being uploaded', () => {
    withIntl(
      <ShareTargetView
        {...shareProps({
          items: [row({ state: 'uploading' }), row({ id: 'item-2', name: 'b.pdf' })],
        })}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Uploading 1 of 2');
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('shows a failed file with its reason and a Retry action', () => {
    const onRetry = vi.fn();
    withIntl(
      <ShareTargetView
        {...shareProps({
          items: [row({ state: 'failed', lastError: 'unsupported_type' })],
          onRetry,
        })}
      />,
    );
    expect(screen.getByText(/Couldn't upload\. Retry/).textContent).toContain(
      t.share.reason.unsupported_type,
    );
    fireEvent.click(screen.getByRole('button', { name: t.share.retry }));
    expect(onRetry).toHaveBeenCalledWith('item-1');
  });

  it('explains "Where your data goes" when the share channel is off, with Enable for managers', () => {
    const onEnable = vi.fn();
    const off = workspace({ shareEnabled: false });
    withIntl(<ShareTargetView {...shareProps({ workspace: off, workspaces: [off], onEnable })} />);
    expect(screen.getByText(t.share.channel.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t.share.channel.enable }));
    expect(onEnable).toHaveBeenCalled();
    // Files stay on the device: no picker for new uploads until it is on.
    expect(screen.queryByRole('button', { name: t.share.empty.upload })).toBeNull();
  });

  it('asks a member who cannot manage channels to ask an owner', () => {
    const off = workspace({ shareEnabled: false, canManage: false });
    withIntl(<ShareTargetView {...shareProps({ workspace: off, workspaces: [off] })} />);
    expect(screen.getByText(t.share.channel.ask)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.share.channel.enable })).toBeNull();
  });

  it('asks for the workspace when the member has several', () => {
    const a = workspace();
    const b = workspace({ id: '00000000-0000-4000-8000-000000000002', name: 'Second Chambers' });
    withIntl(<ShareTargetView {...shareProps({ workspace: null, workspaces: [a, b] })} />);
    const select = screen.getByLabelText<HTMLSelectElement>(t.share.workspace.label);
    expect(select.name).toBe('ws');
    expect(within(select).getAllByRole('option').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('link', { name: 'Open Inbox' })).toBeNull();
  });

  it('offers an optional matter hint', () => {
    const onMatterHint = vi.fn();
    withIntl(
      <ShareTargetView
        {...shareProps({
          matters: [
            { id: '00000000-0000-4000-8000-0000000000aa', title: 'Meera Rao v. Example Traders' },
          ],
          onMatterHint,
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText(t.share.matter.label), {
      target: { value: '00000000-0000-4000-8000-0000000000aa' },
    });
    expect(onMatterHint).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000aa');
  });

  it('asks a signed-out visitor to sign in and promises the files stay on the device', () => {
    withIntl(
      <ShareTargetView {...shareProps({ signedIn: false, workspace: null, workspaces: [] })} />,
    );
    expect(screen.getByText(t.share.signIn.title)).toBeTruthy();
    expect(screen.getByText(t.share.signIn.body)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.share.signIn.action }).getAttribute('href')).toBe(
      '/sign-in?next=%2Fshare-target',
    );
  });

  it('shows the empty state with an Upload button when opened without files', () => {
    withIntl(<ShareTargetView {...shareProps({ items: [], batchId: null })} />);
    expect(screen.getByText(t.share.empty.body)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.share.empty.upload })).toBeTruthy();
  });

  it('says the queue is full when the cap blocked the share', () => {
    withIntl(<ShareTargetView {...shareProps({ items: [], error: 'full' })} />);
    expect(screen.getByRole('alert').textContent).toContain('is full');
  });

  it('offers Upload now only while data saver holds uploads back', () => {
    const onUploadNow = vi.fn();
    withIntl(<ShareTargetView {...shareProps({ dataSaver: true, onUploadNow })} />);
    fireEvent.click(screen.getByRole('button', { name: t.share.uploadNow }));
    expect(onUploadNow).toHaveBeenCalled();
  });
});

describe('InstallBannerView', () => {
  it('Android: Install and Not now', () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    withIntl(
      <InstallBannerView
        mode="android"
        onInstall={onInstall}
        onDismiss={onDismiss}
        onFiles={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t.install.install }));
    fireEvent.click(screen.getByRole('button', { name: t.install.dismiss }));
    expect(onInstall).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('iOS: add-to-home-screen steps and an Upload files button, no install button', () => {
    withIntl(
      <InstallBannerView mode="ios" onInstall={vi.fn()} onDismiss={vi.fn()} onFiles={vi.fn()} />,
    );
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.install.ios.upload })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.install.install })).toBeNull();
  });
});

describe('UpdateToastView', () => {
  it('offers Update now only outside court-day windows', () => {
    const onUpdateNow = vi.fn();
    const { rerender } = withIntl(
      <UpdateToastView offerUpdateNow={false} onUpdateNow={onUpdateNow} />,
    );
    expect(screen.getByText(t.update.ready)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.update.now })).toBeNull();
    rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en}>
        <UpdateToastView offerUpdateNow onUpdateNow={onUpdateNow} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: t.update.now }));
    expect(onUpdateNow).toHaveBeenCalled();
  });
});

describe('OfflineScreenView', () => {
  it('states what works and what does not, the outbox summary and a way back', () => {
    withIntl(<OfflineScreenView waiting={2} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.offline.title);
    expect(screen.getByText(t.offline.works.saved)).toBeTruthy();
    expect(screen.getByText(t.offline.works.capture)).toBeTruthy();
    expect(screen.getByText(t.offline.doesNot.items)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('2 files waiting to upload');
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('/');
  });

  it('says nothing is waiting when the outbox is empty', () => {
    withIntl(<OfflineScreenView waiting={0} />);
    expect(screen.getByRole('status').textContent).toBe(t.offline.outbox.none);
  });
});
