'use client';

import { Button } from '@causedeck/ui/button';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export const RESEND_AFTER_SECONDS = 30;

export interface CheckEmailProps {
  email: string;
  expiresInMinutes: number;
  onUseDifferentEmail: () => void;
  /** Sends the link again; rejects when the request fails. */
  onResend: () => Promise<void>;
}

/** After a link is sent: the address, the expiry, and a resend that unlocks after 30 s. */
export function CheckEmail({
  email,
  expiresInMinutes,
  onUseDifferentEmail,
  onResend,
}: CheckEmailProps) {
  const t = useTranslations('auth.checkEmail');
  const [seconds, setSeconds] = useState(RESEND_AFTER_SECONDS);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => {
      setSeconds((s) => s - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [seconds]);

  async function resend() {
    setPending(true);
    try {
      await onResend();
      setSeconds(RESEND_AFTER_SECONDS);
    } catch {
      // The form shows the send error; keep the resend available.
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="check-email-title"
      className="motion-safe:animate-fade-in flex flex-col items-start gap-4"
    >
      <Mail aria-hidden="true" className="text-ink-muted size-8" />
      <h2 id="check-email-title" className="font-serif text-2xl font-medium">
        {t('title')}
      </h2>
      <p role="status" className="text-ink-muted text-base">
        {t('body', { email, minutes: expiresInMinutes })}
      </p>
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Button variant="outline" size="lg" onClick={onUseDifferentEmail}>
          {t('differentEmail')}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          disabled={seconds > 0}
          loading={pending}
          onClick={() => void resend()}
        >
          {seconds > 0 ? t('resendIn', { seconds }) : t('resend')}
        </Button>
      </div>
    </section>
  );
}
