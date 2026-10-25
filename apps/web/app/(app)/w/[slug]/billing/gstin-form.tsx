'use client';

// GSTIN capture (#257): the owner saves or clears (empty) the workspace's GSTIN. The client hints
// while typing (`isValidGstin`); the server validates with `normalizeGstin` and says whether the
// format or the check character is wrong. Saving changes `subscription.gstin` only, so it applies
// to future invoices; issued invoices are never changed.
import { isValidGstin } from '@causedeck/billing/gstin';
import { Button } from '@causedeck/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import { saveGstin } from './actions.ts';
import { billingErrorKey, useOnline, type BillingErrorKey } from './seat-manager.tsx';

export interface GstinFormProps {
  workspaceId: string;
  slug: string;
  gstin: string | null;
}

export function GstinForm({ workspaceId, slug, gstin }: GstinFormProps) {
  const t = useTranslations('billing');
  const online = useOnline();
  const [value, setValue] = useState(gstin ?? '');
  const [saved, setSaved] = useState<string | null>(gstin);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingErrorKey | null>(null);
  const [status, setStatus] = useState<'saved' | 'cleared' | null>(null);

  const trimmed = value.trim();
  const hint =
    trimmed !== '' && trimmed.length >= 15 && !isValidGstin(trimmed) && error === null
      ? t('gstin.clientInvalid')
      : t('gstin.hint');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setPending(true);
    try {
      const result = await saveGstin({ workspaceId, slug, gstin: value });
      const key = billingErrorKey(result);
      if (key === null && result.ok && !result.data.error) {
        setSaved(result.data.gstin);
        setValue(result.data.gstin ?? '');
        setStatus(result.data.gstin === null ? 'cleared' : 'saved');
      } else setError(key ?? 'generic');
    } catch {
      setError('generic');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card data-slot="billing-gstin">
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('gstin.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} noValidate>
          <Field
            label={t('gstin.label')}
            hint={hint}
            error={error ? t(`errors.${error}`) : undefined}
          >
            <Input
              name="gstin"
              value={value}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              className="uppercase"
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
                setStatus(null);
              }}
            />
          </Field>
          <p className="text-ink-muted text-sm">{t('gstin.note')}</p>
          {status ? (
            <p role="status" className="text-sm">
              {t(`gstin.${status}`)}
            </p>
          ) : null}
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={pending || !online || value.trim() === (saved ?? '')}
              aria-busy={pending || undefined}
            >
              {t('gstin.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
