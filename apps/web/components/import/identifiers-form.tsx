'use client';
// The identifiers step of the bootstrap import (#552, #550): without a saved enrolment number or
// name spelling no list row is imported. What the member typed is proposed back and saved only
// after they confirm it.
import { Button } from '@causedeck/ui/button';
import { Textarea } from '@causedeck/ui/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface Identifiers {
  enrolmentNumbers: string[];
  aliases: string[];
}

export interface IdentifiersFormProps {
  /** Set once the server proposed the normalised values back. */
  proposed: Identifiers | null;
  busy: boolean;
  onPropose: (identifiers: Identifiers) => void;
  onConfirm: (identifiers: Identifiers) => void;
  onEdit: () => void;
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export function IdentifiersForm({
  proposed,
  busy,
  onPropose,
  onConfirm,
  onEdit,
}: IdentifiersFormProps) {
  const t = useTranslations('bootstrapImport');
  const [enrolment, setEnrolment] = useState('');
  const [aliases, setAliases] = useState('');

  if (proposed !== null) {
    return (
      <section data-slot="import-identifiers-confirm" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t('identifiers.confirmTitle')}</h2>
        <p className="text-muted-foreground text-sm">{t('identifiers.confirmBody')}</p>
        <ul className="list-disc ps-5 text-sm">
          {[...proposed.enrolmentNumbers, ...proposed.aliases].map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              onConfirm(proposed);
            }}
          >
            {t('identifiers.confirm')}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onEdit}>
            {t('identifiers.edit')}
          </Button>
        </div>
      </section>
    );
  }

  const typed = { enrolmentNumbers: lines(enrolment), aliases: lines(aliases) };
  return (
    <section data-slot="import-identifiers" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t('identifiers.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('identifiers.body')}</p>
      <label className="grid gap-1 text-sm">
        {t('identifiers.enrolment')}
        <Textarea
          value={enrolment}
          rows={3}
          onChange={(event) => {
            setEnrolment(event.target.value);
          }}
        />
      </label>
      <label className="grid gap-1 text-sm">
        {t('identifiers.aliases')}
        <Textarea
          value={aliases}
          rows={3}
          onChange={(event) => {
            setAliases(event.target.value);
          }}
        />
      </label>
      <div>
        <Button
          type="button"
          disabled={busy || (typed.enrolmentNumbers.length === 0 && typed.aliases.length === 0)}
          onClick={() => {
            onPropose(typed);
          }}
        >
          {t('identifiers.propose')}
        </Button>
      </div>
    </section>
  );
}
