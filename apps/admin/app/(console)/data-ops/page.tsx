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

import { bulkImportOverview, dataOpsOverview, ocrQueueOverview } from '../../../lib/data/index.ts';
import { startBulkImportAction } from './actions.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Data Ops' };

const percent = (v: number | null): string => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const megabytes = (v: number): string => `${(v / 1024 ** 2).toFixed(1)} MB`;
const dollars = (v: number): string => `$${v.toFixed(4)}`;

function tierMix(w: SourceOpsWindow): string {
  const parts = Object.entries(w.tierMix).filter(([, n]) => n > 0);
  return parts.length === 0 ? '-' : parts.map(([tier, n]) => `${tier} ${String(n)}`).join(', ');
}

function Bars({
  rows,
  pick,
  label,
}: {
  rows: SourceOpsRow[];
  pick: 'fetches' | 'costDollars' | 'captchaCostDollars';
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
                title={`${d.day}: ${pick === 'fetches' ? String(d.fetches) : dollars(d.costDollars)}`}
                className="bg-ink-muted w-6 rounded-t"
                style={{
                  height: `${String(peak === 0 ? 0 : Math.max(2, (d[pick] / peak) * 100))}%`,
                }}
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
  const imports = await bulkImportOverview(staff);
  const ocr = await ocrQueueOverview(staff);
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
              <th scope="col">Conflict rate 24h / 7d</th>
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
                <td>
                  {percent(r.day.conflictRate)} / {percent(r.week.conflictRate)}
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
        <h2 className="font-medium">Bulk judgment import</h2>
        <p className="text-ink-muted text-sm">
          Off by default. Starts the open-data import for a dataset, optionally one court and a year
          range; the source must be cleared on Sources first. Counts only.
        </p>
        <form action={startBulkImportAction} className="flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1">
            Dataset
            <select name="dataset" defaultValue="sc">
              <option value="sc">Supreme Court</option>
              <option value="hc">High Courts</option>
            </select>
          </label>
          <label className="grid gap-1">
            Court (High Courts)
            <input name="court" maxLength={40} />
          </label>
          <label className="grid gap-1">
            From year
            <input name="yearFrom" inputMode="numeric" maxLength={4} />
          </label>
          <label className="grid gap-1">
            To year
            <input name="yearTo" inputMode="numeric" maxLength={4} />
          </label>
          <button type="submit" className="underline">
            Start import
          </button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Bulk import progress</caption>
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Court</th>
                <th scope="col">Year</th>
                <th scope="col">Status</th>
                <th scope="col">Rows added</th>
                <th scope="col">Duplicates skipped</th>
                <th scope="col">Failures</th>
                <th scope="col">Storage used</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={`${i.sourceId}:${i.court ?? ''}:${String(i.year)}`}>
                  <th scope="row">{i.dataset}</th>
                  <td>{i.court ?? '-'}</td>
                  <td>{i.year}</td>
                  <td>{i.status}</td>
                  <td>{i.rowsAdded}</td>
                  <td>{i.duplicatesSkipped}</td>
                  <td>{i.failures}</td>
                  <td>{megabytes(i.bytesStored)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {imports.length === 0 ? (
            <p className="text-ink-muted text-sm">No bulk import has run.</p>
          ) : null}
        </div>
        <div className="grid gap-1 text-sm">
          <h3 className="font-medium">OCR queue</h3>
          <p>
            Queue depth: {ocr.depth}. Parked failures: {ocr.parked}.
          </p>
          {ocr.failures.length > 0 ? (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Parked OCR failures</caption>
              <thead>
                <tr>
                  <th scope="col">Judgment</th>
                  <th scope="col">Page</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Last error</th>
                </tr>
              </thead>
              <tbody>
                {ocr.failures.map((f) => (
                  <tr key={`${f.judgmentId}:${String(f.pageNo)}`}>
                    <th scope="row">{f.judgmentId}</th>
                    <td>{f.pageNo}</td>
                    <td>{f.attempts}</td>
                    <td>{f.lastError ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
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
      <div className="grid gap-2">
        <h2 className="font-medium">Captcha solving cost per court per day (7 days, UTC)</h2>
        <p className="text-ink-muted text-sm">
          Paid solves only, the part of the daily cost spent on the captcha tier. Local solves cost
          nothing. Bulk solving is off until counsel clears a source.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Captcha solving cost per court per day</caption>
            <thead>
              <tr>
                <th scope="col">Court</th>
                {rows[0]?.daily.map((d) => (
                  <th key={d.day} scope="col">
                    {d.day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.daily.some((d) => d.captchaCostDollars > 0))
                .map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.id}</th>
                    {r.daily.map((d) => (
                      <td key={d.day}>{dollars(d.captchaCostDollars)}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
          {rows.every((r) => r.daily.every((d) => d.captchaCostDollars === 0)) ? (
            <p className="text-ink-muted text-sm">No captcha spend in the last 7 days.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
