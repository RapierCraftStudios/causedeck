'use client';
// New contact (#848, #82): the client's name (a client of that name is made in the same step),
// kind, phone, email and language. At least a phone or an email is required; the server checks
// them again (E.164 phone) and answers FORBIDDEN for a role that may not write contacts. Offline,
// saving is off. `Esc` closes the dialog and focus returns to the invoker.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import {
  CONTACT_KINDS,
  type ContactKind,
  type LanguagePref,
} from '@causedeck/validators/client-contact';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';

import { LanguagePrefField } from './language-pref-field.tsx';

export interface ContactFormProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offline?: boolean;
  createAction: (input: unknown) => Promise<Result<{ id: string; personId: string }>>;
}

export function ContactForm({
  workspaceId,
  open,
  onOpenChange,
  offline = false,
  createAction,
}: ContactFormProps) {
  const t = useTranslations('people');
  const router = useRouter();
  const [clientName, setClientName] = useState('');
  const [kind, setKind] = useState<ContactKind>('primary');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [languagePref, setLanguagePref] = useState<LanguagePref>('en');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || offline) return;
    if (clientName.trim() === '') {
      setError(t('form.clientHint'));
      return;
    }
    if (phone.trim() === '' && email.trim() === '') {
      setError(t('form.needOne'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createAction({
        workspaceId,
        clientName: clientName.trim(),
        kind,
        languagePref,
        ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
        ...(email.trim() === '' ? {} : { email: email.trim() }),
      });
      if (result.ok) {
        onOpenChange(false);
        router.refresh();
        return;
      }
      setError(
        result.error.code === 'FORBIDDEN'
          ? t('form.forbidden')
          : result.error.code === 'VALIDATION'
            ? t('form.invalid')
            : t('form.failed'),
      );
    } catch {
      setError(t('form.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('form.titleNew')}</DialogTitle>
        </DialogHeader>
        {offline ? (
          <Alert tone="warning" role="status">
            {t('offline')}
          </Alert>
        ) : null}
        {error === null ? null : (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <form
          noValidate
          id="contact-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => void onSubmit(event)}
        >
          <Field label={t('form.client')} hint={t('form.clientHint')} required>
            <Input
              autoComplete="off"
              data-contact-field="client"
              value={clientName}
              maxLength={300}
              onChange={(event) => {
                setClientName(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.kind')}>
            <select
              data-contact-field="kind"
              className="border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm"
              value={kind}
              onChange={(event) => {
                const next = CONTACT_KINDS.find((k) => k === event.target.value);
                if (next !== undefined) setKind(next);
              }}
            >
              {CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('form.phone')} hint={t('form.phoneHint')}>
            <Input
              type="tel"
              autoComplete="off"
              data-contact-field="phone"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.email')}>
            <Input
              type="email"
              autoComplete="off"
              data-contact-field="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <LanguagePrefField value={languagePref} onChange={setLanguagePref} />
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('form.cancel')}
          </Button>
          <Button type="submit" form="contact-form" disabled={saving || offline}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
