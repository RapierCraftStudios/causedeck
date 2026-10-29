'use client';
// The courts step (#92): pick the forums from the catalogue with a combobox; chosen courts are a
// removable list. Madras High Court's Principal Seat is preselected for Chennai and the High Court
// of Karnataka for Bengaluru (`defaultCodes`, from the practice city), and the page says so. The
// codes go to the server, which keeps only forums this workspace can see.
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { Combobox } from '@causedeck/ui/combobox';
import { Field } from '@causedeck/ui/field';
import { CourtsStepInput } from '@causedeck/validators/onboarding';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import { StepActions } from './step-actions.tsx';
import type { StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

export interface CourtOption {
  /** The forum catalogue code. */
  code: string;
  /** `Madras High Court, Principal Seat, Original Side`. */
  label: string;
}

export interface CourtPickerProps {
  scope: StepScope;
  courts: readonly CourtOption[];
  /** Codes preselected for the practice city; empty when the city has no default. */
  defaultCodes: readonly string[];
  /** The city the default came from, for the note. */
  defaultCity?: string | undefined;
  /** Saved codes, when the member returns. */
  initial?: readonly string[] | undefined;
}

export function CourtPicker({
  scope,
  courts,
  defaultCodes,
  defaultCity,
  initial,
}: CourtPickerProps) {
  const t = useTranslations('onboarding.courts');
  const nav = useTranslations('onboarding.nav');
  const known = new Set(courts.map((court) => court.code));
  const [chosen, setChosen] = useState<string[]>(
    (initial ?? defaultCodes).filter((code) => known.has(code)),
  );
  const [empty, setEmpty] = useState(false);
  const { submit, pending, failure, online } = useStepSubmit(scope);

  const labelOf = (code: string) => courts.find((court) => court.code === code)?.label ?? code;
  const available = courts.filter((court) => !chosen.includes(court.code));

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CourtsStepInput.safeParse({ forumCodes: chosen });
    setEmpty(!parsed.success);
    if (parsed.success) await submit('courts', parsed.data);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" noValidate>
      {defaultCity && chosen.length > 0 ? (
        <p className="text-ink-muted text-sm">{t('defaultNote', { city: defaultCity })}</p>
      ) : null}
      <Field label={t('searchLabel')} error={empty ? t('errors.required') : undefined}>
        <Combobox
          options={available.map((court) => ({ value: court.code, label: court.label }))}
          value={null}
          onValueChange={(code) => {
            if (code !== null) {
              setChosen((list) => (list.includes(code) ? list : [...list, code]));
              setEmpty(false);
            }
          }}
          placeholder={t('searchPlaceholder')}
          labels={{ empty: t('none') }}
          disabled={pending}
        />
      </Field>
      <section aria-label={t('listLabel')} className="flex flex-col gap-2">
        <p role="status" className="text-ink-muted text-sm">
          {t('selected', { count: chosen.length })}
        </p>
        <ul className="flex flex-wrap gap-2">
          {chosen.map((code) => (
            <li key={code}>
              <Badge tone="neutral" className="min-h-9 gap-2 px-3 text-sm">
                {labelOf(code)}
                <button
                  type="button"
                  aria-label={t('remove', { court: labelOf(code) })}
                  disabled={pending}
                  onClick={() => {
                    setChosen((list) => list.filter((item) => item !== code));
                  }}
                  className="focus-visible:outline-ring -mr-1 inline-flex size-6 items-center justify-center rounded-full outline-offset-2 focus-visible:outline-2"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      </section>
      {failure ? <Alert tone="danger">{t('errors.generic')}</Alert> : null}
      <StepActions label={nav('next')} pending={pending} disabled={!online} />
    </form>
  );
}
