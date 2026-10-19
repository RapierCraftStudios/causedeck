'use client';
// `Invite member` (#181): paste or type several addresses (each becomes a chip), pick a role on
// radio-cards with a one-line description, add an optional note, then `Send invitation`. Each sent
// address gets a toast; in dev (console or Mailpit mailer) it carries a `Copy link` action with the
// invite link, which the server returns only outside production. Addresses that fail stay as chips
// with a line saying why, so the rest can be retried.
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
import { RadioGroup, RadioGroupItem } from '@causedeck/ui/radio-group';
import { toast } from '@causedeck/ui/sonner';
import { Textarea } from '@causedeck/ui/textarea';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useId,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';
import type { Role } from '../../../../../../lib/workspace-context.ts';

import type { InviteFailure, InviteOutcome } from './actions.ts';
import { errorKeyFor, useOnline } from './role-select.tsx';

/** Matches `MAX_INVITES_PER_SEND` in actions.ts. */
export const MAX_INVITES = 20;

const SEPARATOR = /[\s,;]+/u;
// Deliberately loose: the server parses with zod `z.email()`; this only flags obvious typos.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function splitEmails(text: string): string[] {
  return text
    .split(SEPARATOR)
    .map((part) => part.trim().replace(/^<|>$/gu, '').toLowerCase())
    .filter(Boolean);
}

export function isEmail(value: string): boolean {
  return EMAIL.test(value);
}

export type InviteMembers = (input: {
  workspaceId: string;
  emails: string[];
  role: Exclude<Role, 'owner'>;
  note?: string | undefined;
}) => Promise<Result<{ results: InviteOutcome[] }>>;

export interface InviteDialogProps {
  workspace: { id: string; name: string };
  /** Roles the caller may grant, most privileged first. */
  roles: readonly Exclude<Role, 'owner'>[];
  invite: InviteMembers;
  onOpenChange: (open: boolean) => void;
}

/** Copy the invite link from a toast action; clipboard is missing outside secure contexts. */
function copy(text: string, done: () => void) {
  if (!('clipboard' in navigator)) return;
  void navigator.clipboard.writeText(text).then(done);
}

