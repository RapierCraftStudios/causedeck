// `/w/[slug]/people/[id]` (#848, #82 part 2): one client contact: phone, email (hidden for a
// clerk), language and kind, the matters the client is linked to (only those the member may
// read), and the read-only log of changes to the contact's details (withheld from a clerk).
// Another workspace's contact, a malformed id and one the role cannot see are all not-found.
//
// States: loading (skeleton), error (`error.tsx`), not-found and permission-denied. In
// development `?__state=loading|error|denied` previews them.
import { Badge } from '@causedeck/ui/badge';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import { loadContactDetail, toContactRowView } from '../../../../../../lib/people/people-deps.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { LinkedMatters } from '../_components/linked-matters.tsx';

import ContactLoading from './loading.tsx';

interface ContactPageProps {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('metaTitle') };
}

export default async function ContactPage({ params, searchParams }: ContactPageProps) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const raw = query.__state;
  const preview = isDev() ? (Array.isArray(raw) ? raw[0] : raw) : undefined;
  if (preview === 'loading') return <ContactLoading />;
  if (preview === 'error') throw new Error('Contact error state (dev toggle)');
  if (preview === 'denied') return <PermissionDeniedPage />;

  const load = await loadContactDetail(context, id);
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'not-found') notFound();
  if (load.kind === 'error') throw new Error('Could not load the contact');

  const { contact, matters, log } = load.detail;
  const row = toContactRowView(contact, slug);
  const t = await getTranslations('people');
  const format = await getFormatter();
  const base = `/w/${encodeURIComponent(slug)}`;

  return (
    <div data-route="people-detail" className="flex flex-col gap-6">
      <Link
        href={`${base}/people`}
        className="text-accent text-sm underline-offset-4 hover:underline"
      >
        {t('detail.back')}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-medium">{contact.personName}</h1>
        {contact.archivedAt === null ? null : <Badge tone="outline">{t('list.archived')}</Badge>}
      </header>

      <section aria-labelledby="contact-details-title" className="flex flex-col gap-2">
        <h2 id="contact-details-title" className="font-serif text-lg font-medium">
          {t('detail.details')}
        </h2>
        {contact.redacted ? <p className="text-ink-muted text-sm">{t('list.redacted')}</p> : null}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {contact.redacted ? null : (
            <>
              <dt className="text-ink-muted">{t('detail.phone')}</dt>
              <dd>{contact.phone ?? '—'}</dd>
              <dt className="text-ink-muted">{t('detail.email')}</dt>
              <dd>{contact.email ?? '—'}</dd>
            </>
          )}
          <dt className="text-ink-muted">{t('detail.language')}</dt>
          <dd data-contact-language={row.languagePref}>{t(`languages.${row.languagePref}`)}</dd>
          <dt className="text-ink-muted">{t('detail.kind')}</dt>
          <dd>{t(`kinds.${row.kind}`)}</dd>
        </dl>
      </section>

      <LinkedMatters
        matters={matters.map((m) => ({
          ...m,
          href: `${base}/matters/${m.matterId}`,
        }))}
      />

      {contact.redacted ? null : (
        <section aria-labelledby="contact-log-title" className="flex flex-col gap-2">
          <h2 id="contact-log-title" className="font-serif text-lg font-medium">
            {t('detail.log.title')}
          </h2>
          <p className="text-ink-muted text-sm">{t('detail.log.readOnly')}</p>
          {log.length === 0 ? (
            <p data-contact-log="empty" className="text-ink-muted text-sm">
              {t('detail.log.empty')}
            </p>
          ) : (
            <ul data-contact-log="list" className="flex flex-col gap-2">
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className="border-line flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span>
                    {entry.summary}
                    {entry.undone ? ` (${t('detail.log.undone')})` : ''}
                  </span>
                  <time dateTime={entry.createdAt.toISOString()} className="text-ink-muted text-xs">
                    {format.dateTime(entry.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
