'use client';
// The account session list (#289, #25 design spec): a labelled table of the caller's active
// sessions, the current one marked `This device`, every other one with `Revoke` (confirmed, then
// `revokeSessionAction`). Sessions are identified by id only; their tokens never reach the
// browser. With no other session the table keeps the current row and says `No other active
// sessions.` Under 768 px the IP and sign-in columns fold into the device cell, so the page never
// scrolls sideways. Offline, `Revoke` is disabled.
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
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { toast } from '@causedeck/ui/sonner';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useOnline } from './settings-offline-banner.tsx';

export interface SessionView {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  /** ISO timestamp. */
  createdAt: string;
  current: boolean;
}

export interface SessionListProps {
  sessions: readonly SessionView[];
  revokeSession: (input: { sessionId: string }) => Promise<Result<{ sessionId: string }>>;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** Browser and operating system names from a user agent, or `null` when neither is known. */
export function describeUserAgent(
  userAgent: string | null,
): { browser: string; os: string } | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const os = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!browser || !os) return null;
  return { browser, os };
}

export function SessionList({ sessions, revokeSession }: SessionListProps) {
  const t = useTranslations('settings.account');
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const [revoking, setRevoking] = useState<SessionView | null>(null);
  const [pending, setPending] = useState(false);
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());

  const rows = [...sessions]
    .filter((session) => !revoked.has(session.id))
    .sort((a, b) => Number(b.current) - Number(a.current));
  const others = rows.filter((session) => !session.current);

  const device = (session: SessionView) => {
    const described = describeUserAgent(session.userAgent);
    return described ? t('sessions.device', described) : t('sessions.unknownDevice');
  };
  const signedIn = (session: SessionView) =>
    format.dateTime(new Date(session.createdAt), { dateStyle: 'medium', timeStyle: 'short' });

  async function onRevoke(session: SessionView) {
    setPending(true);
    let result: Result<{ sessionId: string }>;
    try {
      result = await revokeSession({ sessionId: session.id });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    setRevoking(null);
    if (result.ok) {
      setRevoked((current) => new Set(current).add(session.id));
      toast(t('sessions.toast.revoked'));
      router.refresh();
    } else {
      toast(result.error.code === 'FORBIDDEN' ? t('forbidden') : t('sessions.toast.failed'));
    }
  }

  return (
    <div data-slot="session-list" className="flex min-w-0 flex-col gap-3 py-3">
      <Table data-slot="session-table">
        <TableCaption className="sr-only">{t('sessions.tableCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('sessions.columns.device')}</TableHead>
            <TableHead scope="col" className="hidden md:table-cell">
              {t('sessions.columns.ip')}
            </TableHead>
            <TableHead scope="col" className="hidden md:table-cell">
              {t('sessions.columns.signedIn')}
            </TableHead>
            <TableHead scope="col" className="w-12">
              <span className="sr-only">{t('sessions.columns.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((session) => (
            <TableRow
              key={session.id}
              data-session={session.id}
              data-current={session.current ? '' : undefined}
            >
              <TableCell className="max-w-0 min-w-40 whitespace-normal">
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium break-words">{device(session)}</span>
                    {session.current ? <Badge tone="success">{t('sessions.current')}</Badge> : null}
                  </span>
                  <span className="text-ink-muted text-xs md:hidden">
                    {session.ipAddress ?? t('sessions.unknownIp')} · {signedIn(session)}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-ink-muted hidden md:table-cell">
                {session.ipAddress ?? t('sessions.unknownIp')}
              </TableCell>
              <TableCell className="text-ink-muted hidden md:table-cell">
                {signedIn(session)}
              </TableCell>
              <TableCell className="text-end">
                {session.current ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!online || pending}
                    aria-label={t('sessions.revokeLabel', { device: device(session) })}
                    onClick={() => {
                      setRevoking(session);
                    }}
                  >
                    {t('sessions.revoke')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {others.length === 0 ? (
        <p data-pattern-state="empty" className="text-ink-muted text-sm">
          {t('sessions.empty')}
        </p>
      ) : null}

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <AlertDialogContent data-slot="revoke-session-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sessions.revokeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sessions.revokeBody', { device: revoking ? device(revoking) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || !online}
              onClick={(event) => {
                event.preventDefault();
                if (revoking) void onRevoke(revoking);
              }}
            >
              {t('sessions.revokeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
