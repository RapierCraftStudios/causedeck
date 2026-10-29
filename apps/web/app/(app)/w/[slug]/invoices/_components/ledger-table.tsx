'use client';
// The client ledger (#871, #83): entries with a running balance, as a table. It is a record of what
// the advocate already did: there is no payment, no bank link and no transfer here, and the notice
// says so. Debits raise what the client owes, credits lower it.
import type { LedgerEntryView } from '@causedeck/core/fees';
import { Alert } from '@causedeck/ui/alert';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@causedeck/ui/table';
import { BookOpen } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { formatPaise } from '../../../../../../lib/fees/money.ts';

export interface LedgerTableProps {
  entries: readonly LedgerEntryView[];
  /** What the client owes in paise; negative when the client is in credit. */
  balancePaise: number;
}

type Kind = 'fee' | 'disbursement' | 'receipt' | 'refund' | 'adjustment';

export function LedgerTable({ entries, balancePaise }: LedgerTableProps) {
  const t = useTranslations('fees');
  const locale = useLocale();
  const money = (paise: number) => formatPaise(paise, locale);
  // The running balance after each entry, oldest first (the service returns them in that order).
  const rows = entries.map((entry, index) => ({
    entry,
    balance: entries
      .slice(0, index + 1)
      .reduce((sum, e) => sum + (e.direction === 'debit' ? e.amountPaise : -e.amountPaise), 0),
  }));
  const summary =
    balancePaise > 0
      ? t('ledger.owes', { amount: money(balancePaise) })
      : balancePaise < 0
        ? t('ledger.inCredit', { amount: money(-balancePaise) })
        : t('ledger.settled');
  return (
    <section aria-labelledby="fees-ledger" data-slot="ledger" className="flex flex-col gap-3">
      <h2 id="fees-ledger" className="font-serif text-lg font-medium">
        {t('ledger.title')}
      </h2>
      <Alert tone="info" role="note" data-slot="fees-ledger-notice">
        {t('ledgerNotice')}
      </Alert>
      {entries.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          icon={<BookOpen />}
          title={t('ledger.empty.title')}
          description={t('ledger.empty.body')}
        />
      ) : (
        <>
          <Table aria-label={t('ledger.label')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ledger.date')}</TableHead>
                <TableHead>{t('ledger.kind')}</TableHead>
                <TableHead>{t('ledger.description')}</TableHead>
                <TableHead className="text-right">{t('ledger.debit')}</TableHead>
                <TableHead className="text-right">{t('ledger.credit')}</TableHead>
                <TableHead className="text-right">{t('ledger.balance')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ entry, balance }) => (
                <TableRow key={entry.id}>
                  <TableCell className="tabular-nums">{entry.occurredOn}</TableCell>
                  <TableCell>{t(`ledger.kinds.${entry.kind as Kind}`)}</TableCell>
                  <TableCell>{entry.description}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.direction === 'debit' ? money(entry.amountPaise) : ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.direction === 'credit' ? money(entry.amountPaise) : ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-right font-medium tabular-nums" data-slot="ledger-balance">
            {summary}
          </p>
        </>
      )}
    </section>
  );
}
