'use client';

// The usage breakdown (#223): every metered resource this month with its limit, in a semantic table
// under the meters (tokens and storage have no meter of their own).
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';
import { useTranslations } from 'next-intl';

import type { BreakdownRow } from './usage-view.ts';

export function UsageBreakdown({ rows }: { rows: readonly BreakdownRow[] }) {
  const t = useTranslations('usage.breakdown');
  return (
    <Card data-slot="usage-breakdown">
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableCaption className="sr-only">{t('caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('resource')}</TableHead>
              <TableHead scope="col" className="text-end">
                {t('used')}
              </TableHead>
              <TableHead scope="col" className="text-end">
                {t('limit')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-row={row.id}>
                <TableHead scope="row" className="text-ink text-sm font-normal">
                  {t(`rows.${row.id}`)}
                </TableHead>
                <TableCell className="text-end tabular-nums">{row.used}</TableCell>
                <TableCell className="text-ink-muted text-end tabular-nums">
                  {row.limit ?? t('noLimit')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
