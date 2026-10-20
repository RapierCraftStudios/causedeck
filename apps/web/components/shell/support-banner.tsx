'use client';
// The product shell's support-session banner (#313, spike §6): while a granted support session is
// active, the workspace owner sees `Support is viewing this workspace until 14:30` above the page,
// with a one-click `End session`. Ending revokes the session at once: the banner goes, and staff
// lose access on their next read because the support context re-checks the session each time.
// The banner also removes itself when the grant runs out (the expiry job flips the row later). No
// Radix: it ships in the shell bundle, which has a 40 KB budget.
import { Button } from '@causedeck/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { revokeSupportSessionAction } from '../../app/(app)/w/[slug]/settings/support/actions.ts';

export interface ShellSupportSession {
  id: string;
  /** ISO timestamp the grant ends at. */
  expiresAt: string;
}

export interface SupportBannerProps {
  workspaceId: string;
  session: ShellSupportSession;
}

/** `setTimeout` takes at most a signed 32-bit delay; a grant is at most 4 h anyway. */
const MAX_DELAY = 2_147_483_647;

export function SupportBanner({ workspaceId, session }: SupportBannerProps) {
  const t = useTranslations('shell.supportBanner');
  const format = useFormatter();
  const router = useRouter();
  const [ended, setEnded] = useState(false);
  // The grant end this banner saw run out; a new grant (different `expiresAt`) is live again.
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const expired = expiredAt === session.expiresAt;
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Always from the timer callback (0 ms when already past), never synchronously in the effect.
    const delay = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(
      () => {
        setExpiredAt(session.expiresAt);
      },
      Math.min(delay, MAX_DELAY),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [session.expiresAt]);

  if (ended || expired) return null;

  // 24-hour, as the product spec reads (`until 14:30`), in the app time zone.
  const until = format.dateTime(new Date(session.expiresAt), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  async function end() {
    setPending(true);
    setFailed(false);
    try {
      const result = await revokeSupportSessionAction({ workspaceId, sessionId: session.id });
      // Already ended (or expired) elsewhere: the session is over either way.
      if (result.ok || result.error.code === 'CONFLICT') {
        setEnded(true);
        router.refresh();
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="support-banner"
      data-session-id={session.id}
      className="border-danger bg-danger-soft text-ink flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm md:px-6"
    >
      <ShieldAlert aria-hidden className="text-danger size-4 shrink-0" />
      <span className="min-w-0 flex-1 font-medium">{t('message', { time: until })}</span>
      {failed ? (
        <span role="alert" className="text-danger">
          {t('error')}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="destructive"
        data-slot="support-banner-end"
        loading={pending}
        onClick={() => void end()}
      >
        {t('end')}
      </Button>
    </div>
  );
}
