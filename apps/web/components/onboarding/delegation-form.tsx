'use client';
// The delegation step of a chamber (#92): defaults for how appearances are handed out. They are
// saved to `workspace_settings.delegation_defaults` and are only defaults: any appearance can be
// reassigned. Notifications stay inside CauseDeck; nothing leaves the chamber.
import { Alert } from '@causedeck/ui/alert';
import { Field } from '@causedeck/ui/field';
import { RadioGroup, RadioGroupItem } from '@causedeck/ui/radio-group';
import { Switch } from '@causedeck/ui/switch';
import {
  DELEGATION_CAPACITY_DEFAULTS,
  DEFAULT_DELEGATION_DEFAULTS,
  type DelegationDefaults,
} from '@causedeck/validators/onboarding';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { StepActions } from './step-actions.tsx';
import type { StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

export interface DelegationFormProps {
  scope: StepScope;
  initial?: DelegationDefaults | undefined;
}

export function DelegationForm({
  scope,
  initial = DEFAULT_DELEGATION_DEFAULTS,
}: DelegationFormProps) {
  const t = useTranslations('onboarding.delegation');
  const nav = useTranslations('onboarding.nav');
  const [values, setValues] = useState<DelegationDefaults>(initial);
  const { submit, pending, failure, online } = useStepSubmit(scope);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit('delegation', values);
      }}
      className="flex flex-col gap-5"
    >
      <Field label={t('suggest')} hint={t('suggestHint')} orientation="horizontal">
        <Switch
          checked={values.suggestAssignments}
          onCheckedChange={(checked) => {
            setValues((current) => ({ ...current, suggestAssignments: checked }));
          }}
          disabled={pending}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('capacityLabel')}</legend>
        <RadioGroup
          value={values.defaultCapacity}
          onValueChange={(value) => {
            const capacity = DELEGATION_CAPACITY_DEFAULTS.find((item) => item === value);
            if (capacity) setValues((current) => ({ ...current, defaultCapacity: capacity }));
          }}
          disabled={pending}
        >
          {DELEGATION_CAPACITY_DEFAULTS.map((capacity) => (
            <Field
              key={capacity}
              orientation="horizontal"
              label={t(`capacity.${capacity}`)}
              className="min-h-11"
            >
              <RadioGroupItem value={capacity} aria-label={t(`capacity.${capacity}`)} />
            </Field>
          ))}
        </RadioGroup>
      </fieldset>
      <Field label={t('notify')} hint={t('notifyHint')} orientation="horizontal">
        <Switch
          checked={values.notifyAssignee}
          onCheckedChange={(checked) => {
            setValues((current) => ({ ...current, notifyAssignee: checked }));
          }}
          disabled={pending}
        />
      </Field>
      {failure ? <Alert tone="danger">{t('errors.generic')}</Alert> : null}
      <StepActions
        label={nav('next')}
        pending={pending}
        disabled={!online}
        onSkip={() => void submit('delegation', undefined, true)}
      />
    </form>
  );
}
