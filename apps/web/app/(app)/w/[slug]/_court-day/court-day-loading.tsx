'use client';
// Loading state of the board (#59): the skeleton has the board's geometry (header bars, three hall
// columns of four items with a number gutter and chip placeholders), so nothing shifts when the day
// arrives.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

export function CourtDayLoading() {
  const t = useTranslations('courtDay.board');
  return (
    <SkeletonGroup
      data-slot="court-day-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-4"
    >
      <div className="flex flex-col gap-2 py-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-72" />
      </div>
      <Skeleton className="h-11 w-48 rounded-full" />
      <div className="grid gap-4 md:grid-cols-2 xl:flex">
        {[0, 1, 2].map((column) => (
          <div
            key={column}
            className={`flex-col gap-2 xl:w-96 xl:shrink-0 ${column === 0 ? 'flex' : 'hidden md:flex'} ${column === 2 ? 'md:hidden xl:flex' : ''}`}
          >
            <Skeleton className="h-12 w-full" />
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="border-border flex min-h-24 items-start gap-3 rounded-md border p-3"
              >
                <Skeleton className="h-7 w-8 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-12 rounded-full" />
                  </div>
                </div>
                <Skeleton className="size-8 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
