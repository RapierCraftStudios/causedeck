'use client';

// Invoices (#256): number, date, amount, status and PDF for every issued, paid or void SaaS invoice,
// newest first. A semantic table from 768 px, list cards below it. The PDF link goes to the
// authorised download route (#258) and is labelled with the invoice number; until the PDF has been
// rendered the cell says `Preparing`.
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { buttonVariants } from '@causedeck/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
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
import { Download, ReceiptText } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { InvoiceView } from './billing-view.ts';

const STATUS_TONE: Record<InvoiceView['status'], BadgeTone> = {
  issued: 'info',
  paid: 'success',
  void: 'neutral',
};

function InvoiceStatus({ status }: { status: InvoiceView['status'] }) {
  const t = useTranslations('billing.invoices.status');
  return (
    <Badge tone={STATUS_TONE[status]} data-status={status}>
      {t(status)}
    </Badge>
  );
}

function PdfLink({ invoice }: { invoice: InvoiceView }) {
  const t = useTranslations('billing.invoices');
  if (invoice.pdfHref === null) {
    return <span className="text-ink-muted text-sm">{t('preparing')}</span>;
  }
  return (
    <a
      href={invoice.pdfHref}
      aria-label={t('download', { number: invoice.number })}
      className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} text-accent px-2`}
    >
      <Download aria-hidden="true" />
    </a>
  );
}

export function InvoiceTable({ invoices }: { invoices: readonly InvoiceView[] }) {
  const t = useTranslations('billing.invoices');
  return (
    <Card data-slot="billing-invoices">
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <EmptyState data-pattern-state="empty" icon={<ReceiptText />} title={t('empty')} />
        ) : (
          <>
            <ul data-slot="billing-invoice-cards" className="flex flex-col md:hidden">
              {invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  data-invoice={invoice.number}
                  className="border-line flex items-center gap-3 border-b py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium tabular-nums">{invoice.number}</span>
                    <span className="text-ink-muted text-sm">{invoice.date}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{invoice.amount}</span>
                      <InvoiceStatus status={invoice.status} />
                    </span>
                  </div>
                  <PdfLink invoice={invoice} />
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableCaption className="sr-only">{t('caption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('columns.number')}</TableHead>
                    <TableHead scope="col">{t('columns.date')}</TableHead>
                    <TableHead scope="col" className="text-right">
                      {t('columns.amount')}
                    </TableHead>
                    <TableHead scope="col">{t('columns.status')}</TableHead>
                    <TableHead scope="col" className="text-right">
                      {t('columns.pdf')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id} data-invoice={invoice.number}>
                      <TableCell className="font-medium">{invoice.number}</TableCell>
                      <TableCell>{invoice.date}</TableCell>
                      <TableCell className="text-right tabular-nums">{invoice.amount}</TableCell>
                      <TableCell>
                        <InvoiceStatus status={invoice.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PdfLink invoice={invoice} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
