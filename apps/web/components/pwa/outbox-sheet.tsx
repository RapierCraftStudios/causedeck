'use client';

// The outbox sheet (#50): every file waiting on this device with its size, age and actions (retry,
// remove). Removing deletes the encrypted blob. Shown to people as "Waiting to upload".
import { Alert, AlertDescription } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { FileText } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import type { OutboxItem } from '../../lib/pwa/outbox/db.ts';
import { capStatus, usedBytes } from '../../lib/pwa/outbox/queue.ts';

export interface OutboxSheetHandlers {
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onUploadNow: () => void;
}

export interface OutboxSheetViewProps extends OutboxSheetHandlers {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly OutboxItem[];
  /** Cap on waiting bytes; the 200 MB default when omitted. */
  capBytes?: number | undefined;
  /** Render time, so stories and tests are stable. */
  now?: number | undefined;
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

function OutboxRow({
  item,
  now,
  onRetry,
  onRemove,
}: { item: OutboxItem; now: number } & Pick<OutboxSheetHandlers, 'onRetry' | 'onRemove'>) {
  const t = useTranslations('pwa');
  const format = useFormatter();
  const megabytes = item.size / (1024 * 1024);
  const size =
    megabytes >= 1
      ? `${format.number(megabytes, { maximumFractionDigits: 1 })} MB`
      : `${format.number(Math.max(1, Math.round(item.size / 1024)))} KB`;
  return (
    <li
      data-outbox-item=""
      data-state={item.state}
      className="border-line flex items-start gap-3 border-b py-3 last:border-b-0"
    >
      <FileText aria-hidden="true" className="text-ink-muted mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-ink truncate text-sm font-medium">{item.name}</p>
        <p className="text-ink-muted text-xs">
          {size} ·{' '}
          {t('outbox.sheet.age', { when: format.relativeTime(new Date(item.createdAt), now) })}
        </p>
        <p className="text-ink-muted text-xs">
          {t(`share.status.${item.state}`)}
          {item.state === 'failed' ? ` · ${t(`share.reason.${reasonKey(item.lastError)}`)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {item.state === 'failed' ? (
          <Button
            variant="outline"
            size="lg"
            aria-label={t('outbox.sheet.retryLabel', { name: item.name })}
            onClick={() => {
              onRetry(item.id);
            }}
          >
            {t('outbox.sheet.retry')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="lg"
          aria-label={t('outbox.sheet.removeLabel', { name: item.name })}
          onClick={() => {
            onRemove(item.id);
          }}
        >
          {t('outbox.sheet.remove')}
        </Button>
      </div>
    </li>
  );
}

export function OutboxSheetView({
  open,
  onOpenChange,
  items,
  capBytes,
  now = Date.now(),
  onRetry,
  onRemove,
  onUploadNow,
}: OutboxSheetViewProps) {
  const t = useTranslations('pwa.outbox.sheet');
  const live = items.filter((item) => item.state !== 'sent');
  const used = usedBytes(items);
  const cap = capStatus(used, 0, capBytes);
  const full = cap.usedBytes >= cap.capBytes;
  const percent = Math.min(100, Math.round((used / cap.capBytes) * 100));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-outbox-sheet="">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {full ? (
            <Alert tone="danger">
              <AlertDescription>{t('capFull')}</AlertDescription>
            </Alert>
          ) : cap.level === 'warn' ? (
            <Alert tone="warning">
              <AlertDescription>{t('capWarn', { percent })}</AlertDescription>
            </Alert>
          ) : null}
          {live.length === 0 ? (
            <p className="text-ink-muted text-sm">{t('empty')}</p>
          ) : (
            <>
              <ul aria-label={t('title')}>
                {live.map((item) => (
                  <OutboxRow
                    key={item.id}
                    item={item}
                    now={now}
                    onRetry={onRetry}
                    onRemove={onRemove}
                  />
                ))}
              </ul>
              <Button variant="secondary" size="lg" onClick={onUploadNow}>
                {t('uploadNow')}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

async function withStore(act: (store: Awaited<ReturnType<typeof openStore>>) => Promise<unknown>) {
  const store = await openStore();
  await act(store);
  const { notifyOutboxChanged } = await import('../../lib/pwa/outbox/queue.ts');
  notifyOutboxChanged();
}

async function openStore() {
  const { dexieOutboxStore } = await import('../../lib/pwa/outbox/db.ts');
  return dexieOutboxStore();
}

/** Upload now: ignore data saver and any backoff wait. */
async function uploadNow() {
  const { syncOutbox } = await import('../../lib/pwa/outbox/sync.ts');
  await syncOutbox({ manual: true });
}

export interface OutboxSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly OutboxItem[];
}

/** The sheet wired to the device's outbox. */
export function OutboxSheet({ open, onOpenChange, items }: OutboxSheetProps) {
  return (
    <OutboxSheetView
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      onRetry={(id) => {
        void withStore(async (store) => {
          const { retryItem } = await import('../../lib/pwa/outbox/queue.ts');
          await retryItem(store, id);
        }).then(uploadNow);
      }}
      onRemove={(id) => {
        void withStore(async (store) => {
          const { removeItem } = await import('../../lib/pwa/outbox/queue.ts');
          await removeItem(store, id);
        });
      }}
      onUploadNow={() => {
        void uploadNow();
      }}
    />
  );
}
