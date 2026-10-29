'use client';
// Log an enquiry (#874, #87): who asked, how it came in, a summary, and the parties to check for a
// conflict (one name per line, client side or adverse side). The server checks everything again
// (E.164 phone) and answers FORBIDDEN for a role below advocate. `Cmd/Ctrl+Enter` saves; offline,
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
import { useHotkey } from '@causedeck/ui/hooks';
import { Input } from '@causedeck/ui/input';
import { Textarea } from '@causedeck/ui/textarea';
import { ENQUIRY_CHANNELS, type EnquiryChannel } from '@causedeck/validators/enquiry';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { enquiryErrorKey, type EnquiryActions } from './enquiry-actions.ts';

export interface EnquiryFormProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offline?: boolean;
  log: EnquiryActions['log'];
}

function partiesOf(text: string, side: 'client' | 'adverse') {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((name) => ({ name, side }));
}

export function EnquiryForm({
  workspaceId,
  open,
  onOpenChange,
  offline = false,
  log,
}: EnquiryFormProps) {
  const t = useTranslations('enquiry');
  const channelId = useId();
  const router = useRouter();
  const [enquirerName, setEnquirerName] = useState('');
  const [channel, setChannel] = useState<EnquiryChannel>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [summary, setSummary] = useState('');
  const [clients, setClients] = useState('');
  const [adverse, setAdverse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving || offline) return;
    if (enquirerName.trim() === '' || summary.trim() === '') {
      setError(t('form.error.required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await log({
        workspaceId,
        enquirerName: enquirerName.trim(),
        channel,
        summary: summary.trim(),
        ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
        ...(email.trim() === '' ? {} : { email: email.trim() }),
        parties: [...partiesOf(clients, 'client'), ...partiesOf(adverse, 'adverse')],
      });
      if (result.ok) {
        setEnquirerName('');
        setPhone('');
        setEmail('');
        setSummary('');
        setClients('');
        setAdverse('');
        onOpenChange(false);
        router.refresh();
        return;
      }
      setError(t(`form.error.${enquiryErrorKey(result.error.code)}`));
    } catch {
      setError(t('form.error.failed'));
    } finally {
      setSaving(false);
    }
  };

  useHotkey(
    'mod+enter',
    () => {
      void submit();
    },
    { enabled: open },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('form.title')}</DialogTitle>
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
          id="enquiry-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t('form.enquirer')} required>
            <Input
              autoComplete="off"
              data-enquiry-field="enquirer"
              value={enquirerName}
              maxLength={300}
              onChange={(event) => {
                setEnquirerName(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.channel')} controlId={channelId}>
            <select
              id={channelId}
              data-enquiry-field="channel"
              className="border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm"
              value={channel}
              onChange={(event) => {
                const next = ENQUIRY_CHANNELS.find((c) => c === event.target.value);
                if (next !== undefined) setChannel(next);
              }}
            >
              {ENQUIRY_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`channels.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('form.phone')} hint={t('form.phoneHint')}>
            <Input
              type="tel"
              autoComplete="off"
              data-enquiry-field="phone"
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
              data-enquiry-field="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.summary')} required>
            <Textarea
              data-enquiry-field="summary"
              value={summary}
              maxLength={4000}
              onChange={(event) => {
                setSummary(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.clients')} hint={t('form.partiesHint')}>
            <Textarea
              data-enquiry-field="clients"
              value={clients}
              onChange={(event) => {
                setClients(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.adverse')} hint={t('form.partiesHint')}>
            <Textarea
              data-enquiry-field="adverse"
              value={adverse}
              onChange={(event) => {
                setAdverse(event.target.value);
              }}
            />
          </Field>
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
          <Button type="submit" form="enquiry-form" disabled={saving || offline}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
