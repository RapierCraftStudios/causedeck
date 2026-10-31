// Display helpers for the status page: IST/UTC timestamps, the 30-day strip and status labels.
import {
  INCIDENT_WINDOW_DAYS,
  type ComponentState,
  type IncidentState,
  type StatusIncident,
} from './model.ts';

const istFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const utcFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const formatIst = (iso: string): string => `${istFormat.format(new Date(iso))} IST`;
export const formatUtc = (iso: string): string => `${utcFormat.format(new Date(iso))} UTC`;

export type IconName = 'check' | 'warning' | 'cross';

export const STATE_LABELS: Record<ComponentState, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  down: 'Down',
};
export const STATE_ICONS: Record<ComponentState, IconName> = {
  operational: 'check',
  degraded: 'warning',
  down: 'cross',
};
export const OVERALL_LABELS: Record<ComponentState, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems are degraded',
  down: 'Some systems are down',
};
export const INCIDENT_STATE_LABELS: Record<IncidentState, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

export interface UptimeDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  state: ComponentState;
}

const DAY_MS = 86_400_000;
const RANK: Record<ComponentState, number> = { operational: 0, degraded: 1, down: 2 };

/** One bucket per UTC day over the incident window, oldest first, the worst incident wins. */
export function uptimeDays(incidents: readonly StatusIncident[], now: Date): UptimeDay[] {
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return Array.from({ length: INCIDENT_WINDOW_DAYS }, (_, i) => {
    const start = today - (INCIDENT_WINDOW_DAYS - 1 - i) * DAY_MS;
    const end = start + DAY_MS;
    let state: ComponentState = 'operational';
    for (const incident of incidents) {
      const from = Date.parse(incident.startedAt);
      const to = incident.resolvedAt === null ? Infinity : Date.parse(incident.resolvedAt);
      if (from < end && to >= start && RANK[incident.severity] > RANK[state]) {
        state = incident.severity;
      }
    }
    return { date: new Date(start).toISOString().slice(0, 10), state };
  });
}
