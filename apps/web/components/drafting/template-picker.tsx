'use client';
// New draft (#826): the suggested templates (the matter's court first), a title and an optional
// matter. `createDraftAction` checks `draft.write` again; on success the studio route for the new
// draft opens. Offline, submitting is off with the reason. Creating a draft sends, shares and files
// nothing.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';
import { useOnline } from '../matters/matters-offline-banner.tsx';

export interface TemplateOption {
  id: string;
  name: string;
}

export interface MatterOption {
  id: string;
  title: string;
}

export interface CreateDraftInput {
  workspaceId: string;
  templateId: string;
  matterId: string | null;
  title: string;
}

export type CreateDraftFn = (input: CreateDraftInput) => Promise<Result<{ id: string }>>;

const SELECT_CLASS = 'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm';

export interface TemplatePickerProps {
  workspaceId: string;
  slug: string;
  templates: TemplateOption[];
  matters: MatterOption[];
  /** The matter the list is filtered to; it starts selected. */
  defaultMatterId?: string | null;
  createAction: CreateDraftFn;
  /** Open on first render (stories, `?new=1`). */
  initialOpen?: boolean;
  /** Treat the browser as offline (stories). */
  forceOffline?: boolean;
}

export function TemplatePicker({
  workspaceId,
  slug,
  templates,
  matters,
  defaultMatterId = null,
  createAction,
  initialOpen = false,
  forceOffline = false,
}: TemplatePickerProps) {
  const t = useTranslations('drafting.list');
  const router = useRouter();
  const id = useId();
  const online = useOnline() && !forceOffline;
  const [open, setOpen] = useState(initialOpen);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [matterId, setMatterId] = useState(defaultMatterId ?? '');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !online) return;
    if (title.trim() === '') {
      setTitleError(t('picker.errors.validation'));
      return;
    }
    setTitleError(undefined);
    setFormError(null);
    setPending(true);
    let result: Result<{ id: string }>;
    try {
      result = await createAction({
        workspaceId,
        templateId,
        matterId: matterId === '' ? null : matterId,
        title: title.trim(),
      });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      setOpen(false);
      router.push(`/w/${encodeURIComponent(slug)}/drafts/${result.data.id}`);
      return;
    }
    const { code } = result.error;
    if (code === 'FORBIDDEN') setFormError(t('picker.errors.forbidden'));
    else if (code === 'VALIDATION' || code === 'NOT_FOUND') {
      setFormError(t('picker.errors.validation'));
    } else setFormError(t('picker.errors.generic'));
  }

  const formId = `${id}-form`;
  const noTemplates = templates.length === 0;

  return (
    <>
      <Button
        data-drafts-action="new"
        disabled={!online}
        title={online ? undefined : t('picker.offline')}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('newDraft')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-slot="template-picker">
          <DialogHeader>
            <DialogTitle>{t('picker.title')}</DialogTitle>
            <DialogDescription>{t('picker.description')}</DialogDescription>
          </DialogHeader>
          {online ? null : (
            <Alert tone="warning" role="status">
              {t('picker.offline')}
            </Alert>
          )}
          {formError === null ? null : (
            <Alert tone="danger" role="alert">
              {formError}
            </Alert>
          )}
          <form
            noValidate
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => void onSubmit(event)}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('picker.suggested')}</legend>
              {noTemplates ? (
                <p className="text-ink-muted text-sm">{t('picker.noTemplates')}</p>
              ) : (
                templates.map((template) => (
                  <label key={template.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`${id}-template`}
                      value={template.id}
                      checked={templateId === template.id}
                      onChange={() => {
                        setTemplateId(template.id);
                      }}
                    />
                    <span>{template.name}</span>
                  </label>
                ))
              )}
            </fieldset>
            <Field label={t('picker.titleLabel')} required error={titleError}>
              <Input
                autoComplete="off"
                value={title}
                maxLength={200}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            </Field>
            <Field label={t('picker.matterLabel')}>
              <select
                className={SELECT_CLASS}
                value={matterId}
                onChange={(event) => {
                  setMatterId(event.target.value);
                }}
              >
                <option value="">{t('picker.noMatterOption')}</option>
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.title}
                  </option>
                ))}
              </select>
            </Field>
          </form>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('picker.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={!online || pending || noTemplates || templateId === ''}
            >
              {pending ? t('picker.submitting') : t('picker.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
