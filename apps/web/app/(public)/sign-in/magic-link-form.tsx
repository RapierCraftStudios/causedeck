'use client';

import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Spinner } from '@causedeck/ui/spinner';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';

import { signInPathFor } from '../../../lib/safe-next.ts';

/** Ask Better Auth to email a magic link that lands on `next`. Throws when the request fails. */
export async function sendMagicLink(email: string, next: string): Promise<void> {
  const { authClient } = await import('../../../lib/auth-client.ts');
  const { error } = await authClient.signIn.magicLink({
    email,
    callbackURL: next,
    // Better Auth appends `?error=<code>` (e.g. EXPIRED_TOKEN), which the page turns into copy.
    errorCallbackURL: signInPathFor(next),
  });
  if (error) throw new Error(error.message ?? 'magic link request failed');
}

export interface MagicLinkFormProps {
  next: string;
  offline: boolean;
  defaultEmail?: string;
  onSent: (email: string) => void;
}

/**
 * Email field plus `Email me a sign-in link`. The field also offers saved passkeys
 * (`autocomplete="username webauthn"`, conditional UI). Enter submits.
 */
export function MagicLinkForm({ next, offline, defaultEmail = '', onSent }: MagicLinkFormProps) {
  const t = useTranslations('auth.signIn');
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Autofocus on desktop only: on phones it would pop the keyboard over the page.
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) inputRef.current?.focus();
  }, []);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inputRef.current?.value.trim() ?? '';
    if (!email || offline) return;
    setPending(true);
    setFailed(false);
    try {
      await sendMagicLink(email, next);
      onSent(email);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`}>{t('emailLabel')}</Label>
        <Input
          ref={inputRef}
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username webauthn"
          placeholder={t('emailPlaceholder')}
          defaultValue={defaultEmail}
          required
          disabled={pending}
          aria-invalid={failed || undefined}
          className="h-11"
        />
      </div>
      {failed ? <Alert tone="danger">{t('errors.sendFailed')}</Alert> : null}
      <Button
        type="submit"
        size="lg"
        disabled={pending || offline}
        aria-busy={pending || undefined}
        className="w-full"
      >
        {pending ? (
          <>
            <Spinner size="lg" decorative />
            {t('sending')}
          </>
        ) : (
          t('submit')
        )}
      </Button>
    </form>
  );
}
