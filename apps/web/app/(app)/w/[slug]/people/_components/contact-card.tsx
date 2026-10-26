'use client';
// One contact in the list (#82): the client's name (the whole card is one link to the detail
// page), kind, language, phone and email (hidden for a clerk), the linked matter count and the
// `Not linked` flag. Status never relies on colour alone: every flag carries its word.
import { Badge } from '@causedeck/ui/badge';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { ContactRowView } from '../../../../../../lib/people/people-deps.ts';

export interface ContactCardProps {
  contact: ContactRowView;
  active?: boolean;
}

export function ContactCard({ contact, active = false }: ContactCardProps) {
  const t = useTranslations('people');
  return (
    <Link
      href={contact.href}
      data-contact-row={contact.id}
      data-active={active ? '' : undefined}
      aria-label={t('list.open', { name: contact.personName })}
      className="border-line hover:bg-surface-muted focus-visible:ring-accent flex flex-col gap-2 rounded-md border p-4 focus-visible:ring-2 data-[active]:ring-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-serif text-base font-medium">{contact.personName}</span>
        <span className="flex flex-wrap gap-1.5">
          <Badge tone="outline">{t(`kinds.${contact.kind}`)}</Badge>
          <Badge tone="outline">{t(`languages.${contact.languagePref}`)}</Badge>
          {contact.archived ? <Badge tone="outline">{t('list.archived')}</Badge> : null}
        </span>
      </div>
      <p className="text-ink-muted text-sm">
        {contact.redacted
          ? t('list.redacted')
          : [contact.phone, contact.email].filter(Boolean).join(' · ') || t('list.noDetails')}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span data-contact-linked="">{t('list.linked', { count: contact.linkedCount })}</span>
        {contact.unlinked ? (
          <Badge tone="warning" data-contact-unlinked="" title={t('list.unlinkedHint')}>
            {t('list.unlinked')}
          </Badge>
        ) : null}
      </p>
    </Link>
  );
}
