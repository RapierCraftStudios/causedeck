// The Adapters page body (#312): registry rows with a health status chip and the last-checked time.
// A server component, so it renders plain table markup: `@causedeck/ui/table` keeps its density in
// React context, which needs a client component.
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { EmptyState } from '@causedeck/ui/empty-state';
import {
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import type { AdapterHealthEntry, AdapterHealthStatus } from '../lib/adapter-health.ts';

const STATUS: Readonly<
  Record<AdapterHealthStatus, { label: string; tone: BadgeTone; Icon: LucideIcon }>
> = {
  healthy: { label: 'Healthy', tone: 'success', Icon: CircleCheck },
  degraded: { label: 'Degraded', tone: 'warning', Icon: TriangleAlert },
  down: { label: 'Down', tone: 'danger', Icon: CircleX },
  unknown: { label: 'Unknown', tone: 'neutral', Icon: CircleQuestionMark },
};

// Staff read times in India time whatever the server's zone.
const CHECKED_AT = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** A health status as an icon plus a text label, so it never relies on colour alone. */
export function AdapterStatusChip({ status }: { status: AdapterHealthStatus }) {
  const { label, tone, Icon } = STATUS[status];
  return (
    <Badge tone={tone} data-status={status}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}

function LastChecked({ at }: { at: Date | null }) {
  if (at === null) return <span className="text-ink-muted">Never checked</span>;
  return <time dateTime={at.toISOString()}>{CHECKED_AT.format(at)}</time>;
}

const HEAD = 'text-ink-muted px-3 py-2 text-left text-xs font-medium whitespace-nowrap';
const CELL = 'px-3 py-2 align-middle whitespace-nowrap';

export function AdapterHealthTable({ entries }: { entries: readonly AdapterHealthEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No adapters registered yet."
        description="Court adapters appear here once they have an access-mode registry row."
      />
    );
  }
  const neverChecked = entries.every((entry) => entry.lastCheckedAt === null);
  return (
    <div className="grid gap-3">
      {neverChecked ? (
        <p
          role="status"
          className="border-line bg-surface-raised text-ink-muted rounded-md border px-3 py-2 text-sm"
        >
          No health data yet. Adapter health collection arrives with Court Graph.
        </p>
      ) : null}
      <div className="border-line overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken">
            <tr>
              <th scope="col" className={HEAD}>
                Adapter
              </th>
              <th scope="col" className={HEAD}>
                Resource
              </th>
              <th scope="col" className={HEAD}>
                Access mode
              </th>
              <th scope="col" className={HEAD}>
                Enabled
              </th>
              <th scope="col" className={HEAD}>
                Status
              </th>
              <th scope="col" className={HEAD}>
                Last checked
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={`${entry.adapterId}/${entry.resource}`}
                data-testid="adapter-row"
                className="border-line border-t"
              >
                <th scope="row" className={`${CELL} text-left font-medium`}>
                  <code className="font-mono">{entry.adapterId}</code>
                </th>
                <td className={CELL}>{entry.resource}</td>
                <td className={CELL}>
                  <code className="font-mono">{entry.mode}</code>
                </td>
                <td className={CELL}>{entry.enabled ? 'Yes' : 'No'}</td>
                <td className={CELL}>
                  <AdapterStatusChip status={entry.status} />
                </td>
                <td className={CELL}>
                  <LastChecked at={entry.lastCheckedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
