'use client';
// Step 1 of both paths (#92): name the workspace. The path (solo or chamber) was chosen on
// `/onboarding`. The India-residency statement sits above, in the shell, before anything is typed.
import { Alert } from '@causedeck/ui/alert';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { WORKSPACE_NAME_MAX_LENGTH } from '@causedeck/validators/workspace';
import type { OnboardingPath } from '@causedeck/validators/onboarding';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { StepActions } from './step-actions.tsx';
import { stepHref } from './steps.ts';

export type CreateWorkspace = (input: {
  name: string;
  kind: OnboardingPath;
}) => Promise<Result<{ slug: string }>>;

type NameError = 'nameRequired' | 'nameTooLong' | 'nameInvalid';
type FormError = 'generic';

export interface WorkspaceStepProps {
  path: OnboardingPath;
  /** The `createWorkspaceAction` server action; injectable for tests and stories. */
  action: CreateWorkspace;
}

function nameErrorFor(name: string): NameError | null {
  if (name.length === 0) return 'nameRequired';
  if (name.length > WORKSPACE_NAME_MAX_LENGTH) return 'nameTooLong';
  return null;
}

export function WorkspaceStep({ path, action }: WorkspaceStepProps) {
  const t = useTranslations('onboarding.workspace');
  const router = useRouter();
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('name');
    const name = typeof value === 'string' ? value.trim() : '';
    setFormError(null);
    const invalid = nameErrorFor(name);
    setNameError(invalid);
    if (invalid) return;
    setPending(true);
    try {
      const result = await action({ name, kind: path });
      if (result.ok) {
        // The state starts with the workspace; the next step is saved as the resume point.
        router.push(stepHref(path, path === 'solo' ? 'profile' : 'invite', result.data.slug));
        return;
      }
      if (result.error.code === 'VALIDATION') setNameError('nameInvalid');
      else setFormError('generic');
    } catch {
      setFormError('generic');
    }
    setPending(false);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" noValidate>
      <Field
        label={t('nameLabel')}
        error={nameError ? t(`errors.${nameError}`, { max: WORKSPACE_NAME_MAX_LENGTH }) : undefined}
        required
      >
        <Input
          name="name"
          autoComplete="organization"
          placeholder={t(`namePlaceholder.${path}`)}
          maxLength={WORKSPACE_NAME_MAX_LENGTH + 1}
          disabled={pending}
          className="h-11"
        />
      </Field>
      {formError ? <Alert tone="danger">{t(`errors.${formError}`)}</Alert> : null}
      <StepActions label={t('submit')} pending={pending} />
    </form>
  );
}
