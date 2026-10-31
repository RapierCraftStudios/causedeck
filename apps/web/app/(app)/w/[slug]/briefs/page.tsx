// `/w/[slug]/briefs`: the index of preparation briefs. A brief is derived per listing (the Brief
// Sheet at `/briefs/[listing-id]`), so this page lists the listings of today and the next two court
// days, each linking to its brief. Members who cannot see the whole workspace get their own items
// (the court-day read scopes them). An empty window points at the calendar.
import { EmptyState } from '@causedeck/ui/empty-state';
import type { CourtDay } from '@causedeck/validators';
import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SurfaceHelp } from '../../../../../components/help/surface-help.tsx';
import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { ShellOfflineBanner } from '../../../../../components/shell/offline-banner.tsx';
import type { WorkspacePageProps } from '../../../../../components/shell/placeholder-page.tsx';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { istDate } from '../_court-day/load-court-day.ts';

const DAYS = [
  { offset: 0, key: 'today' },
  { offset: 1, key: 'tomorrow' },
  { offset: 2, key: 'dayAfter' },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('brief.index');
  return { title: t('title') };
}

function itemsOf(day: CourtDay) {
  return day.complexes.flatMap((complex) =>
    complex.halls.flatMap((hall) =>
      hall.lists.flatMap((list) =>
        list.items.map((item) => ({ forum: complex.name, hallNo: hall.hallNo, item })),
      ),
    ),
  );
}

export default async function BriefsPage({ params }: WorkspacePageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('brief.index');
  if (!can(context.role, 'listing.read')) return <PermissionDeniedPage />;

  const { db } = await import('@causedeck/core/runtime');
  const { getCourtDay } = await import('@causedeck/core/court-day');
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };
  const scope = can(context.role, 'court_day.view_all') ? 'workspace' : 'mine';
  const now = new Date();
  const days = await Promise.all(
    DAYS.map(async ({ offset, key }) => {
      const date = istDate(now, offset);
      const day = await getCourtDay({ db }, actor, { date, scope });
      return { key, date, items: itemsOf(day) };
    }),
  );
  const none = days.every((d) => d.items.length === 0);

  return (
    <div data-route="briefs" className="flex flex-col gap-6">
      <SurfaceHelp slug={slug} surface="briefs" />
      <ShellOfflineBanner />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {none ? (
        <EmptyState
          data-pattern-state="empty"
          icon={<BookOpen />}
          title={t('allEmpty')}
          description={t('allEmptyHint')}
          action={
            <Link
              href={`/w/${encodeURIComponent(slug)}/calendar`}
              className="text-accent text-sm font-medium underline"
            >
              {t('openCalendar')}
            </Link>
          }
        />
      ) : (
        days.map((day) => (
          <section
            key={day.key}
            aria-labelledby={`briefs-${day.key}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`briefs-${day.key}`} className="text-sm font-medium">
              {t(day.key)} <span className="text-ink-muted font-normal">{day.date}</span>
            </h2>
            {day.items.length === 0 ? (
              <p className="text-ink-muted text-sm">{t('noListings')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {day.items.map(({ forum, hallNo, item }) => (
                  <li key={item.listingId} className="border-border rounded-md border">
                    <Link
                      href={`/w/${encodeURIComponent(slug)}/briefs/${item.listingId}`}
                      className="flex min-h-11 flex-col gap-0.5 p-3"
                    >
                      <span className="font-medium">{item.matterTitle}</span>
                      <span className="text-ink-muted text-sm">
                        {item.caseLabel} · {item.stageRaw}
                      </span>
                      <span className="text-ink-muted text-xs">
                        {[
                          forum,
                          hallNo ? t('hallLabel', { hall: hallNo }) : null,
                          item.itemNo ? t('itemLabel', { item: item.itemNo }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
