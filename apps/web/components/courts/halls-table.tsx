'use client';

// The Halls tab (#400, #42): the halls named in this workspace's lists for the forum, with the date
// of the newest list naming each and an "Unreadable" tag (text, not colour alone) when that list
// could not be read for the hall. With no lists yet, an educational empty state.
import type { HallSeen } from '@causedeck/core/court';
import { Badge } from '@causedeck/ui/badge';
import { EmptyState } from '@causedeck/ui/empty-state';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';
import { DoorOpen } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

export interface HallsTableProps {
  halls: readonly HallSeen[];
}

export function HallsTable({ halls }: HallsTableProps) {
  const t = useTranslations('courts.detail.halls');
  const format = useFormatter();
  if (halls.length === 0) {
    return (
      <EmptyState
        data-pattern-state="empty"
        data-halls-empty=""
        icon={<DoorOpen />}
        title={t('emptyTitle')}
        description={t('emptyHint')}
      />
    );
  }
  return (
    <Table data-slot="halls-table">
      <TableCaption>{t('caption')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('hall')}</TableHead>
          <TableHead scope="col">{t('lastList')}</TableHead>
          <TableHead scope="col">{t('state')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {halls.map((hall) => (
          <TableRow key={hall.hallNo} data-hall={hall.hallNo}>
            <TableCell>{hall.hallNo}</TableCell>
            <TableCell>
              <time dateTime={new Date(hall.lastListAt).toISOString()}>
                {format.dateTime(new Date(hall.lastListAt), { dateStyle: 'medium' })}
              </time>
            </TableCell>
            <TableCell>
              {hall.unreadable ? (
                <Badge tone="warning" data-hall-unreadable="">
                  {t('unreadable')}
                </Badge>
              ) : (
                <span className="text-ink-muted">{t('read')}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
