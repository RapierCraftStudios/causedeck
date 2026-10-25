'use client';

// The Contact tab (#94): the support WhatsApp number from `NEXT_PUBLIC_SUPPORT_WHATSAPP` with the
// court-day hours, an email fallback when it is unset, and the owner's `Request support session`
// (a time-boxed, metadata-only request; staff see no content by default).
import { clientEnv } from '@causedeck/config/env/client';
import { Button } from '@causedeck/ui/button';
import { Textarea } from '@causedeck/ui/textarea';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { requestSupportSessionAction } from '../../app/(app)/w/[slug]/help/actions.ts';

/** Where support mail goes when no WhatsApp number is configured. */
export const SUPPORT_EMAIL = 'support@causedeck.in';

export type SupportChannel =
  | { kind: 'whatsapp'; number: string; href: string }
  | { kind: 'email'; email: string; href: string };

/** The channel to show: a valid WhatsApp number wins, anything else falls back to email. */
export function supportChannel(whatsapp: string | undefined): SupportChannel {
  const digits = (whatsapp ?? '').replace(/[^\d]/g, '');
  if (digits.length >= 8 && digits.length <= 15) {
    return { kind: 'whatsapp', number: `+${digits}`, href: `https://wa.me/${digits}` };
  }
  return { kind: 'email', email: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` };
}

const MINUTES = [60, 120, 240] as const;

export interface SupportContactProps {
  workspaceId: string;
  /** Only the owner may request a support session. */
  isOwner: boolean;
  /** Defaults to `NEXT_PUBLIC_SUPPORT_WHATSAPP` (tests pass it). */
  whatsapp?: string | undefined;
}

export function SupportContact({
  workspaceId,
  isOwner,
  whatsapp = clientEnv.NEXT_PUBLIC_SUPPORT_WHATSAPP,
}: SupportContactProps) {
  const t = useTranslations('help.contact');
  const channel = supportChannel(whatsapp);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState<number>(60);
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await requestSupportSessionAction({ workspaceId, reason, minutes });
      setState(result.ok ? 'sent' : 'error');
      if (result.ok) setReason('');
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="font-sans text-base font-semibold">{t('title')}</h3>
        {channel.kind === 'whatsapp' ? (
          <a className="text-accent underline underline-offset-2" href={channel.href}>
            {t('whatsapp', { number: channel.number })}
          </a>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{t('emailOnly')}</p>
            <a className="text-accent underline underline-offset-2" href={channel.href}>
              {t('email', { email: channel.email })}
            </a>
          </>
        )}
        <p className="text-muted-foreground text-sm">{t('hours')}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-sans text-base font-semibold">{t('request.title')}</h3>
        <p className="text-muted-foreground text-sm">{t('request.description')}</p>
        {isOwner ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              {t('request.reason')}
              <Textarea
                value={reason}
                maxLength={500}
                required
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('request.minutes')}
              <select
                className="border-line bg-surface h-10 rounded-md border px-2"
                value={minutes}
                onChange={(event) => {
                  setMinutes(Number(event.target.value));
                }}
              >
                {MINUTES.map((value) => (
                  <option key={value} value={value}>
                    {t(`request.minutes${String(value) as '60' | '120' | '240'}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={pending || reason.trim() === ''}>
              {pending ? t('request.sending') : t('request.submit')}
            </Button>
            {state === 'sent' ? <p role="status">{t('request.sent')}</p> : null}
            {state === 'error' ? <p role="alert">{t('request.error')}</p> : null}
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">{t('request.ownerOnly')}</p>
        )}
      </section>
    </div>
  );
}
