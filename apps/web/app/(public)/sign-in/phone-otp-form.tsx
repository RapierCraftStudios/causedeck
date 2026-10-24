'use client';

import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Spinner } from '@causedeck/ui/spinner';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';

import { RESEND_AFTER_SECONDS } from './check-email.tsx';

/** A text field's value from a submitted form. */
function fieldValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
}

export const COUNTRY_CODE = '+91';
export const OTP_LENGTH = 6;

/** Ten digits typed after `+91` (spaces and dashes tolerated) -> E.164, else null. */
export function toE164(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^[6-9]\d{9}$/.test(digits) ? `${COUNTRY_CODE}${digits}` : null;
}

/** Ask Better Auth to text a code. Throws when the request fails (including the rate limit). */
export async function sendPhoneOtp(phoneNumber: string): Promise<void> {
  const { authClient } = await import('../../../lib/auth-client.ts');
  const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber });
  if (error) throw new Error(error.message ?? 'otp request failed');
}

type Failure = 'invalidNumber' | 'sendFailed' | 'invalidCode' | 'expiredCode' | 'tooManyAttempts';

const FAILURE_KEYS = {
  invalidNumber: 'phone.errors.invalidNumber',
  sendFailed: 'phone.errors.sendFailed',
  invalidCode: 'phone.errors.invalidCode',
  expiredCode: 'phone.errors.expiredCode',
  tooManyAttempts: 'phone.errors.tooManyAttempts',
} as const satisfies Record<Failure, string>;

function failureOf(code: string | undefined): Failure {
  if (code === 'OTP_EXPIRED') return 'expiredCode';
  if (code === 'TOO_MANY_ATTEMPTS') return 'tooManyAttempts';
  return 'invalidCode';
}

export interface PhoneOtpFormProps {
  next: string;
  offline: boolean;
}

/**
 * Phone-first sign-in: a mobile number (+91) and a six-digit code texted to it. Signs the person
 * in, creating the account on first use, then navigates to `next`.
 */
export function PhoneOtpForm({ next, offline }: PhoneOtpFormProps) {
  const t = useTranslations('auth.signIn');
  const id = useId();
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => {
      setSeconds((s) => s - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [seconds]);

  async function send(number: string) {
    setPending(true);
    setFailure(null);
    try {
      await sendPhoneOtp(number);
      setPhoneNumber(number);
      setSeconds(RESEND_AFTER_SECONDS);
    } catch {
      setFailure('sendFailed');
    } finally {
      setPending(false);
    }
  }

  async function onSubmitNumber(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offline) return;
    const number = toE164(fieldValue(event.currentTarget, 'phone'));
    if (number === null) {
      setFailure('invalidNumber');
      return;
    }
    await send(number);
  }

  async function onSubmitCode(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offline || phoneNumber === null) return;
    const code = fieldValue(event.currentTarget, 'code').trim();
    if (code.length !== OTP_LENGTH) {
      setFailure('invalidCode');
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const { authClient } = await import('../../../lib/auth-client.ts');
      const { error } = await authClient.phoneNumber.verify({ phoneNumber, code });
      if (error) {
        setFailure(failureOf(error.code));
        return;
      }
      window.location.assign(next);
    } catch {
      setFailure('invalidCode');
    } finally {
      setPending(false);
    }
  }

  const alert = failure ? <Alert tone="danger">{t(FAILURE_KEYS[failure])}</Alert> : null;
  const spinner = (label: string) =>
    pending ? (
      <>
        <Spinner size="lg" decorative />
        {t('sending')}
      </>
    ) : (
      label
    );

  if (phoneNumber !== null) {
    return (
      <form
        onSubmit={(event) => void onSubmitCode(event)}
        className="flex flex-col gap-3"
        noValidate
      >
        <p className="text-ink-muted text-sm">
          {t('phone.codeSent', { phone: phoneNumber, minutes: 5 })}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-code`}>{t('phone.codeLabel')}</Label>
          <Input
            id={`${id}-code`}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            pattern="[0-9]*"
            required
            disabled={pending}
            aria-invalid={failure !== null || undefined}
            className="h-11 tracking-widest"
          />
        </div>
        {alert}
        <Button
          type="submit"
          size="lg"
          disabled={pending || offline}
          aria-busy={pending || undefined}
          className="w-full"
        >
          {spinner(t('phone.verify'))}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-ink-muted underline"
            onClick={() => {
              setFailure(null);
              setPhoneNumber(null);
            }}
          >
            {t('phone.differentNumber')}
          </button>
          <button
            type="button"
            className="underline disabled:no-underline disabled:opacity-60"
            disabled={seconds > 0 || pending || offline}
            onClick={() => void send(phoneNumber)}
          >
            {seconds > 0 ? t('phone.resendIn', { seconds }) : t('phone.resend')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => void onSubmitNumber(event)}
      className="flex flex-col gap-3"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-phone`}>{t('phone.label')}</Label>
        <div className="flex items-center gap-2">
          <span className="text-ink-muted text-sm" aria-hidden="true">
            {COUNTRY_CODE}
          </span>
          <Input
            id={`${id}-phone`}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder={t('phone.placeholder')}
            required
            disabled={pending}
            aria-invalid={failure !== null || undefined}
            className="h-11"
          />
        </div>
      </div>
      {alert}
      <Button
        type="submit"
        size="lg"
        disabled={pending || offline}
        aria-busy={pending || undefined}
        className="w-full"
      >
        {spinner(t('phone.submit'))}
      </Button>
    </form>
  );
}
