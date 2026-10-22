'use client';
// The private calendar feed card (#53; PRD CA-5; #25 design spec). States:
//   * empty: `No feed yet. Create one to see hearings in your phone calendar.`, the disclosure
//     ("Your calendar app may fetch this feed from servers outside India. We keep the content
//     minimal.") that must be acknowledged, the scope (owners may pick the whole workspace) and the
//     party-names switch (off, with why); `Create feed` stays disabled until it is acknowledged;
//   * a feed exists: status (created or rotated, last fetched, scope), the masked URL, the privacy
//     line, the party-names switch, `Rotate` and `Revoke`, each behind a dialog that names its
//     effect;
//   * just created or rotated: the full URL once with `Copy URL` (announced as `Copied`);
//   * offline: every control is disabled with the reason; a failed action says so in a toast and
//     changes nothing.
// The URL field uses the surface background and tabular mono; the confirmation tick is 150 ms and
// none under reduced motion.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Input } from '@causedeck/ui/input';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { Switch } from '@causedeck/ui/switch';
import { toast } from '@causedeck/ui/sonner';
import { CalendarDays, Check, Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Result } from '../../../lib/safe-action.ts';
import { SettingSection } from '../setting-section.tsx';
import { useOnline } from '../settings-offline-banner.tsx';

export type FeedScopeValue = 'mine' | 'workspace';

export interface CalendarFeedStatus {
  id: string;
  scope: FeedScopeValue;
  includeParties: boolean;
  createdAt: Date;
  rotatedAt: Date | null;
  lastFetchedAt: Date | null;
}

export interface IssuedFeedResult extends CalendarFeedStatus {
  url: string;
}

export interface FeedCardActions {
  create(input: unknown): Promise<Result<IssuedFeedResult>>;
  rotate(input: unknown): Promise<Result<IssuedFeedResult>>;
  revoke(input: unknown): Promise<Result<{ revoked: true }>>;
  setParties(input: unknown): Promise<Result<CalendarFeedStatus>>;
}

export interface FeedCardProps {
  workspaceId: string;
  status: CalendarFeedStatus | null;
  /** Owners may share the whole workspace; everyone else gets `mine`. */
  isOwner: boolean;
  /** The version of the "outside India" note shown here; sent back with `create`. */
  disclosureVersion: string;
  /** The masked URL placeholder (the token is never shown again). */
  masked: string;
  actions: FeedCardActions;
}

type Dialog = 'rotate' | 'revoke' | null;

