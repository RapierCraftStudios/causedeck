// Sources (#478, D-048): every external data source CauseDeck may read, its clearance, limits and
// kill switch. ops and admin only (`requireStaff('sources')`); the read is audited (lib/data) and
// every change goes through actions.ts, which records `source.changed` with old and new values.
import {
  SOURCE_ACCESS_MODES,
  SOURCE_KINDS,
  SOURCE_MAX_TIERS,
  SOURCE_REVIEW_STATUSES,
  type SourceRecord,
} from '@causedeck/core/sources';
import type { Metadata } from 'next';

import { sourceRegistry } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';
import { saveSourceAction, setSourceKillSwitchAction } from './actions.ts';

export const metadata: Metadata = { title: 'Sources' };

const field = 'border-line bg-surface rounded border px-2 py-1 text-sm';

function Select({
  name,
  options,
  value,
}: {
  name: string;
  options: readonly string[];
  value: string;
}) {
  return (
    <select name={name} defaultValue={value} aria-label={name} className={field}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Text({
  name,
  value,
  type = 'text',
}: {
  name: string;
  value: string | number;
  type?: string;
}) {
  return <input name={name} type={type} defaultValue={value} aria-label={name} className={field} />;
}

function SourceForm({ source }: { source?: SourceRecord }) {
  return (
    <form action={saveSourceAction} className="grid gap-2 sm:grid-cols-3">
      <input type="hidden" name="mode" value={source ? 'update' : 'create'} />
      {source ? <input type="hidden" name="id" value={source.id} /> : <Text name="id" value="" />}
      <Select name="kind" options={SOURCE_KINDS} value={source?.kind ?? 'court'} />
      <Text name="baseUrl" value={source?.baseUrl ?? ''} />
      <Text name="owner" value={source?.owner ?? ''} />
      <Select name="accessMode" options={SOURCE_ACCESS_MODES} value={source?.accessMode ?? 'A0'} />
      <Select
        name="termsStatus"
        options={SOURCE_REVIEW_STATUSES}
        value={source?.termsStatus ?? 'pending'}
      />
      <Select
        name="counselStatus"
        options={SOURCE_REVIEW_STATUSES}
        value={source?.counselStatus ?? 'pending'}
      />
      <Text name="rateLimitPerMinute" type="number" value={source?.rateLimitPerMinute ?? 1} />
      <Text name="retentionDays" type="number" value={source?.retentionDays ?? 30} />
      <Text name="residency" value={source?.residency ?? 'in'} />
      <Select name="maxTier" options={SOURCE_MAX_TIERS} value={source?.maxTier ?? 'http'} />
      <Text name="maxCostDollars" type="number" value={source?.maxCostDollars ?? 0} />
      <Select
        name="killSwitch"
        options={['false', 'true']}
        value={String(source?.killSwitch ?? false)}
      />
      <Text name="notes" value={source?.notes ?? ''} />
      <button type="submit" className="border-line rounded border px-3 py-1 text-sm">
        {source ? 'Save' : 'Add source'}
      </button>
    </form>
  );
}

function status(source: SourceRecord): string {
  if (source.killSwitch) return 'Killed';
  return source.clearedAt ? 'Cleared' : 'Not cleared';
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff('sources');
  const sources = await sourceRegistry(staff);
  const params = await searchParams;
  const done = typeof params.done === 'string' ? params.done : null;
  const error = typeof params.error === 'string' ? params.error : null;
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Sources
        </h1>
        <p className="text-ink-muted text-sm">
          External data sources. A source is fetched only when terms and counsel are both cleared
          and its kill switch is off. Every change is audited with old and new values.
        </p>
      </div>
      {done ? <p role="status">{done}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul className="grid gap-3">
        {sources.map((s) => (
          <li key={s.id} className="border-line grid gap-2 rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{s.id}</span>
              <span className="text-sm">{status(s)}</span>
              <form action={setSourceKillSwitchAction}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="killSwitch" value={String(!s.killSwitch)} />
                <button type="submit" className="border-line rounded border px-3 py-1 text-sm">
                  {s.killSwitch ? 'Turn kill switch off' : 'Turn kill switch on'}
                </button>
              </form>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">Edit</summary>
              <SourceForm source={s} />
            </details>
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Add a source</summary>
        <SourceForm />
      </details>
    </section>
  );
}
