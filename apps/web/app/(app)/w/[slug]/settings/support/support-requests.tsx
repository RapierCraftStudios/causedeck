'use client';
// The owner's support requests and sessions (#313). Pending requests show the reason, scope and
// when they arrived, with `Grant for 1 hour` (or the 2 h / 4 h length the owner picks) and `Deny`;
// active sessions show the scope and when they end, with `Revoke now`. There is no extend control:
// the domain grants only a pending request, so more time takes a new request. Offline the buttons
// are disabled; every outcome is a toast and the page refreshes from the server.
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import type { ActionErrorCode, Result } from '../../../../../../lib/safe-action.ts';

import type { SupportSessionOutcome } from './actions.ts';

export interface SupportSessionRow {
  id: string;
  scope: 'view' | 'metadata';
  reason: string;
  status: 'requested' | 'granted';
  /** ISO timestamps (the row crosses the server/client boundary). */
  requestedAt: string;
  expiresAt: string | null;
}

type Action = (raw: unknown) => Promise<Result<SupportSessionOutcome>>;

export interface SupportRequestsActions {
  grant: Action;
  deny: Action;
  revoke: Action;
}

/** Grant lengths offered, in minutes, with their `settings.support.duration` key. */
export const GRANT_OPTIONS = [
  { minutes: 60, key: 'h1' },
  { minutes: 120, key: 'h2' },
  { minutes: 240, key: 'h4' },
] as const;

type ErrorKey = 'conflict' | 'forbidden' | 'notFound' | 'offline' | 'generic';

function errorKey(code: ActionErrorCode): ErrorKey {
  switch (code) {
    case 'CONFLICT':
      return 'conflict';
    case 'FORBIDDEN':
      return 'forbidden';
    case 'NOT_FOUND':
      return 'notFound';
    default:
      return 'generic';
  }
}

/** 24-hour times, like the shell banner (`until 14:30`). */
const TIME = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function SupportRequestsSkeleton() {
  const t = useTranslations('settings.support');
  return (
    <SkeletonGroup
      data-slot="support-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="flex flex-col gap-3"
    >
      {[0, 1].map((i) => (
        <div key={i} className="border-line flex flex-col gap-2 rounded-xl border p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-8 w-40" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function SupportRequestsError() {
  const t = useTranslations('settings.support.error');
  const router = useRouter();
  return (
    <Alert
      tone="danger"
      data-pattern-state="error"
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            router.refresh();
          }}
        >
          {t('retry')}
        </Button>
      }
    >
      {t('title')}
    </Alert>
  );
}

export interface SupportRequestsProps {
  workspaceId: string;
  sessions: readonly SupportSessionRow[];
  actions: SupportRequestsActions;
}

export function SupportRequests({ workspaceId, sessions, actions }: SupportRequestsProps) {
  const t = useTranslations('settings.support');
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const [busy, setBusy] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<Readonly<Record<string, number>>>({});

  const pending = sessions.filter((s) => s.status === 'requested');
  const active = sessions.filter((s) => s.status === 'granted');
  const time = (iso: string) => format.dateTime(new Date(iso), TIME);

  async function run(sessionId: string, call: () => Promise<Result<SupportSessionOutcome>>) {
    if (!navigator.onLine) {
      toast(t('errors.offline'));
      return;
    }
    setBusy(sessionId);
    try {
      const result = await call();
      if (!result.ok) {
        toast(t(`errors.${errorKey(result.error.code)}`));
        return;
      }
      const { status, expiresAt } = result.data;
      if (status === 'granted' && expiresAt) toast(t('toast.granted', { time: time(expiresAt) }));
      else if (status === 'denied') toast(t('toast.denied'));
      else toast(t('toast.revoked'));
      router.refresh();
    } catch {
      toast(t('errors.generic'));
    } finally {
      setBusy(null);
    }
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        data-slot="support-empty"
        data-pattern-state="empty"
        icon={<ShieldCheck />}
        title={t('empty.title')}
        description={t('empty.hint')}
      />
    );
  }

  const disabled = () => !online || busy !== null;

  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 ? (
        <SettingSection id="support-pending" title={t('pending.title')}>
          {pending.map((s) => {
            const length = minutes[s.id] ?? 60;
            const option = GRANT_OPTIONS.find((o) => o.minutes === length) ?? GRANT_OPTIONS[0];
            const selectId = `support-length-${s.id}`;
            return (
              <div
                key={s.id}
                data-slot="support-request"
                data-session-id={s.id}
                className="flex flex-col gap-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.scope === 'view' ? 'warning' : 'neutral'}>
                    {t(`scopeLabel.${s.scope}`)}
                  </Badge>
                  <span className="text-ink-muted text-sm">
                    {t('pending.requestedAt', {
                      time: format.dateTime(new Date(s.requestedAt), {
                        day: 'numeric',
                        month: 'short',
                        ...TIME,
                      }),
                    })}
                  </span>
                </div>
                <p className="text-sm">{t('pending.reason', { reason: s.reason })}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={selectId} className="text-ink-muted text-sm">
                    {t('duration.label')}
                  </label>
                  <select
                    id={selectId}
                    data-slot="support-length"
                    className="border-line-control bg-surface h-9 rounded-md border px-2 text-sm"
                    value={length}
                    disabled={disabled()}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setMinutes((current) => ({ ...current, [s.id]: value }));
                    }}
                  >
                    {GRANT_OPTIONS.map((o) => (
                      <option key={o.minutes} value={o.minutes}>
                        {t(`duration.${o.key}`)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    data-slot="support-grant"
                    disabled={disabled()}
                    loading={busy === s.id}
                    onClick={() =>
                      void run(s.id, () =>
                        actions.grant({ workspaceId, sessionId: s.id, minutes: length }),
                      )
                    }
                  >
                    {t('grant', { duration: t(`duration.${option.key}`) })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-slot="support-deny"
                    disabled={disabled()}
                    onClick={() =>
                      void run(s.id, () => actions.deny({ workspaceId, sessionId: s.id }))
                    }
                  >
                    {t('deny')}
                  </Button>
                </div>
              </div>
            );
          })}
        </SettingSection>
      ) : null}
      {active.length > 0 ? (
        <SettingSection id="support-active" title={t('active.title')}>
          {active.map((s) => (
            <div
              key={s.id}
              data-slot="support-active-session"
              data-session-id={s.id}
              className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.scope === 'view' ? 'warning' : 'neutral'}>
                    {t(`scopeLabel.${s.scope}`)}
                  </Badge>
                  {s.expiresAt ? (
                    <span className="text-sm font-medium">
                      {t('active.until', { time: time(s.expiresAt) })}
                    </span>
                  ) : null}
                </div>
                <p className="text-ink-muted text-sm">
                  {t('pending.reason', { reason: s.reason })}
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                data-slot="support-revoke"
                disabled={disabled()}
                loading={busy === s.id}
                onClick={() =>
                  void run(s.id, () => actions.revoke({ workspaceId, sessionId: s.id }))
                }
              >
                {t('revoke')}
              </Button>
            </div>
          ))}
        </SettingSection>
      ) : null}
    </div>
  );
}
