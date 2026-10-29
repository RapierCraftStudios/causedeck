'use client';
// The People list (#848, #82): search, kind and language filters (all in the URL, applied on the
// server), the contact cards, and the empty, filtered-empty and offline states. Shortcuts: `n`
// opens the new-contact form, `/` focuses the search, `Enter` opens the active card, `Esc` leaves
// the search or closes the form. Plain keys are ignored while typing (useHotkey).
import { Button, buttonVariants } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { useHotkey } from '@causedeck/ui/hooks';
import { Input } from '@causedeck/ui/input';
import { OfflineBanner } from '@causedeck/ui/patterns';
import { CONTACT_KINDS, LANGUAGE_PREFS } from '@causedeck/validators/client-contact';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type { ContactRowView } from '../../../../../../lib/people/people-deps.ts';
import type { Result } from '../../../../../../lib/safe-action.ts';
import {
  useOfflineSince,
  useOnline,
} from '../../../../../../components/matters/matters-offline-banner.tsx';

import { ContactCard } from './contact-card.tsx';
import { ContactForm } from './contact-form.tsx';

export interface ContactListProps {
  slug: string;
  workspaceId: string;
  contacts: readonly ContactRowView[];
  /** The URL state of the filters. */
  q: string;
  kind: string | undefined;
  language: string | undefined;
  canWrite: boolean;
  createAction: (input: unknown) => Promise<Result<{ id: string; personId: string }>>;
  /** Dev preview of the offline banner. */
  forceOffline?: boolean;
}

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;

export function ContactList({
  slug,
  workspaceId,
  contacts,
  q,
  kind,
  language,
  canWrite,
  createAction,
  forceOffline = false,
}: ContactListProps) {
  const t = useTranslations('people');
  const router = useRouter();
  const online = useOnline() && !forceOffline;
  const [formOpen, setFormOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const search = useRef<HTMLInputElement>(null);
  const filtered = q !== '' || kind !== undefined || language !== undefined;
  const base = `/w/${encodeURIComponent(slug)}/people`;

  useHotkey(
    'n',
    (event) => {
      if (event.shiftKey || !canWrite || !online || dialogOpen()) return;
      event.preventDefault();
      setFormOpen(true);
    },
    { preventDefault: false, enabled: canWrite },
  );
  useHotkey(
    '/',
    (event) => {
      if (dialogOpen()) return;
      event.preventDefault();
      search.current?.focus();
    },
    { preventDefault: false },
  );
  const move = (step: 1 | -1) => (event: KeyboardEvent) => {
    if (event.shiftKey || dialogOpen() || contacts.length === 0) return;
    event.preventDefault();
    const next = active < 0 ? (step === 1 ? 0 : contacts.length - 1) : active + step;
    const clamped = Math.min(Math.max(next, 0), contacts.length - 1);
    setActive(clamped);
    const id = contacts[clamped]?.id ?? '';
    document.querySelector<HTMLElement>(`a[data-contact-row="${id}"]`)?.focus();
  };
  useHotkey('j', move(1), { preventDefault: false });
  useHotkey('k', move(-1), { preventDefault: false });
  useHotkey(
    'enter',
    (event) => {
      const row = contacts[active];
      if (row === undefined || dialogOpen()) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('a, button, [role="button"]')) return;
      event.preventDefault();
      router.push(row.href);
    },
    { preventDefault: false },
  );
  useHotkey(
    'escape',
    () => {
      if (document.activeElement === search.current) search.current?.blur();
      setActive(-1);
    },
    { preventDefault: false },
  );

  const newButton = canWrite ? (
    <Button
      type="button"
      data-slot="new-contact"
      disabled={!online}
      title={online ? undefined : t('offline')}
      onClick={() => {
        setFormOpen(true);
      }}
    >
      {t('new.trigger')}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <OfflineNotice forced={forceOffline} />
      <form
        role="search"
        action={base}
        method="get"
        aria-label={t('search.label')}
        className="flex flex-wrap items-end gap-2"
      >
        <Input
          ref={search}
          type="search"
          name="q"
          defaultValue={q}
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          onKeyDown={(event) => {
            // useHotkey ignores plain keys while typing, so Esc leaves the field here.
            if (event.key === 'Escape') event.currentTarget.blur();
          }}
          className="max-w-sm"
        />
        <select
          name="kind"
          defaultValue={kind ?? ''}
          aria-label={t('filters.kind')}
          className="border-line-control bg-surface h-9 rounded-md border px-2 text-sm"
        >
          <option value="">{`${t('filters.kind')}: ${t('filters.all')}`}</option>
          {CONTACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
        <select
          name="language"
          defaultValue={language ?? ''}
          aria-label={t('filters.language')}
          className="border-line-control bg-surface h-9 rounded-md border px-2 text-sm"
        >
          <option value="">{`${t('filters.language')}: ${t('filters.all')}`}</option>
          {LANGUAGE_PREFS.map((l) => (
            <option key={l} value={l}>
              {t(`languages.${l}`)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          {t('search.label')}
        </Button>
        {newButton}
      </form>

      {contacts.length === 0 ? (
        filtered ? (
          <EmptyState
            data-pattern-state="empty"
            data-contacts-empty="filtered"
            icon={<Users />}
            title={t('filteredEmpty.title')}
            action={
              <Link href={base} className={buttonVariants({ variant: 'secondary' })}>
                {t('filteredEmpty.clear')}
              </Link>
            }
          />
        ) : (
          <EmptyState
            data-pattern-state="empty"
            icon={<Users />}
            title={t('empty.title')}
            description={t('empty.body')}
            action={newButton}
          />
        )
      ) : (
        <ul aria-label={t('list.label')} className="flex flex-col gap-2">
          {contacts.map((contact, index) => (
            <li key={contact.id}>
              <ContactCard contact={contact} active={index === active} />
            </li>
          ))}
        </ul>
      )}

      <ContactForm
        workspaceId={workspaceId}
        open={formOpen}
        onOpenChange={setFormOpen}
        offline={!online}
        createAction={createAction}
      />
    </div>
  );
}

/** The offline banner with People copy: the list is the last saved one. */
function OfflineNotice({ forced }: { forced: boolean }) {
  const t = useTranslations('people');
  const locale = useLocale();
  const offlineSince = useOfflineSince();
  const since = offlineSince ?? (forced ? new Date(0) : null);
  if (since === null) return null;
  return (
    <OfflineBanner
      data-contacts-offline=""
      savedAt={since}
      locale={`${locale}-IN`}
      labels={{ message: () => t('offline') }}
    />
  );
}
