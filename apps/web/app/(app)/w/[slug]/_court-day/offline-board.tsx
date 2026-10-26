'use client';
// The board rendered on the client from a payload saved on this device (#65 part 3). The online
// board is server-rendered (`court-day-board.tsx`); offline there is no server, so this is a
// compact, read-only view of the same `BoardData`: complex -> hall -> item, each item linking to its
// saved brief. Dates inside a saved payload come back as strings (the store is JSON), so none is
// used as a `Date` here.
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type { BoardData } from './load-court-day.ts';

export interface OfflineBoardProps {
  slug: string;
  board: BoardData;
  /** Epoch ms the day was saved. */
  savedAt: number;
  stale: boolean;
}

export function OfflineBoard({ slug, board, savedAt, stale }: OfflineBoardProps) {
  const t = useTranslations('offline');
  const time = new Date(savedAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' });
  const { day } = board;
  return (
    <main id="main" tabIndex={-1} data-offline-board className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-ink text-xl font-semibold">
        {t('courtDay.savedFor', { date: day.date })}
      </h1>
      <p role="status" className="text-ink-muted text-sm">
        {stale ? t('banner.stale', { time }) : t('banner.savedAt', { time })}
      </p>
      {day.complexes.map((complex) => (
        <section key={complex.forumId} aria-label={complex.name} className="space-y-3">
          <h2 className="text-ink font-medium">{complex.name}</h2>
          {complex.halls.map((hall) => (
            <div key={hall.hallId ?? hall.hallNo ?? 'hall'} className="space-y-1">
              <h3 className="text-ink-muted text-sm">{hall.hallNo ?? ''}</h3>
              <ol className="space-y-1">
                {hall.lists.flatMap((list) =>
                  list.items.map((item) => (
                    <li key={item.listingId} className="border-border rounded-md border p-2">
                      <Link href={`/w/${slug}/briefs/${item.listingId}`} className="block">
                        <span className="text-ink-muted mr-2 text-sm">{item.itemNo ?? ''}</span>
                        <span className="text-ink font-medium">{item.matterTitle}</span>
                        <span className="text-ink-muted block text-sm">
                          {item.caseLabel} · {item.stageRaw}
                        </span>
                      </Link>
                    </li>
                  )),
                )}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
