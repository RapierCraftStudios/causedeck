'use client';
// New matter (#388): a title, an optional practice area and the sensitive flag with what it means.
// Loaded in its own chunk on first open (matters-list.tsx), so Radix Dialog, Checkbox and the
// toaster stay out of the list route's JS. The server action (`createMatterAction`) checks
// `matter.write` again; viewers and clerks never see the entry points. On success the dialog
// closes, a toast confirms and the list refreshes. Offline, submitting is off with the reason.
// `Esc` closes it and focus returns to whatever opened it (the button, or the page for `n`).
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
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
import { toast } from '@causedeck/ui/sonner';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';

export interface NewMatterInput {
  workspaceId: string;
  title: string;
  practiceArea?: string;
  sensitive?: boolean;
}

export type CreateMatterAction = (
  input: NewMatterInput,
) => Promise<Result<{ id: string; title: string }>>;

/** One stored party that a name on the new matter matches (#500). */
export interface ConflictHit {
  checked: string;
  side: 'client' | 'adverse';
  matterId: string;
  matterTitle: string;
  matchedName: string;
  source: 'name' | 'alias';
  existingRole: 'client' | 'adverse';
}

export type CheckConflictsAction = (input: {
  workspaceId: string;
  parties: { name: string; side: 'client' | 'adverse' }[];
}) => Promise<Result<ConflictHit[]>>;

export interface NewMatterDialogProps {
  workspaceId: string;
  action: CreateMatterAction;
  /** The conflict check (#500): given only while the legal-gated flag is on, else the section is hidden. */
  checkConflictsAction?: CheckConflictsAction | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offline: the form shows why and cannot be submitted. */
  offline?: boolean;
  /** Where focus goes when the dialog closes (the invoker). */
  returnFocus?: (() => HTMLElement | null) | undefined;
}

export function NewMatterDialog({
  workspaceId,
  action,
  checkConflictsAction,
  open,
  onOpenChange,
  offline = false,
  returnFocus,
}: NewMatterDialogProps) {
  const t = useTranslations('matters.new');
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState('');
  const [practiceArea, setPracticeArea] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [clientName, setClientName] = useState('');
  const [adverseName, setAdverseName] = useState('');
  const [hits, setHits] = useState<ConflictHit[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [conflictError, setConflictError] = useState(false);

  /** Advisory only: the result never blocks creating the matter. */
  async function onCheckConflicts() {
    if (checkConflictsAction === undefined || checking || offline) return;
    const parties = [
      { name: clientName.trim(), side: 'client' as const },
      { name: adverseName.trim(), side: 'adverse' as const },
    ].filter((party) => party.name !== '');
    if (parties.length === 0) return;
    setChecking(true);
    setConflictError(false);
    let result: Result<ConflictHit[]>;
    try {
      result = await checkConflictsAction({ workspaceId, parties });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setChecking(false);
    if (result.ok) setHits(result.data);
    else {
      setHits(null);
      setConflictError(true);
    }
  }

  function reset() {
    setClientName('');
    setAdverseName('');
    setHits(null);
    setConflictError(false);
    setTitle('');
    setPracticeArea('');
    setSensitive(false);
    setTitleError(undefined);
    setFormError(null);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  async function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (pending || offline) return;
    if (title.trim() === '') {
      setTitleError(t('errors.required'));
      return;
    }
    setTitleError(undefined);
    setFormError(null);
    setPending(true);
    let result: Result<{ id: string; title: string }>;
    try {
      result = await action({
        workspaceId,
        title: title.trim(),
        ...(practiceArea.trim() === '' ? {} : { practiceArea: practiceArea.trim() }),
        ...(sensitive ? { sensitive: true } : {}),
      });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      close();
      toast(t('created', { title: result.data.title }));
      router.refresh();
      return;
    }
    const { code, fieldErrors } = result.error;
    if (code === 'VALIDATION' && fieldErrors?.title) setTitleError(t('errors.required'));
    else if (code === 'FORBIDDEN') setFormError(t('errors.forbidden'));
    else setFormError(t('errors.failed'));
  }

  const formId = `${id}-form`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        data-slot="new-matter-dialog"
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.() ?? null;
          if (target === null) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {offline ? (
          <Alert tone="warning" role="status">
            {t('errors.offline')}
          </Alert>
        ) : null}
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
          <Field label={t('titleLabel')} hint={t('titleHint')} required error={titleError}>
            <Input
              autoComplete="off"
              value={title}
              maxLength={500}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </Field>
          <Field label={t('practiceArea')}>
            <Input
              autoComplete="off"
              value={practiceArea}
              maxLength={200}
              onChange={(event) => {
                setPracticeArea(event.target.value);
              }}
            />
          </Field>
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${id}-sensitive`}
              aria-describedby={`${id}-sensitive-hint`}
              checked={sensitive}
              onCheckedChange={(checked) => {
                setSensitive(checked === true);
              }}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-sensitive`} className="text-sm font-medium">
                {t('sensitive')}
              </label>
              <p id={`${id}-sensitive-hint`} className="text-ink-muted text-sm">
                {t('sensitiveHint')}
              </p>
            </div>
          </div>
          {checkConflictsAction === undefined ? null : (
            <section
              aria-labelledby={`${id}-conflicts`}
              data-slot="conflict-check"
              className="flex flex-col gap-3"
            >
              <h3 id={`${id}-conflicts`} className="text-sm font-medium">
                {t('conflicts.heading')}
              </h3>
              <p className="text-ink-muted text-sm">{t('conflicts.hint')}</p>
              <Field label={t('conflicts.clientLabel')}>
                <Input
                  autoComplete="off"
                  value={clientName}
                  maxLength={300}
                  onChange={(event) => {
                    setClientName(event.target.value);
                    setHits(null);
                  }}
                />
              </Field>
              <Field label={t('conflicts.adverseLabel')}>
                <Input
                  autoComplete="off"
                  value={adverseName}
                  maxLength={300}
                  onChange={(event) => {
                    setAdverseName(event.target.value);
                    setHits(null);
                  }}
                />
              </Field>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  loading={checking}
                  disabled={
                    checking || offline || (clientName.trim() === '' && adverseName.trim() === '')
                  }
                  onClick={() => void onCheckConflicts()}
                >
                  {t('conflicts.check')}
                </Button>
              </div>
              {conflictError ? (
                <Alert tone="danger" role="alert">
                  {t('conflicts.failed')}
                </Alert>
              ) : null}
              {hits === null ? null : hits.length === 0 ? (
                <p role="status" className="text-ink-muted text-sm">
                  {t('conflicts.none')}
                </p>
              ) : (
                <ul role="status" className="flex flex-col gap-2 text-sm">
                  {hits.map((hit) => (
                    <li key={`${hit.side}-${hit.checked}-${hit.matterId}`}>
                      <Alert tone="warning">
                        {t('conflicts.hit', {
                          checked: hit.checked,
                          matched: hit.matchedName,
                          source: hit.source,
                          matter: hit.matterTitle,
                          role: hit.existingRole,
                        })}
                      </Alert>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={pending || offline}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
