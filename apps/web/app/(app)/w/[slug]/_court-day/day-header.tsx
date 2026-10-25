import { getTranslations } from 'next-intl/server';

/** The sticky day header (#59): which day, how many items and halls, and when the lists were read. */
export async function DayHeader({
  which,
  date,
  items,
  halls,
  freshness,
  locale,
}: {
  which: 'today' | 'tomorrow';
  date: string;
  items: number;
  halls: number;
  freshness: Date | null;
  locale: string;
}) {
  const t = await getTranslations('courtDay.board.header');
  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00+05:30`));
  const read =
    freshness === null
      ? null
      : new Intl.DateTimeFormat(locale, {
          timeZone: 'Asia/Kolkata',
          hour: 'numeric',
          minute: '2-digit',
        }).format(freshness);
  return (
    <header className="bg-canvas z-sticky sticky top-0 flex flex-col gap-1 py-2">
      <h1 className="font-serif text-2xl font-medium">{t(which)}</h1>
      <p className="text-ink-muted text-sm">
        <time dateTime={date}>{formatted}</time>
        {' · '}
        {t('summary', { items, halls })}
        {read === null ? '' : ` · ${t('read', { time: read })}`}
      </p>
    </header>
  );
}
