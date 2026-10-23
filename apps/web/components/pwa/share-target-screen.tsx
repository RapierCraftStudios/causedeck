'use client';

// The share-target screen (#50). Reassurance first ("Saved"), upload state second, optional
// choices third. The service worker already wrote the shared files to the encrypted outbox before
// this page loaded; here the person picks the workspace (several), sees the "Where your data goes"
// note when the `share` channel is off (the files stay on the device until it is enabled), may add
// a matter hint, and opens the Inbox. Progress is announced through a polite live region.
import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Card } from '@causedeck/ui/card';
import { Progress } from '@causedeck/ui/progress';
import { Check, CloudOff, FileAudio, FileImage, FileText } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { OutboxItem } from '../../lib/pwa/outbox/db.ts';
import { summarize } from '../../lib/pwa/outbox/queue.ts';

import { SHARE_FILE_ACCEPT } from './install-banner.tsx';
import { useOutbox } from './outbox-indicator.tsx';

export interface ShareWorkspace {
  id: string;
  slug: string;
  name: string;
  /** Whether the `share` capture channel is on for the workspace. */
  shareEnabled: boolean;
  /** Whether this member may turn a channel on. */
  canManage: boolean;
}

export interface ShareMatter {
  id: string;
  title: string;
}

export interface ShareTargetViewProps {
  signedIn: boolean;
  signInHref: string;
  /** The chosen workspace; `null` while the person still has to pick one. */
  workspace: ShareWorkspace | null;
  workspaces: readonly ShareWorkspace[];
  matters: readonly ShareMatter[];
  items: readonly OutboxItem[];
  error: 'full' | 'failed' | null;
  online: boolean;
  dataSaver: boolean;
  /** Matter hint chosen so far. */
  matterHintId: string;
  enabling: boolean;
  enableFailed: boolean;
  batchId: string | null;
  onMatterHint: (id: string) => void;
  onEnable: () => void;
  onRetry: (id: string) => void;
  onUploadNow: () => void;
  onFiles: (files: File[]) => void;
}

function FileIcon({ mime }: { mime: string }) {
  const className = 'text-ink-muted size-5 shrink-0';
  if (mime.startsWith('image/')) return <FileImage aria-hidden="true" className={className} />;
  if (mime.startsWith('audio/')) return <FileAudio aria-hidden="true" className={className} />;
  return <FileText aria-hidden="true" className={className} />;
}

type ReasonKey =
  'too_large' | 'unsupported_type' | 'forbidden' | 'not_found' | 'invalid' | 'network' | 'other';

const REASON_KEYS: readonly ReasonKey[] = [
  'too_large',
  'unsupported_type',
  'forbidden',
  'not_found',
  'invalid',
  'network',
];

function reasonKey(error: string | null): ReasonKey {
  return REASON_KEYS.find((key) => key === error) ?? 'other';
}

