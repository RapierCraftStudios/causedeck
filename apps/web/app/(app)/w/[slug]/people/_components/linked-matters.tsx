'use client';
// The matters a client is linked to, as the detail page shows them (#82): each a link to the
// matter with its relation (`We represent` / `Instructs us`). Only matters the member may read
// arrive here; an empty list says so.
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export interface LinkedMatterView {
  matterId: string;
  title: string;
  relation: 'represents' | 'instructed_by';
  href: string;
}

export function LinkedMatters({ matters }: { matters: readonly LinkedMatterView[] }) {
  const t = useTranslations('people');
  return (
    <section aria-labelledby="linked-matters-title" className="flex flex-col gap-2">
      <h2 id="linked-matters-title" className="font-serif text-lg font-medium">
        {t('detail.linkedMatters')}
      </h2>
      {matters.length === 0 ? (
        <p data-linked-matters="empty" className="text-ink-muted text-sm">
          {t('detail.noMatters')}
        </p>
      ) : (
        <ul data-linked-matters="list" className="flex flex-col gap-2">
          {matters.map((m) => (
            <li
              key={`${m.matterId}-${m.relation}`}
              className="border-line flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <Link href={m.href} className="text-accent underline-offset-4 hover:underline">
                {m.title}
              </Link>
              <span className="text-ink-muted text-xs">{t(`detail.relation.${m.relation}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