export function FeedCard({
  workspaceId,
  status: initial,
  isOwner,
  disclosureVersion,
  masked,
  actions,
}: FeedCardProps) {
  const t = useTranslations('calendar.feed');
  const format = useFormatter();
  const online = useOnline();
  const [status, setStatus] = useState(initial);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, setPending] = useState(false);
  const [ack, setAck] = useState(false);
  const [scope, setScope] = useState<FeedScopeValue>('mine');
  const [parties, setParties] = useState(false);

  const reason = online ? null : t('offline');
  const busy = pending || reason !== null;
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'medium' });

  async function run<T>(call: () => Promise<Result<T>>, done: (data: T) => void, ok: string) {
    if (!navigator.onLine) {
      toast(t('offline'));
      return;
    }
    setPending(true);
    let result: Result<T>;
    try {
      result = await call();
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    setDialog(null);
    if (!result.ok) {
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    done(result.data);
    toast(ok);
  }

  function issued(data: IssuedFeedResult) {
    const { url, ...next } = data;
    setStatus(next);
    setRevealed(url);
    setCopied(false);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast(t('toast.copyFailed'));
    }
  }

  const header = {
    title: t('title'),
    description: t('description'),
  };

  if (status === null) {
    return (
      <SettingSection id="calendar-feed" {...header} data-slot="calendar-feed">
        <EmptyState
          icon={<CalendarDays />}
          title={t('empty')}
          description={t('privacy')}
          data-slot="calendar-feed-empty"
        />
        <div className="flex flex-col gap-3 py-3">
          <Alert tone="warning" data-slot="calendar-disclosure">
            {t('disclosure.text')}
          </Alert>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={ack}
              onCheckedChange={(value) => {
                setAck(value === true);
              }}
              data-slot="calendar-disclosure-ack"
            />
            {t('disclosure.ack')}
          </label>
          {isOwner ? (
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="font-medium">{t('scope.label')}</legend>
              {(['mine', 'workspace'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="calendar-scope"
                    value={value}
                    checked={scope === value}
                    onChange={() => {
                      setScope(value);
                    }}
                  />
                  {t(`scope.${value}`)}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-ink-muted text-xs">{t('scope.ownerOnly')}</p>
          )}
          <label className="flex items-start justify-between gap-3 text-sm">
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('parties.label')}</span>
              <span className="text-ink-muted text-xs">{t('parties.why')}</span>
            </span>
            <Switch
              checked={parties}
              onCheckedChange={setParties}
              data-slot="calendar-parties-new"
            />
          </label>
          <Button
            data-slot="calendar-create"
            className="w-full md:w-auto md:self-end"
            disabled={!ack || busy}
            aria-busy={pending || undefined}
            onClick={() => {
              void run(
                () =>
                  actions.create({
                    workspaceId,
                    scope: isOwner ? scope : 'mine',
                    includeParties: parties,
                    disclosureVersion,
                  }),
                issued,
                t('toast.created'),
              );
            }}
          >
            {pending ? t('working') : t('create')}
          </Button>
          {reason === null ? null : <p className="text-ink-muted text-xs">{reason}</p>}
        </div>
      </SettingSection>
    );
  }

  return (
    <SettingSection id="calendar-feed" {...header} data-slot="calendar-feed">
      <div className="flex min-w-0 flex-col gap-2 py-3">
        <label htmlFor="calendar-feed-url" className="text-sm font-medium">
          {t('urlLabel')}
        </label>
        <div className="flex min-w-0 flex-col gap-2 md:flex-row">
          <Input
            id="calendar-feed-url"
            readOnly
            value={revealed ?? masked}
            data-slot="calendar-feed-url"
            data-revealed={revealed === null ? undefined : 'true'}
            className="bg-surface min-w-0 flex-1 font-mono tabular-nums"
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          {revealed === null ? null : (
            <Button
              variant="secondary"
              data-slot="calendar-feed-copy"
              className="w-full md:w-auto"
              onClick={() => {
                void copy(revealed);
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? t('copied') : t('copy')}
            </Button>
          )}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {copied ? t('copied') : ''}
        </p>
        {revealed === null ? null : (
          <p className="text-warning text-sm" data-slot="calendar-feed-shown-once">
            {t('shownOnce')}
          </p>
        )}
        <p className="text-warning text-sm">{t('privacy')}</p>
      </div>
      <div
        className="flex flex-wrap items-center gap-2 py-3 text-sm"
        data-slot="calendar-feed-status"
      >
        <span className="font-medium">{t('statusLabel')}</span>
        <Badge tone="neutral">{t(`scope.${status.scope}`)}</Badge>
        <span className="text-ink-muted">
          {status.rotatedAt === null
            ? t('status.created', { date: date(status.createdAt) })
            : t('status.rotated', { date: date(status.rotatedAt) })}
        </span>
        <span className="text-ink-muted">
          {status.lastFetchedAt === null
            ? t('status.neverFetched')
            : t('status.lastFetched', { date: date(status.lastFetchedAt) })}
        </span>
      </div>
      <label className="flex items-start justify-between gap-3 py-3 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t('parties.label')}</span>
          <span className="text-ink-muted text-xs">{t('parties.why')}</span>
        </span>
        <Switch
          checked={status.includeParties}
          disabled={busy}
          data-slot="calendar-parties"
          onCheckedChange={(value) => {
            void run(
              () => actions.setParties({ workspaceId, includeParties: value }),
              (next) => {
                setStatus(next);
              },
              t('toast.saved'),
            );
          }}
        />
      </label>
      <div className="flex flex-col gap-2 py-3 md:flex-row md:justify-end">
        <Button
          variant="secondary"
          disabled={busy}
          data-slot="calendar-rotate"
          onClick={() => {
            setDialog('rotate');
          }}
        >
          {t('rotate')}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          data-slot="calendar-revoke"
          onClick={() => {
            setDialog('revoke');
          }}
        >
          {t('revoke')}
        </Button>
      </div>
      {reason === null ? null : <p className="text-ink-muted py-1 text-xs">{reason}</p>}
      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!pending && !open) setDialog(null);
        }}
      >
        <AlertDialogContent data-dialog={dialog === 'revoke' ? 'revoke-feed' : 'rotate-feed'}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === 'revoke' ? t('revokeTitle') : t('rotateTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === 'revoke' ? t('revokeBody') : t('rotateBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              aria-busy={pending || undefined}
              onClick={(event) => {
                // Keep the dialog open until the call resolves.
                event.preventDefault();
                if (dialog === 'revoke') {
                  void run(
                    () => actions.revoke({ workspaceId }),
                    () => {
                      setStatus(null);
                      setRevealed(null);
                      setAck(false);
                    },
                    t('toast.revoked'),
                  );
                } else {
                  void run(() => actions.rotate({ workspaceId }), issued, t('toast.rotated'));
                }
              }}
            >
              {pending
                ? t('working')
                : dialog === 'revoke'
                  ? t('revokeConfirm')
                  : t('rotateConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingSection>
  );
}

export function CalendarSkeleton() {
  const t = useTranslations('calendar');
  return (
    <SkeletonGroup labels={{ loading: t('loading') }} data-pattern-state="loading">
      {[1, 2].map((card) => (
        <div key={card} className="border-line flex flex-col gap-4 rounded-xl border p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-56" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
