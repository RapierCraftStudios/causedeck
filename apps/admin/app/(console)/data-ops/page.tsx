// Data Ops (#514, D-048/D-049): per source, whether data is flowing, fresh, correct and affordable.
// Counts, ids, status, tier, cost and time only, from `fetch_log` and the parse-yield definer
// function: no URL, document or party data. Kill switch and rate limit edits stay on Sources.
import {
  topFailingSources,
  type SourceOpsRow,
  type SourceOpsWindow,
} from '@causedeck/core/sources';
import type { Metadata } from 'next';
import Link from 'next/link';

import { dataOpsOverview } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Data Ops' };

const percent = (v: number | null): string => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const dollars = (v: number): string => `$${v.toFixed(4)}`;

function tierMix(w: SourceOpsWindow): string {
  const parts = Object.entries(w.tierMix).filter(([, n]) => n > 0);
  return parts.length === 0 ? '-' : parts.map(([tier, n]) => `${tier} ${n}`).join(', ');
}

function Bars({
  rows,
  pick,
  label,
}: {
  rows: SourceOpsRow[];
  pick: 'fetches' | 'costDollars';
  label: string;
}) {
  const peak = Math.max(0, ...rows.flatMap((r) => r.daily.map((d) => d[pick])));
  return (
    <ul aria-label={label} className="grid gap-2">
      {rows.map((r) => (
        <li key={r.id} className="grid gap-1">
          <span className="text-sm">{r.id}</span>
          <div className="flex h-8 items-end gap-1">
            {r.daily.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${pick === 'fetches' ? d.fetches : dollars(d.costDollars)}`}
                className="bg-ink-muted w-6 rounded-t"
                style={{ height: `${peak === 0 ? 0 : Math.max(2, (d[pick] / peak) * 100)}%` }}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function DataOpsPage() {
  const staff = await requireStaff('data-ops');
  const rows = await dataOpsOverview(staff);
  const failing = topFailingSources(rows);
  return (
    <section aria-labelledby="page-title" className="grid gap-6">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Data Ops
        </h1>
        <p className="text-ink-muted text-sm">
          Source health over the last 24 hours and 7 days. Counts, status, tier and cost only,
          nothing that identifies a lookup. Edit a source&apos;s kill switch or rate limit on{' '}
          <Link href="/sources" className="underline">
            Sources
          </Link>
          . Conflict rate arrives with cross-checked facts (#499).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Source health</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Kind</th>
              <th scope="col">Access</th>
              <th scope="col">Status</th>
              <th scope="col">Last success</th>
              <th scope="col">Freshness (SLA)</th>
              <th scope="col">Fetches 24h / 7d</th>
              <th scope="col">Error rate 24h / 7d</th>
              <th scope="col">Parse yield 24h / 7d</th>
              <th scope="col">Captcha solve rate 7d</th>
              <th scope="col">Tier mix 7d</th>
              <th scope="col">Cost 24h / 7d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <Link href={`/data-ops/${encodeURIComponent(r.id)}`} className="underline">
                    {r.id}
                  </Link>
                </th>
                <td>{r.kind}</td>
                <td>{r.accessMode}</td>
                <td>{r.status}</td>
                <td>{r.lastSuccessAt ? r.lastSuccessAt.toISOString() : 'never'}</td>
                <td>
                  {r.freshnessHours === null ? 'never' : `${r.freshnessHours.toFixed(1)}h`} (
                  {r.slaHours}h) {r.fresh ? 'fresh' : 'stale'}
                </td>
                <td>
                  {r.day.fetches} / {r.week.fetches}
                </td>
                <td>
                  {percent(r.day.errorRate)} / {percent(r.week.errorRate)}
                </td>
                <td>
                  {percent(r.day.parseYield)} / {percent(r.week.parseYield)}
                </td>
                <td>{percent(r.week.captchaSolveRate)}</td>
                <td>{tierMix(r.week)}</td>
                <td>
                  {dollars(r.day.costDollars)} / {dollars(r.week.costDollars)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2">
        <h2 className="font-medium">Top failing sources (24h)</h2>
        {failing.length === 0 ? (
          <p className="text-ink-muted text-sm">No failing sources.</p>
        ) : (
          <ol className="text-sm">
            {failing.map((r) => (
              <li key={r.id}>
                {r.id}: {r.day.errors} errors of {r.day.fetches} fetches
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="grid gap-2">
        <h2 className="font-medium">Daily volume per source and court (7 days, UTC)</h2>
        <Bars rows={rows} pick="fetches" label="Daily fetches" />
      </div>
      <div className="grid gap-2">
        <h2 className="font-medium">Daily cost per source and court (7 days, UTC)</h2>
        <Bars rows={rows} pick="costDollars" label="Daily cost" />
      </div>
    </section>
  );
}
