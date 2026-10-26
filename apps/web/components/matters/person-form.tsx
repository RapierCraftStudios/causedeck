'use client';
// Add or edit a person of the matter (#393, #40 part 5): name, other names (aliases, as spelled in
// orders and cause lists), who they are (PERSON_KINDS) and, for a new person, their role on this
// matter (ROLE_EDGE_KINDS). Email, phone and address appear only for clients and professional
// contacts; choosing another kind drops them, and an edit that had one sends `contact: null`.
// Nothing here searches or imports contacts: the form only writes this workspace's person through
// `upsertPersonAction`, which checks `matter.write` again. Offline, saving is off with the reason.
// `Esc` closes the dialog and focus returns to the invoker.
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
import { IconButton } from '@causedeck/ui/icon-button';
import { Input } from '@causedeck/ui/input';
import { PERSON_KINDS, ROLE_EDGE_KINDS } from '@causedeck/validators/matter-graph';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';

import type {
  PersonContactView,
  PersonKindView,
  RoleEdgeKindView,
} from '../../lib/matters/people.ts';
import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';

/** Kinds that keep contact details (CONTACT_PERSON_KINDS in the validators). */
const CONTACT_KINDS: ReadonlySet<PersonKindView> = new Set(['client', 'professional']);
const MAX_ALIASES = 20;
const SELECT_CLASS = 'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm';
const email = z.email();

export interface UpsertPersonInput {
  workspaceId: string;
  matterId: string;
  person: {
    personId?: string;
    name: string;
    aliases?: string[];
    kind: PersonKindView;
    contact?: ContactInput | null;
  };
  role?: { kind: RoleEdgeKindView };
}

export type UpsertPersonAction = (
  input: UpsertPersonInput,
) => Promise<Result<{ id: string; name: string }>>;

/** The person being edited; absent for a new one. */
export interface PersonFormInitial {
  id: string;
  name: string;
  aliases: string[];
  kind: PersonKindView;
  contact: PersonContactView | null;
}

export interface PersonFormProps {
  workspaceId: string;
  matterId: string;
  action: UpsertPersonAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person?: PersonFormInitial | undefined;
  /** The role a new person gets on the matter at first. */
  defaultRole?: RoleEdgeKindView | undefined;
  offline?: boolean;
  /** Where focus goes when the dialog closes (the invoker). */
  returnFocus?: (() => HTMLElement | null) | undefined;
}

interface Draft {
  name: string;
  aliases: string[];
  kind: PersonKindView;
  role: RoleEdgeKindView;
  email: string;
  phone: string;
  address: string;
}

function initialDraft(person: PersonFormInitial | undefined, role: RoleEdgeKindView): Draft {
  return {
    name: person?.name ?? '',
    aliases: person?.aliases ?? [],
    kind: person?.kind ?? 'party',
    role,
    email: person?.contact?.email ?? '',
    phone: person?.contact?.phone ?? '',
    address: person?.contact?.address ?? '',
  };
}

type ContactInput = { email?: string; phone?: string; address?: string };

function contactOf(draft: Draft): ContactInput | null {
  const contact = {
    ...(draft.email.trim() === '' ? {} : { email: draft.email.trim() }),
    ...(draft.phone.trim() === '' ? {} : { phone: draft.phone.trim() }),
    ...(draft.address.trim() === '' ? {} : { address: draft.address.trim() }),
  };
  return Object.keys(contact).length === 0 ? null : contact;
}

/** What the action receives: contact only for contact kinds; an edit clears a dropped one. */
export function personInput(
  draft: Draft,
  { workspaceId, matterId, person }: Pick<PersonFormProps, 'workspaceId' | 'matterId' | 'person'>,
): UpsertPersonInput {
  const aliases = draft.aliases.map((alias) => alias.trim()).filter((alias) => alias !== '');
  const contact = CONTACT_KINDS.has(draft.kind) ? contactOf(draft) : null;
  const hadContact = person?.contact != null;
  return {
    workspaceId,
    matterId,
    person: {
      ...(person === undefined ? {} : { personId: person.id }),
      name: draft.name.trim(),
      aliases,
      kind: draft.kind,
      // A new person without contact sends none; an edit sends null only to clear a stored one.
      ...(contact !== null ? { contact } : hadContact ? { contact: null } : {}),
    },
    ...(person === undefined ? { role: { kind: draft.role } } : {}),
  };
}

