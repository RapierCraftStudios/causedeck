'use client';

// Linking for phone accounts (#503): add an email (Better Auth `changeEmail`, verified by link, only while the
// address is the phone placeholder) and link Google (`linkSocial`, trusted for linking).
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { SettingSection } from '../../../../components/settings/setting-section.tsx';

/** A text field's value from a submitted form. */
function fieldValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
}

type Status = 'idle' | 'pending' | 'added' | 'error';

export function AddEmailSection() {
  const t = useTranslations('auth.link');
  const id = useId();
  const [status, setStatus] = useState<Status>('idle');

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = fieldValue(event.currentTarget, 'email').trim();
    if (email === '') return;
    setStatus('pending');
    try {
      const { authClient } = await import('../../../../lib/auth-client.ts');
      const { error } = await authClient.changeEmail({ newEmail: email, callbackURL: '/account' });
      setStatus(error ? 'error' : 'added');
    } catch {
      setStatus('error');
    }
  }

  return (
    <SettingSection id="add-email" title={t('title')} description={t('description')}>
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-email`}>{t('emailLabel')}</Label>
          <Input id={`${id}-email`} name="email" type="email" autoComplete="email" required />
        </div>
        {status === 'error' ? <Alert tone="danger">{t('error')}</Alert> : null}
        {status === 'added' ? <p className="text-sm">{t('added')}</p> : null}
        <Button type="submit" disabled={status === 'pending'} className="self-start">
          {t('submit')}
        </Button>
      </form>
    </SettingSection>
  );
}

export function LinkGoogleSection() {
  const t = useTranslations('auth.link');
  const [failed, setFailed] = useState(false);

  async function link() {
    setFailed(false);
    try {
      const { authClient } = await import('../../../../lib/auth-client.ts');
      const { error } = await authClient.linkSocial({
        provider: 'google',
        callbackURL: '/account',
      });
      if (error) setFailed(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <SettingSection id="link-google" title={t('googleTitle')} description={t('googleDescription')}>
      {failed ? <Alert tone="danger">{t('googleError')}</Alert> : null}
      <Button type="button" onClick={() => void link()} className="self-start">
        {t('googleButton')}
      </Button>
    </SettingSection>
  );
}
