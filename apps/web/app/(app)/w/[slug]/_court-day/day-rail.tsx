// The day rail (#59): the aggregated carry list (items listed before for the same proceeding) and
// what needs the member (proposed items to confirm). At 1280 px it is a right rail; below that a
// bottom drawer (`<details>`, no script).
import type { CourtDay, CourtDayItem } from '@causedeck/validators';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function DayRail({ day, slug }: { day: CourtDay; slug: string }) {
  const t = await getTranslations('courtDay.board.rail');
  const items: CourtDayItem[] = day.complexes.flatMap((c) =>
    c.halls.flatMap((h) => h.lists.flatMap((l) => l.items)),
  );
  const carried = items.filter((i) => i.carryCount > 0);
  const needs = items.filter((i) => i.confirmationState === 'proposed');
  const body = (
    <div className="flex flex-col gap-4 text-sm">
      <section data-carry-list tabIndex={-1} aria-labelledby="carry-heading">
        <h2 id="carry-heading" className="font-serif text-base">
          {t('carry')}
        </h2>
        {carried.length === 0 ? (
          <p className="text-ink-muted">{t('carryEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {carried.map((i) => (
              <li key={i.listingId}>
                <Link href={`/w/${slug}/matters/${i.matterId}`} className="hover:underline">
                  {i.caseLabel}
                </Link>{' '}
                <span className="text-ink-muted">{t('carriedTimes', { count: i.carryCount })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="needs-heading">
        <h2 id="needs-heading" className="font-serif text-base">
          {t('needsYou')}
        </h2>
        {needs.length === 0 ? (
          <p className="text-ink-muted">{t('needsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {needs.map((i) => (
              <li key={i.listingId}>
                <Link href={`/w/${slug}/matters/${i.matterId}`} className="hover:underline">
                  {i.caseLabel}
                </Link>{' '}
                <span className="text-ink-muted">{t('toConfirm')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
  return (
    <>
      <details className="border-border bg-surface z-sticky sticky bottom-0 rounded-t-md border p-3 md:block xl:hidden">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          {t('summary', { carry: carried.length, needs: needs.length })}
        </summary>
        {body}
      </details>
      <aside className="hidden xl:sticky xl:top-20 xl:block xl:w-72 xl:shrink-0 xl:self-start">
        {body}
      </aside>
    </>
  );
}
