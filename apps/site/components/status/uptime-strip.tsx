import {
  INCIDENT_WINDOW_DAYS,
  type ComponentState,
  type StatusIncident,
} from '../../lib/status/model.ts';
import { STATE_LABELS, uptimeDays } from '../../lib/status/format.ts';

const BAR: Record<ComponentState, string> = {
  operational: 'bg-success h-6',
  degraded: 'bg-warning h-4',
  down: 'bg-danger h-2',
};

/** 30 daily buckets; height and the text list carry the state, not colour alone. */
export function UptimeStrip({
  incidents,
  now,
}: {
  incidents: readonly StatusIncident[];
  now: Date;
}) {
  const days = uptimeDays(incidents, now);
  return (
    <section aria-labelledby="uptime-heading">
      <h2 id="uptime-heading" className="text-ink text-base font-semibold">
        Last {INCIDENT_WINDOW_DAYS} days
      </h2>
      <div aria-hidden="true" className="mt-3 flex h-6 items-end gap-0.5">
        {days.map((day) => (
          <span key={day.date} className={`w-full rounded-sm ${BAR[day.state]}`} />
        ))}
      </div>
      <ul className="sr-only">
        {days.map((day) => (
          <li key={day.date}>
            {day.date}: {STATE_LABELS[day.state]}
          </li>
        ))}
      </ul>
    </section>
  );
}