function FileRow({ item, onRetry }: { item: OutboxItem; onRetry: (id: string) => void }) {
  const t = useTranslations('pwa.share');
  const format = useFormatter();
  const megabytes = item.size / (1024 * 1024);
  const size =
    megabytes >= 1
      ? `${format.number(megabytes, { maximumFractionDigits: 1 })} MB`
      : `${format.number(Math.max(1, Math.round(item.size / 1024)))} KB`;
  const value = item.state === 'sent' ? 100 : item.state === 'uploading' ? null : 0;
  return (
    <li data-share-file="" data-state={item.state} className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <FileIcon mime={item.mime} />
        <p className="text-ink min-w-0 flex-1 truncate text-sm font-medium">{item.name}</p>
        <span className="text-ink-muted shrink-0 text-xs">{size}</span>
      </div>
      <Progress
        aria-label={`${item.name}: ${t(`status.${item.state}`)}`}
        value={value}
        tone={item.state === 'failed' ? 'danger' : item.state === 'sent' ? 'success' : 'accent'}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-muted text-xs">
          {t(`status.${item.state}`)}
          {item.state === 'failed' ? ` · ${t(`reason.${reasonKey(item.lastError)}`)}` : ''}
        </p>
        {item.state === 'failed' ? (
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              onRetry(item.id);
            }}
          >
            {t('retry')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function ShareTargetView(props: ShareTargetViewProps) {
  const t = useTranslations('pwa.share');
  const heading = useRef<HTMLHeadingElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { workspace, workspaces, items, error, online } = props;

  // Focus moves to the status heading on load.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const summary = summarize(items);
  const channelOff = workspace !== null && !workspace.shareEnabled;
  let status: string;
  if (items.length > 0 && items.every((item) => item.state === 'sent')) status = t('allSent');
  else if (summary.uploading > 0) {
    status = t('uploadingOf', { current: summary.position, total: summary.total });
  } else status = online ? t('savedOnline') : t('savedOffline');

  const empty = items.length === 0;
  return (
    <main
      id="main"
      tabIndex={-1}
      className="bg-surface mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-start px-4 py-6 md:justify-center md:px-0"
    >
      <Card className="flex flex-col gap-5 p-5 md:p-6">
        <div className="flex items-start gap-3">
          {online ? (
            <Check aria-hidden="true" className="text-success mt-1 size-6 shrink-0" />
          ) : (
            <CloudOff aria-hidden="true" className="text-info mt-1 size-6 shrink-0" />
          )}
          <div className="flex flex-col gap-1">
            <h1 ref={heading} tabIndex={-1} className="text-ink text-xl font-semibold outline-none">
              {empty ? t('empty.title') : t('title')}
            </h1>
            <p
              role="status"
              aria-live="polite"
              data-share-status=""
              className="text-ink-muted text-sm"
            >
              {empty ? t('empty.body') : status}
            </p>
          </div>
        </div>

        {error === null ? null : (
          <Alert tone={error === 'full' ? 'danger' : 'warning'}>
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        )}

        {props.signedIn ? null : (
          <Alert tone="info" data-share-signin="">
            <div className="flex flex-col gap-3">
              <AlertTitle>{t('signIn.title')}</AlertTitle>
              <AlertDescription>{t('signIn.body')}</AlertDescription>
              <Button asChild size="lg">
                <a href={props.signInHref}>{t('signIn.action')}</a>
              </Button>
            </div>
          </Alert>
        )}

        {empty ? null : (
          <ul aria-label={t('filesLabel')} className="divide-line divide-y">
            {items.map((item) => (
              <FileRow key={item.id} item={item} onRetry={props.onRetry} />
            ))}
          </ul>
        )}

        {props.signedIn && workspaces.length > 1 ? (
          <form method="get" action="/share-target" className="flex flex-col gap-2">
            {props.batchId === null ? null : (
              <input type="hidden" name="batch" value={props.batchId} />
            )}
            <label htmlFor="share-workspace" className="text-ink text-sm font-medium">
              {t('workspace.label')}
            </label>
            <p className="text-ink-muted text-xs">{t('workspace.hint')}</p>
            <div className="flex gap-2">
              <select
                id="share-workspace"
                name="ws"
                defaultValue={workspace?.id ?? ''}
                className="border-line-control bg-surface-raised text-ink focus-visible:outline-ring min-h-11 min-w-0 flex-1 rounded-md border px-3 text-sm outline-offset-2 focus-visible:outline-2"
              >
                {workspace === null ? <option value="" disabled /> : null}
                {workspaces.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <Button type="submit" size="lg" variant="secondary">
                {t('workspace.label')}
              </Button>
            </div>
          </form>
        ) : null}

        {channelOff ? (
          <Alert tone="info" data-share-channel-off="">
            <div className="flex flex-col gap-3">
              <AlertTitle>{t('channel.title')}</AlertTitle>
              <AlertDescription>{t('channel.body')}</AlertDescription>
              {workspace.canManage ? (
                <>
                  <Button size="lg" disabled={props.enabling} onClick={props.onEnable}>
                    {props.enabling ? t('channel.enabling') : t('channel.enable')}
                  </Button>
                  {props.enableFailed ? (
                    <p role="alert" className="text-danger text-sm">
                      {t('channel.failed')}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-ink text-sm">{t('channel.ask')}</p>
              )}
            </div>
          </Alert>
        ) : null}

        {props.signedIn &&
        workspace !== null &&
        !channelOff &&
        !empty &&
        props.matters.length > 0 ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="share-matter" className="text-ink text-sm font-medium">
              {t('matter.label')}
            </label>
            <select
              id="share-matter"
              value={props.matterHintId}
              onChange={(event) => {
                props.onMatterHint(event.target.value);
              }}
              className="border-line-control bg-surface-raised text-ink focus-visible:outline-ring min-h-11 rounded-md border px-3 text-sm outline-offset-2 focus-visible:outline-2"
            >
              <option value="">{t('matter.none')}</option>
              {props.matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
            <p className="text-ink-muted text-xs">{t('matter.hint')}</p>
          </div>
        ) : null}

        {props.dataSaver && summary.waiting > 0 ? (
          <p className="text-ink-muted text-xs">{t('dataSaver')}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {workspace === null ? null : (
            <Button asChild size="lg">
              <Link href={`/w/${encodeURIComponent(workspace.slug)}/inbox`}>{t('openInbox')}</Link>
            </Button>
          )}
          {props.dataSaver && summary.waiting > 0 ? (
            <Button size="lg" variant="secondary" onClick={props.onUploadNow}>
              {t('uploadNow')}
            </Button>
          ) : null}
          {props.signedIn && workspace !== null && !channelOff ? (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                accept={SHARE_FILE_ACCEPT}
                onChange={(event) => {
                  props.onFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              <Button
                size="lg"
                variant={empty ? 'primary' : 'outline'}
                onClick={() => {
                  picker.current?.click();
                }}
              >
                {t('empty.upload')}
              </Button>
            </>
          ) : null}
        </div>
      </Card>
    </main>
  );
}

export interface ShareTargetScreenProps {
  signedIn: boolean;
  signInHref: string;
  batchId: string | null;
  error: 'full' | 'failed' | null;
  workspaces: readonly ShareWorkspace[];
  /** The chosen workspace (one membership, or `?ws=`); `null` until the person picks. */
  workspaceId: string | null;
  matters: readonly ShareMatter[];
  /** The version of the "where your data goes" note shown above (`CAPTURE_DISCLOSURE_VERSION`). */
  disclosureVersion: string;
  /** `enableChannelAction` of the inbox (needs `workspace.manage`), passed from the page. */
  enableChannel: (raw: unknown) => Promise<{ ok: boolean }>;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return online;
}

export function ShareTargetScreen(props: ShareTargetScreenProps) {
  const all = useOutbox();
  const online = useOnline();
  const [localBatch, setLocalBatch] = useState<string | null>(null);
  const [matterHintId, setMatterHintId] = useState('');
  const [enabled, setEnabled] = useState<readonly string[]>([]);
  const [enabling, setEnabling] = useState(false);
  const [enableFailed, setEnableFailed] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);

  const batchId = localBatch ?? props.batchId;
  const items = batchId === null ? [] : all.filter((item) => item.batchId === batchId);
  const workspaces = props.workspaces.map((entry) =>
    enabled.includes(entry.id) ? { ...entry, shareEnabled: true } : entry,
  );
  const workspace = workspaces.find((entry) => entry.id === props.workspaceId) ?? null;
  const canUpload = props.signedIn && workspace !== null && workspace.shareEnabled;
  const workspaceId = workspace?.id ?? null;

  // The worker registers for the next share; uploads start only when the files may leave the device.
  useEffect(() => {
    void import('../../lib/pwa/install.ts').then(({ registerServiceWorker }) =>
      registerServiceWorker(() => undefined),
    );
    void import('../../lib/pwa/outbox/sync.ts').then(({ dataSaverOn }) => {
      setDataSaver(dataSaverOn());
    });
  }, []);

  useEffect(() => {
    if (!canUpload || workspaceId === null || batchId === null) return undefined;
    let stop: (() => void) | undefined;
    const life = { alive: true };
    void (async () => {
      const { dexieOutboxStore } = await import('../../lib/pwa/outbox/db.ts');
      const { assignWorkspace, notifyOutboxChanged } =
        await import('../../lib/pwa/outbox/queue.ts');
      await assignWorkspace(
        dexieOutboxStore(),
        batchId,
        workspaceId,
        matterHintId === '' ? undefined : matterHintId,
      );
      notifyOutboxChanged();
      const { startOutboxSync } = await import('../../lib/pwa/outbox/sync.ts');
      if (life.alive) stop = startOutboxSync();
    })();
    return () => {
      life.alive = false;
      stop?.();
    };
  }, [canUpload, workspaceId, batchId, matterHintId]);

  return (
    <ShareTargetView
      signedIn={props.signedIn}
      signInHref={props.signInHref}
      workspace={workspace}
      workspaces={workspaces}
      matters={props.matters}
      items={items}
      error={props.error}
      online={online}
      dataSaver={dataSaver}
      matterHintId={matterHintId}
      enabling={enabling}
      enableFailed={enableFailed}
      batchId={batchId}
      onMatterHint={setMatterHintId}
      onEnable={() => {
        if (workspaceId === null) return;
        setEnabling(true);
        setEnableFailed(false);
        void props
          .enableChannel({
            workspaceId,
            channel: 'share',
            disclosureVersion: props.disclosureVersion,
          })
          .then(({ ok }) => {
            if (ok) setEnabled((ids) => [...ids, workspaceId]);
            else setEnableFailed(true);
          })
          .finally(() => {
            setEnabling(false);
          });
      }}
      onRetry={(id) => {
        void (async () => {
          const { dexieOutboxStore } = await import('../../lib/pwa/outbox/db.ts');
          const { notifyOutboxChanged, retryItem } = await import('../../lib/pwa/outbox/queue.ts');
          await retryItem(dexieOutboxStore(), id);
          notifyOutboxChanged();
          const { syncOutbox } = await import('../../lib/pwa/outbox/sync.ts');
          await syncOutbox({ manual: true });
        })();
      }}
      onUploadNow={() => {
        void import('../../lib/pwa/outbox/sync.ts').then(({ syncOutbox }) =>
          syncOutbox({ manual: true }),
        );
      }}
      onFiles={(files) => {
        if (files.length === 0 || workspaceId === null) return;
        void import('../../lib/pwa/outbox/sync.ts').then(async ({ enqueueAndSync }) => {
          const result = await enqueueAndSync(files, {
            workspaceId,
            channel: 'upload',
            ...(matterHintId === '' ? {} : { matterHintId }),
          });
          setLocalBatch(result.batchId);
        });
      }}
    />
  );
}
