// PWA screens (#50): a story per state, with mock handlers and fictional data, so the visual
// baselines cover the share-target screen (saved, uploading, failed, channel disabled), the outbox
// sheet, the install banner and the offline page in both themes.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { OutboxItem, OutboxState } from '../../lib/pwa/outbox/db.ts';

import { InstallBannerView } from './install-banner.tsx';
import { OfflineScreenView } from './offline-screen.tsx';
import { OutboxSheetView } from './outbox-sheet.tsx';
import { ShareTargetView, type ShareWorkspace } from './share-target-screen.tsx';

const NOW = Date.UTC(2026, 9, 23, 6, 0, 0);

function item(n: number, state: OutboxState, extra: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: `item-${String(n)}`,
    batchId: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'ws-1',
    channel: 'share',
    name: n === 1 ? 'order-sheet.pdf' : `photo-${String(n)}.jpg`,
    mime: n === 1 ? 'application/pdf' : 'image/jpeg',
    size: n * 380_000,
    sha256: `hash${String(n)}`,
    createdAt: NOW - n * 60_000,
    state,
    attempts: state === 'failed' ? 8 : 0,
    lastError: state === 'failed' ? 'network' : null,
    encryptedBlob: new ArrayBuffer(0),
    iv: new Uint8Array(12),
    ...extra,
  };
}

const workspace: ShareWorkspace = {
  id: 'ws-1',
  slug: 'chambers',
  name: 'Chambers (fictional)',
  shareEnabled: true,
  canManage: true,
};

const shareBase = {
  signedIn: true,
  signInHref: '/sign-in',
  workspace,
  workspaces: [workspace],
  matters: [{ id: 'm-1', title: 'Meera Rao v. Example Traders (fictional)' }],
  items: [item(1, 'queued'), item(2, 'queued')],
  error: null,
  online: false,
  dataSaver: false,
  matterHintId: '',
  enabling: false,
  enableFailed: false,
  batchId: '00000000-0000-4000-8000-000000000001',
  onMatterHint: fn(),
  onEnable: fn(),
  onRetry: fn(),
  onUploadNow: fn(),
  onFiles: fn(),
};

const meta = {
  title: 'PWA/Screens',
  component: ShareTargetView,
  args: shareBase,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ShareTargetView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShareSaved: Story = {};

export const ShareUploading: Story = {
  args: { online: true, items: [item(1, 'sent'), item(2, 'uploading'), item(3, 'queued')] },
};

export const ShareFailed: Story = {
  args: { online: true, items: [item(1, 'sent'), item(2, 'failed')] },
};

export const ShareChannelDisabled: Story = {
  args: { workspace: { ...workspace, shareEnabled: false } },
};

export const ShareSignedOut: Story = {
  args: { signedIn: false, workspace: null, workspaces: [] },
};

export const OutboxSheet: StoryObj<typeof OutboxSheetView> = {
  render: () => (
    <OutboxSheetView
      open
      onOpenChange={fn()}
      onRetry={fn()}
      onRemove={fn()}
      onUploadNow={fn()}
      now={NOW}
      items={[item(1, 'queued'), item(2, 'uploading'), item(3, 'failed')]}
    />
  ),
};

export const InstallBannerAndroid: StoryObj<typeof InstallBannerView> = {
  render: () => (
    <InstallBannerView mode="android" onInstall={fn()} onDismiss={fn()} onFiles={fn()} />
  ),
};

export const InstallBannerIos: StoryObj<typeof InstallBannerView> = {
  render: () => <InstallBannerView mode="ios" onInstall={fn()} onDismiss={fn()} onFiles={fn()} />,
};

export const Offline: StoryObj<typeof OfflineScreenView> = {
  render: () => <OfflineScreenView waiting={3} />,
};
