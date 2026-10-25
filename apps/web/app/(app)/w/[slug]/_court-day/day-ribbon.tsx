import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** Today / tomorrow switch (#59): two links, the current one marked. */
export async function DayRibbon({ slug, which }: { slug: string; which: 'today' | 'tomorrow' }) {
  const t = await getTranslations('courtDay.board.header');
  return (
    <nav aria-label={t('days')} className="flex gap-1">
      {(['today', 'tomorrow'] as const).map((day) => (
        <Link
          key={day}
          href={`/w/${slug}/${day}`}
          aria-current={day === which ? 'page' : undefined}
          className="border-border aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground inline-flex min-h-11 min-w-11 items-center rounded-full border px-4 text-sm"
        >
          {t(day)}
        </Link>
      ))}
    </nav>
  );
}
