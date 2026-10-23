// One source's Data Ops drill-down (#514): its recent `fetch_log` rows and daily series. Status,
// tier, cost and time only; the log has no URL, body or advocate here by construction.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { dataOpsFetchLogs, dataOpsOverview } from '../../../../lib/data/index.ts';
import { requireStaff } from '../../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Data Ops source' };

export default async function DataOpsSourcePage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const staff = await requireStaff('data-ops');
  const sourceId = decodeURIComponent((await params).sourceId);
  const [row] = await dataOpsOverview(staff, sourceId);
  if (row === undefined) notFound();
  const logs = await dataOpsFetchLogs(staff, sourceId);
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          {row.id}
        </h1>
        <p className="text-ink-muted text-sm">
          {row.kind}, access {row.accessMode}, {row.status}.{' '}
          <Link href="/data-ops" className="underline">
            All sources
          </Link>
        </p>
      </div>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Daily volume, errors and cost (UTC)</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Fetches</th>
            <th scope="col">Errors</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {row.daily.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.fetches}</td>
              <td>{d.errors}</td>
              <td>${d.costDollars.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Recent fetches</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Status</th>
            <th scope="col">Tier</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{l.fetchedAt.toISOString()}</td>
              <td>{l.status}</td>
              <td>{l.tier ?? '-'}</td>
              <td>${l.costDollars.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
