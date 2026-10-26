// Kind legend and the shared entry marks (#66): every kind has an icon, a text label and a tone, so
// colour is never the only cue. A proposed entry is dashed and says "Proposed" in text.
import type { CalendarEntry } from '@causedeck/validators';
import { CalendarClock, ClipboardCheck, Flag, Gavel, Sun, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

export const KIND_STYLE: Record<CalendarEntry['kind'], { icon: LucideIcon; tone: string }> = {
  listing: { icon: Gavel, tone: 'border-seal text-ink' },
  next_date: { icon: CalendarClock, tone: 'border-accent-soft text-ink' },
  obligation_due: { icon: ClipboardCheck, tone: 'border-warning text-ink' },
  holiday: { icon: Flag, tone: 'border-line text-ink-muted' },
  vacation: { icon: Sun, tone: 'border-line text-ink-muted' },
};

export function KindBadge({
  kind,
  proposed = false,
}: {
  kind: CalendarEntry['kind'];
  proposed?: boolean;
}) {
  const t = useTranslations('calendarView');
  const { icon: Icon, tone } = KIND_STYLE[kind];
  return (
    <span
      data-kind={kind}
      data-proposed={proposed ? 'true' : undefined}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs ${tone} ${
        proposed ? 'border-dashed' : ''
      }`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{t(`kind.${kind}`)}</span>
      {proposed ? <span>{`· ${t('proposed')}`}</span> : null}
    </span>
  );
}

export function Legend() {
  const t = useTranslations('calendarView');
  return (
    <section aria-label={t('legend.title')} data-section="legend" className="flex flex-col gap-2">
      <h2 className="text-ink-muted text-xs font-medium">{t('legend.title')}</h2>
      <ul className="flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_STYLE) as CalendarEntry['kind'][]).map((kind) => (
          <li key={kind}>
            <KindBadge kind={kind} />
          </li>
        ))}
        <li>
          <span
            data-legend="proposed"
            className="text-ink-muted border-line rounded-sm border border-dashed px-1.5 py-0.5 text-xs"
          >
            {t('legend.proposed')}
          </span>
        </li>
        <li>
          <span data-legend="clash" className="text-ink-muted text-xs">
            {`⚠ ${t('legend.clash')}`}
          </span>
        </li>
      </ul>
    </section>
  );
}
