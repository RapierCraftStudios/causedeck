'use client';

// The outbox indicator in the app header (#50): "3 waiting to upload", "Uploading 1 of 3",
// "1 failed, tap to retry". It opens the outbox sheet. The outbox itself (Dexie, WebCrypto) loads
// in its own chunk a moment after first paint, so the shell's initial JS does not grow; nothing
// renders until something is waiting. The items also reach the Inbox "Processing" list through the
// registry from #48 (`registerOutboxSource`).
import { CloudUpload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useState } from 'react';

import { registerOutboxSource, type LocalCapture } from '../../lib/inbox/ready-providers.ts';
import type { OutboxItem } from '../../lib/pwa/outbox/db.ts';
import {
  listItems,
  onOutboxChanged,
  summarize,
  type OutboxSummary,
} from '../../lib/pwa/outbox/queue.ts';

const OutboxSheet = lazy(() =>
  import('./outbox-sheet.tsx').then((m) => ({ default: m.OutboxSheet })),
);

const FIRST_LOAD_DELAY_MS = 1500;

let localCache: LocalCapture[] = [];
registerOutboxSource('pwa-outbox', () => localCache);

function toLocalCaptures(items: readonly OutboxItem[]): LocalCapture[] {
  return items
    .filter((item) => item.state !== 'sent')
    .map((item) => ({
      id: item.id,
      channel: item.channel,
      createdAt: new Date(item.createdAt).toISOString(),
    }));
}

/** The outbox rows, kept current across tabs and the service worker. Empty without IndexedDB. */
export function useOutbox(): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return undefined;
    let alive = true;
    const load = async () => {
      try {
        const { dexieOutboxStore } = await import('../../lib/pwa/outbox/db.ts');
        const rows = await listItems(dexieOutboxStore());
        localCache = toLocalCaptures(rows);
        if (alive) setItems(rows);
      } catch {
        // IndexedDB blocked (private mode): the outbox is simply empty.
      }
    };
    const timer = setTimeout(() => void load(), FIRST_LOAD_DELAY_MS);
    const stop = onOutboxChanged(() => void load());
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, []);
  return items;
}

export interface OutboxIndicatorViewProps {
  summary: OutboxSummary;
  onOpen: () => void;
}

/** The header button. 44 px tall; text, not colour alone, carries the state. */
export function OutboxIndicatorView({ summary, onOpen }: OutboxIndicatorViewProps) {
  const t = useTranslations('pwa.outbox.indicator');
  if (summary.total === 0) return null;
  let text: string;
  if (summary.failed > 0) text = t('failed', { count: summary.failed });
  else if (summary.uploading > 0) {
    text = t('uploading', { current: summary.position, total: summary.total });
  } else text = t('waiting', { count: summary.waiting });
  return (
    <button
      type="button"
      data-outbox-indicator=""
      aria-haspopup="dialog"
      onClick={onOpen}
      className="text-ink-muted hover:text-ink border-line-control bg-surface-raised focus-visible:outline-ring flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-2.5 text-xs outline-none focus-visible:outline-2 md:text-sm"
    >
      <CloudUpload aria-hidden="true" className="size-4 shrink-0" />
      <span aria-live="polite" className="max-w-40 truncate md:max-w-none">
        {text}
      </span>
    </button>
  );
}

export function OutboxIndicator() {
  const items = useOutbox();
  const [open, setOpen] = useState(false);
  const summary = summarize(items);
  return (
    <>
      <OutboxIndicatorView
        summary={summary}
        onOpen={() => {
          setOpen(true);
        }}
      />
      {open ? (
        <Suspense fallback={null}>
          <OutboxSheet open={open} onOpenChange={setOpen} items={items} />
        </Suspense>
      ) : null}
    </>
  );
}
