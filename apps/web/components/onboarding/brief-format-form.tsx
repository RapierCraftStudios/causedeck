'use client';
// The brief-format step of a chamber (#92): short or full. Saved as the chamber default
// (`workspace_settings.brief_format`) and as the owner's own M2 brief format, so the first brief the
// owner opens already uses it. Everyone can set their own later.
import { Alert } from '@causedeck/ui/alert';
import { Field } from '@causedeck/ui/field';
import { RadioGroup, RadioGroupItem } from '@causedeck/ui/radio-group';
import { BRIEF_FORMAT_VALUES } from '@causedeck/validators/onboarding';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { StepActions } from './step-actions.tsx';
import type { StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

type Format = (typeof BRIEF_FORMAT_VALUES)[number];

export function BriefFormatForm({
  scope,
  initial = 'full',
}: {
  scope: StepScope;
  initial?: Format;
}) {
  const t = useTranslations('onboarding.briefFormat');
  const nav = useTranslations('onboarding.nav');
  const [format, setFormat] = useState<Format>(initial);
  const { submit, pending, failure, online } = useStepSubmit(scope);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit('brief-format', { briefFormat: format });
      }}
      className="flex flex-col gap-5"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('legend')}</legend>
        <RadioGroup
          value={format}
          onValueChange={(value) => {
            const next = BRIEF_FORMAT_VALUES.find((item) => item === value);
            if (next) setFormat(next);
          }}
          disabled={pending}
        >
          {BRIEF_FORMAT_VALUES.map((value) => (
            <Field
              key={value}
              orientation="horizontal"
              label={t(value)}
              hint={t(`${value}Hint`)}
              className="min-h-11"
            >
              <RadioGroupItem value={value} aria-label={t(value)} />
            </Field>
          ))}
        </RadioGroup>
      </fieldset>
      {failure ? <Alert tone="danger">{t('errors.generic')}</Alert> : null}
      <StepActions
        label={nav('next')}
        pending={pending}
        disabled={!online}
        onSkip={() => void submit('brief-format', undefined, true)}
      />
    </form>
  );
}
