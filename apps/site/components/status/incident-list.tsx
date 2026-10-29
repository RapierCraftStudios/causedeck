import { Badge } from '@causedeck/ui/badge';

import { INCIDENT_STATE_LABELS, formatIst, formatUtc } from '../../lib/status/format.ts';
import type { StatusIncident } from '../../lib/status/model.ts';

function Stamp({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="text-ink-muted text-xs">
      {formatIst(iso)} / {formatUtc(iso)}
    </time>
  );
}

export function IncidentList({
  incidents,
  emptyText = 'No incidents in the last 30 days.',
}: {
  incidents: readonly StatusIncident[];
  emptyText?: string;
}) {
  if (incidents.length === 0) return <p className="text-ink-muted text-sm">{emptyText}</p>;
  return (
    <ul className="space-y-6">
      {incidents.map((incident) => (
        <li key={incident.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-ink font-semibold">{incident.title}</h3>
            <Badge tone={incident.state === 'resolved' ? 'success' : 'warning'}>
              {INCIDENT_STATE_LABELS[incident.state]}
            </Badge>
          </div>
          <p className="mt-1">
            <Stamp iso={incident.startedAt} />
          </p>
          <ul className="mt-2 space-y-2">
            {incident.updates.map((update) => (
              <li key={`${update.at}-${update.state}`} className="text-sm">
                <strong>{INCIDENT_STATE_LABELS[update.state]}.</strong> {update.body}{' '}
                <Stamp iso={update.at} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
