'use client';

import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import type { ActionErrorCode, Result } from '../../../lib/safe-action.ts';

export type WorkspaceKind = 'solo' | 'chamber';

const KINDS: readonly WorkspaceKind[] = ['solo', 'chamber'];

/** Matches `CreateWorkspaceInput.name` (packages/validators/src/workspace.ts). */
export const WORKSPACE_NAME_MAX = 120;

export type CreateWorkspace = (input: {
  name: string;
  kind: WorkspaceKind;
}) => Promise<Result<{ slug: string }>>;

type NameError = 'nameRequired' | 'nameTooLong' | 'nameInvalid';
type FormError = 'offline' | 'signedOut' | 'generic';

/** Client-side check mirroring the server's, so most mistakes never leave the page. */
function nameErrorFor(name: string): NameError | null {
  if (name.length === 0) return 'nameRequired';
  if (name.length > WORKSPACE_NAME_MAX) return 'nameTooLong';
  return null;
}

function formErrorFor(code: ActionErrorCode): FormError {
  return code === 'UNAUTHENTICATED' ? 'signedOut' : 'generic';
}

export interface CreateWorkspaceFormProps {
  /** The `createWorkspaceAction` server action; injectable for tests. */
  action: CreateWorkspace;
}

/**
 * Segmented `Just me` / `A chamber`, the workspace name and `Create workspace`. Errors render
 * inline: under the name field, or above the button for anything not about the name.
 */
export function CreateWorkspaceForm({ action }: CreateWorkspaceFormProps) {
  const t = useTranslations('workspace.onboarding');
  const router = useRouter();
  const [kind, setKind] = useState<WorkspaceKind>('solo');
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
    if (!navigator.onLine) {
      setFormError('offline');
      return;
    }
    setPending(true);
    try {
      const result = await action({ name, kind });
      if (result.ok) {
        router.push(`/w/${encodeURIComponent(result.data.slug)}/today`);
        router.refresh();
        return;
      }
      if (result.error.code === 'VALIDATION') setNameError('nameInvalid');
      else setFormError(formErrorFor(result.error.code));
    } catch {
      setFormError('generic');
    }
    setPending(false);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" noValidate>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t('kindLabel')}</legend>
        <div className="bg-surface-sunken grid grid-cols-2 gap-1 rounded-md p-1">
          {KINDS.map((value) => (
            <label
              key={value}
              data-kind={value}
              className="text-ink-muted has-[:checked]:bg-surface has-[:checked]:text-ink has-[:focus-visible]:outline-ring flex h-10 cursor-pointer items-center justify-center rounded-sm text-sm font-medium outline-offset-2 has-[:checked]:shadow-sm has-[:focus-visible]:outline-2"
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => {
                  setKind(value);
                }}
                disabled={pending}
                className="sr-only"
              />
              {t(`kind.${value}`)}
            </label>
          ))}
        </div>
        <p className="text-ink-muted text-sm">{t(`kindHint.${kind}`)}</p>
      </fieldset>
      <Field
        label={t('nameLabel')}
        error={nameError ? t(`errors.${nameError}`, { max: WORKSPACE_NAME_MAX }) : undefined}
        required
      >
        <Input
          name="name"
          autoComplete="organization"
          placeholder={t(`namePlaceholder.${kind}`)}
          maxLength={WORKSPACE_NAME_MAX + 1}
          disabled={pending}
          className="h-11"
        />
      </Field>
      {formError ? <Alert tone="danger">{t(`errors.${formError}`)}</Alert> : null}
      <Button
        type="submit"
        size="lg"
        loading={pending}
        labels={{ loading: t('creating') }}
        className="w-full"
      >
        {t('submit')}
      </Button>
    </form>
  );
}
