// Status (#770, part 2 of #96): staff open, update and resolve the incidents shown on the public
// status page, from fixed message templates. ops and admin only (`requireStaff('status')`: anyone
// else gets the console's not-found page); the read is audited (lib/data) and every change goes
// through actions.ts, which records `incident.changed`. The loading, error and offline states live
// beside this file.
import {
  COMPONENT_IDS,
  INCIDENT_SEVERITIES,
  INCIDENT_TEMPLATES,
  type IncidentRecord,
} from '@causedeck/core/status';
import type { Metadata } from 'next';

import { incidentConsole } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';
import { createIncidentAction, updateIncidentAction } from './actions.ts';
import { OfflineBanner } from './offline-banner.tsx';

export const metadata: Metadata = { title: 'Status' };

const field = 'border-line bg-surface rounded border px-2 py-1 text-sm';
const button = 'border-line rounded border px-3 py-1 text-sm';

const templateOptions = Object.entries(INCIDENT_TEMPLATES);

function TemplateSelect({ resolvedOnly = false }: { resolvedOnly?: boolean }) {
  return (
    <select name="template" aria-label="Message template" className={field}>
      {templateOptions
        .filter(([id]) => !resolvedOnly || id !== 'resolved')
        .map(([id, t]) => (
          <option key={id} value={id}>
            {t.label}: {t.body}
          </option>
        ))}
    </select>
  );
}

function IncidentItem({ incident }: { incident: IncidentRecord }) {
  const open = incident.state !== 'resolved';
  return (
    <li className="border-line grid gap-2 rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{incident.title}</span>
        <span className="text-sm">
          {incident.component} · {incident.severity} · {incident.state}
        </span>
      </div>
      <ul className="text-ink-muted grid gap-1 text-sm">
        {incident.updates.map((u, i) => (
          <li key={i}>
            {u.createdAt.toISOString()} {u.state}: {u.body}
          </li>
        ))}
      </ul>
      {open ? (
        <form action={updateIncidentAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={incident.id} />
          <TemplateSelect />
          <input
            name="note"
            aria-label="Optional note"
            placeholder="Optional note"
            maxLength={500}
            className={field}
          />
          <button type="submit" className={button}>
            Post update
          </button>
        </form>
      ) : null}
    </li>
  );
}

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff('status');
  const incidents = await incidentConsole(staff);
  const params = await searchParams;
  const done = typeof params.done === 'string' ? params.done : null;
  const error = typeof params.error === 'string' ? params.error : null;
  const open = incidents.filter((i) => i.state !== 'resolved');
  const resolved = incidents.filter((i) => i.state === 'resolved');
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Status
        </h1>
        <p className="text-ink-muted text-sm">
          Incidents on the public status page. Messages come from fixed templates plus an optional
          note. Changes are audited and publish within a minute.
        </p>
      </div>
      <OfflineBanner />
      {done ? <p role="status">{done}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <details>
        <summary className="cursor-pointer text-sm font-medium">Open an incident</summary>
        <form action={createIncidentAction} className="grid gap-2 sm:grid-cols-3">
          <input name="title" aria-label="Title" placeholder="Title" required className={field} />
          <select name="component" aria-label="Component" className={field}>
            {COMPONENT_IDS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select name="severity" aria-label="Severity" className={field}>
            {INCIDENT_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <TemplateSelect resolvedOnly />
          <input
            name="note"
            aria-label="Optional note"
            placeholder="Optional note"
            maxLength={500}
            className={field}
          />
          <button type="submit" className={button}>
            Open incident
          </button>
        </form>
      </details>
      {incidents.length === 0 ? (
        <p className="text-ink-muted text-sm">No incidents yet.</p>
      ) : (
        <>
          <h2 className="text-base font-medium">Open</h2>
          {open.length === 0 ? (
            <p className="text-ink-muted text-sm">No open incidents.</p>
          ) : (
            <ul className="grid gap-3">
              {open.map((i) => (
                <IncidentItem key={i.id} incident={i} />
              ))}
            </ul>
          )}
          <h2 className="text-base font-medium">Resolved</h2>
          <ul className="grid gap-3">
            {resolved.map((i) => (
              <IncidentItem key={i.id} incident={i} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
