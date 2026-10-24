// Coverage (#517, D-049): every forum of the catalogue against every data type, with the access
// level, freshness and volume of each cell, filterable by state, and the gap list ranked by live
// demand (watches and users) times the levels missing. Ids, levels, counts and times only: no
// source URL, document, party or user data (watch demand comes from a staff-only definer function).
import {
  COVERAGE_DATA_TYPES,
  type CoverageCell,
  type CoverageGap,
  type ForumCoverage,
} from '@causedeck/core/sources';
import type { Metadata } from 'next';
import Link from 'next/link';

import { coverageOverview } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Coverage' };

const GAP_LIMIT = 25;

const freshness = (at: Date | null): string => (at === null ? '-' : at.toISOString().slice(0, 16));

function Cell({ cell }: { cell: CoverageCell }) {
  return (
    <td className="px-2 py-1" data-level={cell.level}>
      <span className="font-medium">{cell.level}</span>
      <span className="text-ink-muted block text-xs">
        {freshness(cell.lastFetchedAt)} · {String(cell.volume7d)}
      </span>
    </td>
  );
}

function Matrix({ rows }: { rows: ForumCoverage[] }) {
  const byState = new Map<string, Map<string, ForumCoverage[]>>();
  for (const row of rows) {
    const kinds = byState.get(row.state) ?? new Map<string, ForumCoverage[]>();
    kinds.set(row.forum.jurisdictionKind, [...(kinds.get(row.forum.jurisdictionKind) ?? []), row]);
    byState.set(row.state, kinds);
  }
  return (
    <div className="grid gap-6">
      {[...byState.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([state, kinds]) => (
          <section key={state} aria-label={`State ${state}`} className="grid gap-2">
            <h2 className="text-base font-semibold">{state.toUpperCase()}</h2>
            {[...kinds.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([kind, forums]) => (
                <div key={kind} className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="text-ink-muted text-left text-xs">{kind}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="px-2 py-1">
                          Forum
                        </th>
                        {COVERAGE_DATA_TYPES.map((t) => (
                          <th key={t} scope="col" className="px-2 py-1">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {forums.map((f) => (
                        <tr key={f.forum.code} data-forum={f.forum.code}>
                          <th scope="row" className="px-2 py-1 font-normal">
                            {f.forum.code}
                          </th>
                          {COVERAGE_DATA_TYPES.map((t) => (
                            <Cell key={t} cell={f.cells[t]} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </section>
        ))}
    </div>
  );
}

function Gaps({ gaps }: { gaps: CoverageGap[] }) {
  return (
    <ol aria-label="Gap list" className="grid gap-1 text-sm">
      {gaps.map((g) => (
        <li key={`${g.forumCode}:${g.dataType}`}>
          {g.forumCode} · {g.dataType} · {g.level} · {String(g.watches)} watches ·{' '}
          {String(g.users)} users · score {String(g.score)}
        </li>
      ))}
    </ol>
  );
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const staff = await requireStaff('coverage');
  const { state } = await searchParams;
  const { coverage, gaps, changes } = await coverageOverview(staff);
  const states = [...new Set(coverage.map((r) => r.state))].sort();
  const shown = state === undefined ? coverage : coverage.filter((r) => r.state === state);
  const shownCodes = new Set(shown.map((r) => r.forum.code));
  const shownGaps = gaps.filter((g) => shownCodes.has(g.forumCode)).slice(0, GAP_LIMIT);
  return (
    <section aria-labelledby="page-title" className="grid gap-6">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Coverage
        </h1>
        <p className="text-ink-muted text-sm">
          Level (none, A0 to A3), last successful fetch and fetches in 7 days, per forum and data
          type. A level counts only from a cleared source with the kill switch off.{' '}
          {String(changes.length)} level change(s) in the last 7 days.
        </p>
        <nav aria-label="State filter" className="flex flex-wrap gap-2 text-sm">
          <Link href="/coverage" className="underline">
            All
          </Link>
          {states.map((s) => (
            <Link key={s} href={`/coverage?state=${s}`} className="underline">
              {s}
            </Link>
          ))}
        </nav>
      </div>
      <Matrix rows={shown} />
      <section aria-labelledby="gaps-title" className="grid gap-2">
        <h2 id="gaps-title" className="text-base font-semibold">
          Gaps by demand
        </h2>
        <Gaps gaps={shownGaps} />
      </section>
    </section>
  );
}
