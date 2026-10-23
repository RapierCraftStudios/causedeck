// `/w/[slug]/news` (#481): legal news from cleared sources and the member's digest preferences.
// Each item is the feed's own headline and excerpt: the title links to the original article, the
// publisher is shown as attribution, and items tagged to the member's practice areas and forums
// come first. Read on the workspace-scoped transaction for the signed-in member only.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { saveNewsPreferencesAction } from './actions.ts';
import { NewsPrefsForm } from './news-prefs-form.tsx';

interface NewsPageProps {
  params: Promise<{ slug: string }>;
}

const WINDOW_DAYS = 14;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.news');
  return { title: t('metaTitle') };
}

export default async function NewsPage({ params }: NewsPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('notifications.news');
  const workspaceId = context.workspace.id;
  const userId = context.user.id;
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const {
    DEFAULT_NEWS_DIGEST_TIME,
    NEWS_FORUMS,
    NEWS_PRACTICE_AREAS,
    getNewsPref,
    listNewsForMember,
  } = await import('@causedeck/core/news');
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { items, pref } = await inWorkspace({ workspaceId, userId }, async (tx) => ({
    items: await listNewsForMember({ db: tx, workspaceId }, { userId, since }),
    pref: await getNewsPref({ db: tx, workspaceId }, { userId }),
  }));

  return (
    <div data-route="news" className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {items.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline-offset-2 hover:underline"
              >
                {item.title}
              </a>
              {item.excerpt === null ? null : <p className="text-sm">{item.excerpt}</p>}
              <p className="text-ink-muted text-xs">
                {t('source', { source: item.sourceName })} ·{' '}
                <time dateTime={item.publishedAt.toISOString()}>
                  {item.publishedAt.toISOString().slice(0, 10)}
                </time>
                {item.matched ? ` · ${t('matched')}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <NewsPrefsForm
        workspaceId={workspaceId}
        areas={NEWS_PRACTICE_AREAS}
        forums={NEWS_FORUMS}
        initial={{
          practiceAreas: pref?.practiceAreas ?? [],
          forums: pref?.forums ?? [],
          digestTime: pref?.digestTime ?? DEFAULT_NEWS_DIGEST_TIME,
        }}
        save={saveNewsPreferencesAction}
      />
    </div>
  );
}
