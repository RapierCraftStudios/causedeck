'use client';
// What is kept on this device (#65 part 5): the offline cache's size, the privacy promise, and
// `Clear saved data`. States: loading, ready (with an empty variant), storage full, offline saving
// denied by the browser, turned off, and IndexedDB unavailable. `OfflineCardView` is the
// presentational half (stories, tests); `OfflineCard` reads the browser and clears the databases.
import { Button } from '@causedeck/ui/button';
import { Database } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { StorageMeter } from '../../_offline/storage-meter.tsx';

export type OfflineCardStatus = 'loading' | 'ready' | 'unsupported' | 'denied' | 'optedOut';

export interface OfflineCardViewProps {
  status: OfflineCardStatus;
  used: number | null;
  quota: number | null;
  /** Something is saved on this device (enables `Clear saved data`). */
  hasData: boolean;
  /** The last clear failed. */
  error?: boolean;
  /** A clear just finished. */
  cleared?: boolean;
  onClear: () => void;
}

export function OfflineCardView({
  status,
  used,
  quota,
  hasData,
  error = false,
  cleared = false,
  onClear,
}: OfflineCardViewProps) {
  const t = useTranslations('offline');
  const [confirming, setConfirming] = useState(false);
  const notice =
    status === 'unsupported'
      ? t('storage.unsupported')
      : status === 'denied'
        ? t('storage.denied')
        : status === 'optedOut'
          ? t('storage.optedOut')
          : null;
  return (
    <section
      data-slot="offline-card"
      data-state={status}
      aria-labelledby="offline-card-title"
      className="border-line bg-surface flex flex-col gap-3 rounded-xl border p-4"
    >
      <header className="flex items-center gap-2">
        <Database aria-hidden="true" className="text-ink-muted size-5 shrink-0" />
        <h2 id="offline-card-title" className="font-serif text-lg font-medium">
          {t('privacy.title')}
        </h2>
      </header>
      <p className="text-sm">{t('privacy.body')}</p>
      <p className="text-ink-muted text-sm">{t('privacy.lostPhone')}</p>
      {notice === null ? (
        <>
          <StorageMeter used={status === 'loading' ? null : used} quota={quota} />
          {status === 'ready' && !hasData ? (
            <p className="text-ink-muted text-sm">{t('storage.empty')}</p>
          ) : null}
        </>
      ) : (
        <p role="status" data-slot="offline-card-notice" className="text-warning text-sm">
          {notice}
        </p>
      )}
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {t('storage.clearFailed')}
        </p>
      ) : null}
      {cleared ? (
        <p role="status" className="text-sm">
          {t('storage.cleared')}
        </p>
      ) : null}
      {status === 'ready' && hasData ? (
        confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t('privacy.clearConfirm')}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  onClear();
                }}
              >
                {t('storage.clear')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t('storage.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t('storage.clear')}
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}

interface Snapshot {
  status: OfflineCardStatus;
  used: number | null;
  quota: number | null;
  hasData: boolean;
}

/** IndexedDB names this app owns (`causedeck-offline:<user>:<workspace>`). */
async function ownDatabases(): Promise<string[]> {
  const factory: Partial<Pick<IDBFactory, 'databases'>> = indexedDB;
  const list = (await factory.databases?.()) ?? [];
  return list.flatMap((db) => (db.name?.startsWith('causedeck-offline') ? [db.name] : []));
}

async function readBrowser(optedOut: boolean): Promise<Snapshot> {
  if (typeof indexedDB === 'undefined') {
    return { status: 'unsupported', used: null, quota: null, hasData: false };
  }
  if (optedOut) return { status: 'optedOut', used: null, quota: null, hasData: false };
  try {
    const names = await ownDatabases();
    const storage = navigator.storage as Partial<StorageManager> | undefined;
    const estimate = (await storage?.estimate?.()) ?? {};
    return {
      status: 'ready',
      used: estimate.usage ?? 0,
      quota: estimate.quota ?? null,
      hasData: names.length > 0,
    };
  } catch {
    // A browser that blocks site data throws SecurityError from `indexedDB.databases()`.
    return { status: 'denied', used: null, quota: null, hasData: false };
  }
}

export function OfflineCard({ optedOut = false }: { optedOut?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    status: 'loading',
    used: null,
    quota: null,
    hasData: false,
  });
  const [error, setError] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let live = true;
    void readBrowser(optedOut).then((next) => {
      if (live) setSnapshot(next);
    });
    return () => {
      live = false;
    };
  }, [optedOut]);

  const clear = useCallback(() => {
    setError(false);
    setCleared(false);
    void (async () => {
      try {
        const { deleteAllOfflineDbs } = await import('../../../../../../lib/offline/db.ts');
        await deleteAllOfflineDbs();
        setCleared(true);
        setSnapshot(await readBrowser(optedOut));
      } catch {
        setError(true);
      }
    })();
  }, [optedOut]);

  return <OfflineCardView {...snapshot} error={error} cleared={cleared} onClear={clear} />;
}