export function InviteDialog({ workspace, roles, invite, onOpenChange }: InviteDialogProps) {
  const t = useTranslations('members');
  const online = useOnline();
  const inputId = useId();
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>(
    roles.includes('junior') ? 'junior' : (roles[0] ?? 'viewer'),
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ email: string; status: InviteFailure }[]>([]);
  const [pending, setPending] = useState(false);

  function addChips(text: string) {
    const next = splitEmails(text);
    if (next.length === 0) return;
    setError(null);
    setChips((current) => [...new Set([...current, ...next])]);
  }

  function commitDraft() {
    addChips(draft);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === ' ') {
      if (draft.trim() === '') return;
      event.preventDefault();
      commitDraft();
    } else if (event.key === 'Backspace' && draft === '' && chips.length > 0) {
      setChips((current) => current.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text');
    if (!SEPARATOR.test(text.trim()) && !isEmail(text.trim())) return;
    event.preventDefault();
    addChips(`${draft} ${text}`);
    setDraft('');
  }

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const emails = [...new Set([...chips, ...splitEmails(draft)])];
    setChips(emails);
    setDraft('');
    setFailures([]);
    if (emails.length === 0) {
      setError(t('invite.errors.emailsRequired'));
      return;
    }
    if (emails.some((email) => !isEmail(email))) {
      setError(t('invite.errors.invalidEmails'));
      return;
    }
    if (emails.length > MAX_INVITES) {
      setError(t('invite.errors.tooMany', { max: MAX_INVITES }));
      return;
    }
    if (!navigator.onLine) {
      setError(t('errors.offline'));
      return;
    }
    setError(null);
    setPending(true);
    try {
      const trimmed = note.trim();
      const result = await invite({
        workspaceId: workspace.id,
        emails,
        role,
        note: trimmed === '' ? undefined : trimmed,
      });
      setPending(false);
      if (!result.ok) {
        setError(t(`errors.${errorKeyFor(result.error.code)}`));
        return;
      }
      const failed: { email: string; status: InviteFailure }[] = [];
      for (const outcome of result.data.results) {
        if (outcome.status !== 'sent') {
          failed.push({ email: outcome.email, status: outcome.status });
          continue;
        }
        const { link } = outcome;
        toast(
          t('invite.sent', { email: outcome.email }),
          link
            ? {
                action: {
                  label: t('invite.copyLink'),
                  onClick: () => {
                    copy(link, () => toast(t('invite.linkCopied')));
                  },
                },
              }
            : undefined,
        );
      }
      if (failed.length === 0) {
        onOpenChange(false);
        return;
      }
      setChips(failed.map((f) => f.email));
      setFailures(failed);
    } catch {
      setPending(false);
      setError(t('errors.generic'));
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-dialog="invite" className="max-h-[85dvh] overflow-y-auto">
        <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('invite.title')}</DialogTitle>
            <DialogDescription>
              {t('invite.description', { workspace: workspace.name })}
            </DialogDescription>
          </DialogHeader>
          <Field
            label={t('invite.emailsLabel')}
            hint={t('invite.emailsHint')}
            controlId={inputId}
            required
          >
            <div className="border-line-control focus-within:outline-ring bg-surface flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 focus-within:outline-2 focus-within:outline-offset-2">
              {chips.length > 0 ? (
                <ul className="contents" data-slot="email-chips">
                  {chips.map((email) => {
                    const valid = isEmail(email);
                    return (
                      <li
                        key={email}
                        data-chip={email}
                        data-invalid={valid ? undefined : ''}
                        className={`animate-scale-in inline-flex max-w-full items-center gap-1 rounded-sm border py-0.5 ps-2 pe-0.5 text-sm [animation-duration:var(--dur-fast)] ${
                          valid
                            ? 'border-line bg-surface-sunken text-ink'
                            : 'border-danger bg-danger-soft text-danger'
                        }`}
                      >
                        <span className="truncate">{email}</span>
                        {valid ? null : (
                          <span className="sr-only">{t('invite.invalidChip', { email })}</span>
                        )}
                        <button
                          type="button"
                          aria-label={t('invite.removeEmail', { email })}
                          className="hover:bg-line focus-visible:outline-ring inline-flex size-6 items-center justify-center rounded-sm focus-visible:outline-2"
                          onClick={() => {
                            setChips((current) => current.filter((c) => c !== email));
                          }}
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <input
                id={inputId}
                type="email"
                inputMode="email"
                autoComplete="off"
                multiple
                value={draft}
                placeholder={chips.length === 0 ? t('invite.emailsPlaceholder') : undefined}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={commitDraft}
                disabled={pending}
                className="placeholder:text-ink-subtle min-w-40 flex-1 bg-transparent py-1 text-sm outline-none"
              />
            </div>
          </Field>
          <Field label={t('invite.roleLabel')}>
            <RadioGroup
              value={role}
              onValueChange={(value) => {
                setRole(value as Exclude<Role, 'owner'>);
              }}
              disabled={pending}
              className="grid gap-2 sm:grid-cols-2"
            >
              {roles.map((value) => (
                <label
                  key={value}
                  htmlFor={`${inputId}-role-${value}`}
                  data-role-card={value}
                  className="border-line has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:bg-accent-soft/40 flex cursor-pointer items-start gap-3 rounded-md border p-3"
                >
                  <RadioGroupItem
                    id={`${inputId}-role-${value}`}
                    value={value}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{t(`roles.${value}`)}</span>
                    <span className="text-ink-muted text-xs">{t(`roleDescriptions.${value}`)}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </Field>
          <Field label={t('invite.noteLabel')} hint={t('invite.noteHint')}>
            <Textarea
              name="note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              disabled={pending}
            />
          </Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {failures.length > 0 ? (
            <Alert tone="danger">
              <ul className="space-y-1" data-slot="invite-failures">
                {failures.map((f) => (
                  <li key={f.email}>{t(`invite.errors.${f.status}`, { email: f.email })}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('invite.cancel')}
            </Button>
            <Button
              type="submit"
              loading={pending}
              disabled={!online}
              labels={{ loading: t('invite.sending') }}
            >
              {t('invite.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
