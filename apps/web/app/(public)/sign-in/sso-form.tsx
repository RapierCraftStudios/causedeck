'use client';

import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { signInPathFor } from '../../../lib/safe-next.ts';

export interface SsoFormProps {
  next: string;
  offline: boolean;
}

/**
 * `Sign in with SSO` (#683): work email, then the identity provider of that email's domain. Every
 * failure, including an unknown or disabled domain, shows the same message, so the form cannot be
 * used to find out which organisations use SSO.
 */
export function SsoForm({ next, offline }: SsoFormProps) {
  const t = useTranslations('auth.signIn.sso');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const raw = data.get('email');
    const email = typeof raw === 'string' ? raw.trim() : '';
    if (!email || offline) return;
    setPending(true);
    setFailed(false);
    try {
      const { authClient } = await import('../../../lib/auth-client.ts');
      const { error } = await authClient.signIn.sso({
        email,
        callbackURL: next,
        errorCallbackURL: signInPathFor(next),
      });
      // On success the browser is already navigating to the identity provider.
      if (error) throw new Error(error.message ?? 'sso sign-in failed');
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="sso-open"
      >
        {t('open')}
      </Button>
    );
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`}>{t('emailLabel')}</Label>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          required
        />
      </div>
      {failed ? <Alert tone="danger">{t('failed')}</Alert> : null}
      <Button type="submit" variant="outline" size="lg" loading={pending} disabled={offline}>
        {t('submit')}
      </Button>
    </form>
  );
}