export function PersonForm({
  workspaceId,
  matterId,
  action,
  open,
  onOpenChange,
  person,
  defaultRole = 'represents',
  offline = false,
  returnFocus,
}: PersonFormProps) {
  const t = useTranslations('matters.workspace.people');
  const tw = useTranslations('matters.workspace');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(person, defaultRole));
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const showContact = CONTACT_KINDS.has(draft.kind);

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function close() {
    onOpenChange(false);
    setDraft(initialDraft(person, defaultRole));
    setNameError(undefined);
    setEmailError(undefined);
    setFormError(null);
  }

  async function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (pending || offline) return;
    const badName = draft.name.trim() === '';
    const badEmail =
      showContact && draft.email.trim() !== '' && !email.safeParse(draft.email.trim()).success;
    setNameError(badName ? t('form.errors.name') : undefined);
    setEmailError(badEmail ? t('form.errors.email') : undefined);
    if (badName || badEmail) return;
    setFormError(null);
    setPending(true);
    let result: Result<{ id: string; name: string }>;
    try {
      result = await action(personInput(draft, { workspaceId, matterId, person }));
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      close();
      announce(t('announceSaved', { name: result.data.name }));
      router.refresh();
      return;
    }
    const { code } = result.error;
    if (code === 'FORBIDDEN') setFormError(t('form.errors.forbidden'));
    else if (code === 'NOT_FOUND') setFormError(t('form.errors.notFound'));
    else setFormError(t('form.errors.failed'));
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
        data-slot="person-form"
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.() ?? null;
          if (target === null) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {person === undefined ? t('form.addTitle') : t('form.editTitle')}
          </DialogTitle>
          <DialogDescription>{t('form.description')}</DialogDescription>
        </DialogHeader>

        {offline ? (
          <Alert tone="warning" role="status">
            {tw('offlineAction')}
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
          <Field label={t('form.name')} required error={nameError}>
            <Input
              autoComplete="off"
              data-person-field="name"
              value={draft.name}
              maxLength={300}
              onChange={(event) => {
                update({ name: event.target.value });
              }}
            />
          </Field>

          <fieldset className="flex flex-col gap-2" data-person-field="aliases">
            <legend className="text-sm font-medium">{t('form.aliases')}</legend>
            <p className="text-ink-muted text-sm">{t('form.aliasesHint')}</p>
            {draft.aliases.map((alias, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  autoComplete="off"
                  aria-label={t('form.alias', { n: index + 1 })}
                  value={alias}
                  maxLength={300}
                  onChange={(event) => {
                    const aliases = [...draft.aliases];
                    aliases[index] = event.target.value;
                    update({ aliases });
                  }}
                />
                <IconButton
                  type="button"
                  label={t('form.removeAlias', { n: index + 1 })}
                  onClick={() => {
                    update({ aliases: draft.aliases.filter((_, i) => i !== index) });
                  }}
                >
                  <X />
                </IconButton>
              </div>
            ))}
            {draft.aliases.length < MAX_ALIASES ? (
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                data-person-add-alias=""
                onClick={() => {
                  update({ aliases: [...draft.aliases, ''] });
                }}
              >
                {t('form.addAlias')}
              </Button>
            ) : null}
          </fieldset>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('form.kind')}</span>
            <select
              data-person-field="kind"
              className={SELECT_CLASS}
              value={draft.kind}
              onChange={(event) => {
                const kind = event.target.value as PersonKindView;
                // Contact details belong only to clients and professional contacts.
                update(
                  CONTACT_KINDS.has(kind) ? { kind } : { kind, email: '', phone: '', address: '' },
                );
                setEmailError(undefined);
              }}
            >
              {PERSON_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`personKinds.${kind}`)}
                </option>
              ))}
            </select>
          </label>

          {person === undefined ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('form.role')}</span>
              <select
                data-person-field="role"
                className={SELECT_CLASS}
                value={draft.role}
                onChange={(event) => {
                  update({ role: event.target.value as RoleEdgeKindView });
                }}
              >
                {ROLE_EDGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {showContact ? (
            <fieldset className="flex flex-col gap-3" data-person-field="contact">
              <legend className="text-sm font-medium">{t('form.contactTitle')}</legend>
              <p className="text-ink-muted text-sm">{t('form.contactHint')}</p>
              <Field label={t('contact.email')} error={emailError}>
                <Input
                  type="email"
                  autoComplete="off"
                  data-person-field="email"
                  value={draft.email}
                  maxLength={320}
                  onChange={(event) => {
                    update({ email: event.target.value });
                  }}
                />
              </Field>
              <Field label={t('contact.phone')}>
                <Input
                  type="tel"
                  autoComplete="off"
                  data-person-field="phone"
                  value={draft.phone}
                  maxLength={40}
                  onChange={(event) => {
                    update({ phone: event.target.value });
                  }}
                />
              </Field>
              <Field label={t('contact.address')}>
                <Input
                  autoComplete="off"
                  data-person-field="address"
                  value={draft.address}
                  maxLength={500}
                  onChange={(event) => {
                    update({ address: event.target.value });
                  }}
                />
              </Field>
            </fieldset>
          ) : null}
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t('form.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            data-person-save=""
            loading={pending}
            disabled={pending || offline}
          >
            {t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
