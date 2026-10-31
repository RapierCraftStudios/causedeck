// Expected timeline card (#655, from #512, D-049, D-050): for each proceeding of the matter, the
// median time to first listing and to disposal of this workspace's own matters in the same forum
// and case type. A figure the analytics layer withheld (too few observations) reads `Not enough
// data`. It is an estimate from the workspace's own history, never a promise.
import type { MatterExpectedTimeline } from '@causedeck/intelligence';
import { useTranslations } from 'next-intl';

export interface ExpectedTimelineCardProps {
  timeline: MatterExpectedTimeline;
}

export function ExpectedTimelineCard({ timeline }: ExpectedTimelineCardProps) {
  const t = useTranslations('courtInsights');
  const court = new Map(timeline.forums.map((f) => [f.id, f.court]));
  if (timeline.timelines.length === 0) return null;
  return (
    <section
      aria-labelledby="matter-expected-timeline-title"
      data-slot="matter-expected-timeline"
      className="border-line bg-surface flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="matter-expected-timeline-title" className="text-ink-muted text-sm font-medium">
        {t('timeline.title')}
      </h2>
      <p className="text-ink-muted text-xs">{t('timeline.hint')}</p>
      <ul className="flex flex-col gap-3">
        {timeline.timelines.map((row, index) => (
          <li key={`${row.forumId}-${row.caseTypeCode}-${String(index)}`} className="text-sm">
            <p className="font-medium">
              {t('timeline.proceeding', {
                court: court.get(row.forumId) ?? row.forumId,
                caseType: row.caseTypeCode,
              })}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
              {(
                [
                  ['timeline.listingDelay', row.listingDelayDays],
                  ['timeline.disposalTime', row.disposalDays],
                ] as const
              ).map(([label, m]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-muted">{t(label)}</dt>
                  <dd>
                    {m.value === null ? (
                      <span className="text-ink-muted">{t('notEnough')}</span>
                    ) : (
                      <>
                        {t('days', { count: Math.round(m.value) })}{' '}
                        <span className="text-ink-muted">
                          ({t('timeline.basedOn', { count: m.n ?? 0 })})
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {row.byStage ? (
              <p className="text-ink-muted text-xs">{t('timeline.narrowedToStage')}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-ink-muted text-xs">{t('timeline.minimum', { min: timeline.minCell })}</p>
    </section>
  );
}
