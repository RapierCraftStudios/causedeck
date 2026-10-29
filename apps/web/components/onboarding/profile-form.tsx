'use client';
// The practice profile (#92, memory M1): enrolment number, bar council, practice areas and working
// languages. Validated with the same zod schema as the server (`ProfileStepInput`); errors are
// linked to their fields with `aria-describedby` (through `Field`) and summarised above the form.
// Language names render in their own script (Tamil, Kannada), and the inputs accept Tamil and
// Kannada text. Enrolment uses `autocomplete="off"` (it is not an address or a name).
import { Alert } from '@causedeck/ui/alert';
import { Checkbox } from '@causedeck/ui/checkbox';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import {
  BAR_COUNCIL_VALUES,
  PRACTICE_AREA_VALUES,
  ProfileStepInput,
  WORKING_LANGUAGE_VALUES,
} from '@causedeck/validators/onboarding';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import { StepActions } from './step-actions.tsx';
import type { StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

type FieldKey = 'enrolment' | 'barCouncil' | 'practiceAreas' | 'languages';

export interface ProfileFormProps {
  scope: StepScope;
  /** Saved values, when the member returns to this step. */
  initial?: Partial<{
    enrolmentNumber: string;
    barCouncil: string;
    practiceAreas: string[];
    languages: string[];
  }>;
}

export function ProfileForm({ scope, initial }: ProfileFormProps) {
  const t = useTranslations('onboarding.profile');
  const nav = useTranslations('onboarding.nav');
  const [enrolment, setEnrolment] = useState(initial?.enrolmentNumber ?? '');
  const [council, setCouncil] = useState(initial?.barCouncil ?? '');
  const [areas, setAreas] = useState<string[]>(initial?.practiceAreas ?? []);
  const [languages, setLanguages] = useState<string[]>(initial?.languages ?? ['en']);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, true>>>({});
  const { submit, pending, failure, online } = useStepSubmit(scope);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ProfileStepInput.safeParse({
      enrolmentNumber: enrolment,
      barCouncil: council,
      practiceAreas: areas,
      languages,
    });
    if (!parsed.success) {
      const next: Partial<Record<FieldKey, true>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'enrolmentNumber') next.enrolment = true;
        else if (key === 'barCouncil') next.barCouncil = true;
        else if (key === 'practiceAreas') next.practiceAreas = true;
        else if (key === 'languages') next.languages = true;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    await submit('profile', parsed.data);
  }

  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" noValidate>
      {hasErrors ? (
        <Alert tone="danger" role="alert">
          {t('errors.summary')}
        </Alert>
      ) : null}
      <Field
        label={t('enrolmentLabel')}
        hint={t('enrolmentHint')}
        error={errors.enrolment ? t('errors.enrolment') : undefined}
        required
      >
        <Input
          name="enrolment"
          autoComplete="off"
          inputMode="text"
          value={enrolment}
          onChange={(event) => {
            setEnrolment(event.target.value);
          }}
          disabled={pending}
          className="h-11"
        />
      </Field>
      <Field
        label={t('barCouncilLabel')}
        error={errors.barCouncil ? t('errors.barCouncil') : undefined}
        required
      >
        <Select value={council} onValueChange={setCouncil} disabled={pending}>
          <SelectTrigger className="h-11">
            <SelectValue placeholder={t('barCouncilPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {BAR_COUNCIL_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`councils.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <CheckGroup
        legend={t('practiceAreasLegend')}
        error={errors.practiceAreas ? t('errors.practiceAreas') : undefined}
        options={PRACTICE_AREA_VALUES.map((value) => ({ value, label: t(`areas.${value}`) }))}
        selected={areas}
        onToggle={(value) => {
          setAreas((list) => toggle(list, value));
        }}
        disabled={pending}
      />
      <CheckGroup
        legend={t('languagesLegend')}
        hint={t('languagesHint')}
        error={errors.languages ? t('errors.languages') : undefined}
        options={WORKING_LANGUAGE_VALUES.map((value) => ({
          value,
          label: t(`languages.${value}`),
        }))}
        selected={languages}
        onToggle={(value) => {
          setLanguages((list) => toggle(list, value));
        }}
        disabled={pending}
      />
      {failure ? <Alert tone="danger">{t('errors.generic')}</Alert> : null}
      <StepActions label={nav('next')} pending={pending} disabled={!online} />
    </form>
  );
}

interface CheckGroupProps {
  legend: string;
  hint?: string;
  error: string | undefined;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  disabled: boolean;
}

/** A fieldset of checkboxes, 44 px targets; the error is tied to the group with `aria-describedby`. */
function CheckGroup({
  legend,
  hint,
  error,
  options,
  selected,
  onToggle,
  disabled,
}: CheckGroupProps) {
  const base = legend.replace(/\s+/g, '-').toLowerCase();
  const errorId = error ? `${base}-error` : undefined;
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={errorId}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {hint ? <p className="text-ink-muted text-sm">{hint}</p> : null}
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {options.map((option) => (
          <Field
            key={option.value}
            orientation="horizontal"
            label={option.label}
            className="min-h-11"
          >
            <Checkbox
              checked={selected.includes(option.value)}
              onCheckedChange={() => {
                onToggle(option.value);
              }}
              disabled={disabled}
            />
          </Field>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
