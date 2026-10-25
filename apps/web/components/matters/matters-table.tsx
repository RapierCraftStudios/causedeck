'use client';
// The matters table (#388, >= 768 px): Matter (serif title, `Petitioner v. Respondent`, the lock
// badge), Next date (court-style date, relative day and `Confirmed` / `To confirm`), Forum and
// stage, Proceedings, Owner and Updated. Sortable headers are links that rewrite the URL
// (`matterListHref`), with `aria-sort` on the active one. A row's title is its link, named
// `Open matter {title}, next date {date}`; `j`/`k` (matters-list.tsx) mark the active row.
// A plain `@causedeck/ui/table`, not the TanStack data-table: the route has a 25 KB JS budget.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@causedeck/ui/table';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { MatterRowView } from '../../lib/matters/graph-deps.ts';
import {
  matterListHref,
  type MatterListState,
  type MatterSort,
} from '../../lib/matters/list-params.ts';

import { MatterStage, NextDate, SensitiveBadge, useParties, useRowName } from './matter-card.tsx';

export interface MattersTableProps {
  rows: readonly MatterRowView[];
  state: MatterListState;
  slug: string;
  /** The row `j`/`k` marked, or -1. */
  activeIndex?: number;
}

function SortHeader({
  sort,
  label,
  state,
  slug,
}: {
  sort: MatterSort;
  label: string;
  state: MatterListState;
  slug: string;
}) {
  const active = state.sort === sort;
  // Next date and title run ascending; updated runs newest first (searchMatters' sort keys).
  const direction = sort === 'updated' ? 'descending' : 'ascending';
  const Icon = direction === 'ascending' ? ArrowUp : ArrowDown;
  return (
    <TableHead scope="col" aria-sort={active ? direction : undefined}>
      <Link
        href={matterListHref(slug, state, { sort })}
        data-matter-sort={sort}
        className="hover:text-ink focus-visible:outline-ring inline-flex items-center gap-1 rounded-sm outline-none focus-visible:outline-2"
        scroll={false}
      >
        {label}
        {active ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      </Link>
    </TableHead>
  );
}

export function MattersTable({ rows, state, slug, activeIndex = -1 }: MattersTableProps) {
  const t = useTranslations('matters');
  const nameOf = useRowName();
  const partiesOf = useParties();
  return (
    <Table data-slot="matters-table" aria-label={t('listLabel')}>
      <TableHeader>
        <TableRow>
          <SortHeader sort="title" label={t('columns.matter')} state={state} slug={slug} />
          <SortHeader sort="next_date" label={t('columns.nextDate')} state={state} slug={slug} />
          <TableHead scope="col">{t('columns.forumStage')}</TableHead>
          <TableHead scope="col" className="text-end">
            {t('columns.proceedings')}
          </TableHead>
          <TableHead scope="col">{t('columns.owner')}</TableHead>
          <SortHeader sort="updated" label={t('columns.updated')} state={state} slug={slug} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const parties = partiesOf(row);
          const active = index === activeIndex;
          return (
            <TableRow
              key={row.id}
              selected={active}
              aria-selected={active}
              data-matter-row={row.id}
              data-index={index}
              className="h-auto"
            >
              <TableCell className="py-2">
                <span className="flex flex-col gap-0.5">
                  <Link
                    href={row.href}
                    aria-label={nameOf(row)}
                    data-matter-link=""
                    className="focus-visible:outline-ring rounded-sm font-serif text-base font-medium outline-none hover:underline focus-visible:outline-2"
                  >
                    {row.title}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {parties === null ? null : (
                      <span className="text-ink-muted text-sm">{parties}</span>
                    )}
                    {row.sensitive ? <SensitiveBadge /> : null}
                  </span>
                </span>
              </TableCell>
              <TableCell className="py-2">
                <NextDate nextDate={row.nextDate} />
              </TableCell>
              <TableCell className="py-2">
                <span className="flex flex-col items-start gap-1">
                  <span className={row.forum === null ? 'text-ink-muted' : undefined}>
                    {row.forum ?? t('row.noForum')}
                  </span>
                  <MatterStage stage={row.stage} />
                </span>
              </TableCell>
              <TableCell className="py-2 text-end tabular-nums">{row.proceedingCount}</TableCell>
              <TableCell className="py-2">
                {row.owner ?? <span className="text-ink-muted">{t('row.noOwner')}</span>}
              </TableCell>
              <TableCell className="py-2 tabular-nums">
                <time dateTime={row.updatedAt}>{row.updated}</time>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
