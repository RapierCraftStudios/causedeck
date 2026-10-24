// Live halls (#493, D-048): the halls where the member has an item listed today, with the court's
// display-board state, how far the item is and the estimated call window (a range with a confidence
// level, never a promise). Hall and item numbers only: the board carries no party or case text.
import type { LiveHall } from '@causedeck/core/court-day';
import { getTranslations } from 'next-intl/server';

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});

export async function LiveHalls({ halls }: { halls: readonly LiveHall[] }) {
  if (halls.length === 0) return null;
  const t = await getTranslations('courtDay.liveHalls');
  return (
    <section data-section="live-halls" className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="font-serif text-lg font-medium">{t('title')}</h2>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <ul className="flex flex-col gap-3">
        {halls.map((hall) => (
          <li
            key={`${hall.forumCode}|${hall.hallNo}`}
            data-hall={hall.hallNo}
            className="border-border flex flex-col gap-2 rounded-md border p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{t('hall', { hallNo: hall.hallNo })}</span>
              <span className="text-ink-muted text-sm">
                {hall.status === null ? t('noItem') : t(`status.${hall.status}`)}
                {hall.itemNow === null ? '' : ` · ${t('itemNow', { item: hall.itemNow })}`}
              </span>
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {hall.items.map((item) => (
                <li key={item.listingId} data-item={item.itemNo}>
                  <span className="font-medium">{t('yourItem', { item: item.itemNo })}</span>
                  {item.itemsAway === null ? null : (
                    <span>{` · ${t('away', { count: item.itemsAway })}`}</span>
                  )}
                  {item.window === null ? null : (
                    <span className="text-ink-muted">
                      {` · ${t('window', {
                        from: timeFormat.format(item.window.from),
                        to: timeFormat.format(item.window.to),
                      })} (${t(`confidence.${item.window.confidence}`)})`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {hall.observedAt === null ? null : (
              <p className="text-ink-muted text-xs">
                {t('updated', { time: timeFormat.format(hall.observedAt) })}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
