'use client';
// Audit event detail (#232), loaded on demand by the feed. A side sheet (bottom on phones): the
// sentence, who, when, target, outcome, the IP for owners, the request and event ids, the metadata
// as read-only JSON and the chain status. The status starts as `Chain not yet verified` and turns
// `Verified` once the server re-checks the event's hash. The sheet slides in (250 ms, instant with
// reduced motion), traps focus and returns it to the row that opened it.
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { toast } from '@causedeck/ui/sonner';
import { Copy, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Result } from '../../../../../lib/safe-action.ts';

import type { ChainStatus } from './actions.ts';

/** The event as the feed resolved it (`AuditRow` in `audit-feed.tsx`). */
export interface EventDrawerRow {
  event: {
    id: string;
    createdAt: string;
    requestId: string | null;
    metadata: Record<string, unknown>;
    ip?: string | null | undefined;
  };
  sentence: string;
  actorName: string;
  targetName: string | null;
  when: string;
}

export interface EventDrawerProps {
  row: EventDrawerRow;
  /** The outcome badge, rendered by the feed. */
  outcome: ReactNode;
  isOwner: boolean;
  side: 'end' | 'bottom';
  onClose: () => void;
  verify: () => Promise<Result<ChainStatus>>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-ink-muted text-xs">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

export function EventDrawer({ row, outcome, isOwner, side, onClose, verify }: EventDrawerProps) {
  const t = useTranslations('audit.drawer');
  // The check's result is tagged with the event it belongs to, so a different event reads as
  // `checking` without resetting state in an effect.
  const [checked, setChecked] = useState<{ id: string; status: ChainStatus } | null>(null);
  // The row that opened the sheet, captured once when it mounts, to return focus to on close.
  const [opener] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  });
  const { event } = row;
  const chain: ChainStatus | 'checking' = checked?.id === event.id ? checked.status : 'checking';

  // `verify` is a new closure every render; the event id is what the check depends on.
  const verifyRef = useRef(verify);
  useEffect(() => {
    verifyRef.current = verify;
  });
  useEffect(() => {
    let live = true;
    verifyRef.current().then(
      (result) => {
        if (live) setChecked({ id: event.id, status: result.ok ? result.data : 'unverified' });
      },
      () => {
        if (live) setChecked({ id: event.id, status: 'unverified' });
      },
    );
    return () => {
      live = false;
    };
  }, [event.id]);

  const metadata = Object.keys(event.metadata).length
    ? JSON.stringify(event.metadata, null, 2)
    : null;
  const ChainIcon = chain === 'verified' ? ShieldCheck : ShieldQuestion;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side={side}
        data-slot="audit-event-drawer"
        className="overflow-y-auto motion-reduce:animate-none md:max-w-md"
        labels={{ close: t('close') }}
        onCloseAutoFocus={(e) => {
          if (opener?.isConnected) {
            e.preventDefault();
            opener.focus();
          }
        }}
      >
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{row.sentence}</SheetDescription>
        </SheetHeader>
        <dl className="grid gap-3">
          <Field label={t('who')}>{row.actorName}</Field>
          <Field label={t('when')}>
            <time dateTime={event.createdAt} className="tabular-nums">
              {row.when}
            </time>
          </Field>
          {row.targetName ? <Field label={t('target')}>{row.targetName}</Field> : null}
          <Field label={t('outcome')}>{outcome}</Field>
          {isOwner && event.ip ? (
            <Field label={t('ip')}>
              <span className="font-mono">{event.ip}</span>
            </Field>
          ) : null}
          {event.requestId ? (
            <Field label={t('requestId')}>
              <span className="font-mono text-xs">{event.requestId}</span>
            </Field>
          ) : null}
          <Field label={t('eventId')}>
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs">{event.id}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(event.id).then(() => {
                    toast(t('copied'));
                  });
                }}
              >
                <Copy aria-hidden="true" />
                {t('copyId')}
              </Button>
            </span>
          </Field>
          <Field label={t('chain')}>
            <span data-chain={chain} className="flex items-center gap-1.5" aria-live="polite">
              <ChainIcon aria-hidden="true" className="size-4" />
              {chain === 'verified'
                ? t('chainVerified')
                : chain === 'checking'
                  ? t('chainChecking')
                  : t('chainUnverified')}
            </span>
          </Field>
        </dl>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-ink-muted text-xs">{t('metadata')}</h3>
          {metadata ? (
            <pre
              tabIndex={0}
              aria-label={t('metadata')}
              className="bg-surface-sunken border-line max-h-64 overflow-auto rounded-md border p-3 font-mono text-xs"
            >
              <code>{metadata}</code>
            </pre>
          ) : (
            <p className="text-ink-muted text-sm">{t('noMetadata')}</p>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
