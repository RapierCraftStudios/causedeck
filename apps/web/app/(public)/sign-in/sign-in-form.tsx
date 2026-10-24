'use client';

import { Alert } from '@causedeck/ui/alert';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import { CheckEmail } from './check-email.tsx';
import { GoogleButton } from './google-button.tsx';
import { MagicLinkForm, sendMagicLink } from './magic-link-form.tsx';
import { PasskeyButton } from './passkey-button.tsx';
import { PhoneOtpForm } from './phone-otp-form.tsx';

/** Errors the page can arrive with (`/sign-in?error=...`), already mapped by `page.tsx`. */
export type SignInError = 'access_denied' | 'expired' | 'generic';

const ERROR_KEYS = {
  access_denied: 'errors.accessDenied',
  expired: 'errors.expired',
  generic: 'errors.generic',
} as const satisfies Record<SignInError, string>;

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** `navigator.onLine`, live. The server render assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export interface SignInFormProps {
  googleEnabled: boolean;
  /** Already sanitised with `safeNextPath`. */
  next: string;
  initialError: SignInError | null;
  expiresInMinutes: number;
}

/**
 * The sign-in stack: phone OTP first (#503), `or`, Google (when enabled), passkey, `or`, magic link;
 * then `Check your email`.
 */
export function SignInForm({
  googleEnabled,
  next,
  initialError,
  expiresInMinutes,
}: SignInFormProps) {
  const t = useTranslations('auth.signIn');
  const online = useOnline();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<SignInError | null>(initialError);

  const showGeneric = () => {
    setError('generic');
  };

  if (sentTo !== null) {
    return (
      <CheckEmail
        email={sentTo}
        expiresInMinutes={expiresInMinutes}
        onUseDifferentEmail={() => {
          setError(null);
          setSentTo(null);
        }}
        onResend={() => sendMagicLink(sentTo, next)}
      />
    );
  }

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-4">
      {online ? null : (
        <Alert tone="warning" role="alert">
          {t('errors.offline')}
        </Alert>
      )}
      {error ? <Alert tone="danger">{t(ERROR_KEYS[error])}</Alert> : null}
      <PhoneOtpForm next={next} offline={!online} />
      <div className="text-ink-muted flex items-center gap-3 text-xs" role="separator">
        <span aria-hidden="true" className="bg-line h-px flex-1" />
        <span>{t('or')}</span>
        <span aria-hidden="true" className="bg-line h-px flex-1" />
      </div>
      <div className="flex flex-col gap-3">
        {googleEnabled ? <GoogleButton next={next} onError={showGeneric} /> : null}
        <PasskeyButton next={next} onError={showGeneric} />
      </div>
      <div className="text-ink-muted flex items-center gap-3 text-xs" role="separator">
        <span aria-hidden="true" className="bg-line h-px flex-1" />
        <span>{t('or')}</span>
        <span aria-hidden="true" className="bg-line h-px flex-1" />
      </div>
      <MagicLinkForm
        next={next}
        offline={!online}
        onSent={(email) => {
          setError(null);
          setSentTo(email);
        }}
      />
    </div>
  );
}
