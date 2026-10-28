import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';

/** Skeleton mirroring the month grid: toolbar, weekday header and six rows of seven cells. */
export default function CalendarLoading() {
  const t = useTranslations('calendarView');
  return (
    <SkeletonGroup
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-4"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 42 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </SkeletonGroup>
  );
}
