'use client';
// The invoice preview (#871, #83): the priced lines and the tax split, in serif with tabular,
// right-aligned rupee amounts grouped the Indian way. While the GST config or a treatment is
// unreviewed the warning banner shows, as text and not only colour. A preview is not sent anywhere.
import { Alert } from '@causedeck/ui/alert';
import { useLocale, useTranslations } from 'next-intl';

import { formatPaise } from '../../../../../../lib/fees/money.ts';

export interface PreviewLine {
  description: string;
  quantity: number;
  unitPricePaise: number;
  amountPaise: number;
}

export interface PreviewTotals {
  taxablePaise: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  /** Tax on a final invoice read back from storage, where the split is not kept. */
  taxPaise?: number;
  rcmPaise?: number;
  totalPaise: number;
}

export interface InvoicePreviewProps {
  supplierName: string;
  matterId: string;
  personId: string;
  number?: string | null;
  lines: readonly PreviewLine[];
  totals: PreviewTotals;
  gstUnreviewed: boolean;
}

export function GstReviewBanner() {
  const t = useTranslations('fees');
  return (
    <Alert tone="warning" role="note" data-slot="fees-gst-banner">
      {t('gstBanner')}
    </Alert>
  );
}

export function InvoicePreview({
  supplierName,
  personId,
  number,
  lines,
  totals,
  gstUnreviewed,
}: InvoicePreviewProps) {
  const t = useTranslations('fees');
  const locale = useLocale();
  const money = (paise: number) => formatPaise(paise, locale);
  const taxRows: [string, number | undefined][] = [
    [t('preview.cgst'), totals.cgst],
    [t('preview.sgst'), totals.sgst],
    [t('preview.igst'), totals.igst],
  ];
  return (
    <article
      data-slot="invoice-preview"
      aria-label={t('preview.title')}
      className="border-line bg-surface flex flex-col gap-4 rounded-md border p-6 font-serif"
    >
      {gstUnreviewed ? <GstReviewBanner /> : null}
      <header className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-ink-muted font-sans text-xs">{t('preview.supplier')}</span>
          <span className="font-medium">{supplierName}</span>
        </div>
        <div className="flex flex-col sm:text-right">
          <span className="text-ink-muted font-sans text-xs">{t('preview.number')}</span>
          <span className="tabular-nums">{number ?? t('invoices.draftNumber')}</span>
        </div>
      </header>
      <p className="text-ink-muted font-sans text-sm">{t('preview.billTo', { id: personId })}</p>
      <ul className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <li key={index} className="flex justify-between gap-4">
            <span className="flex flex-col">
              <span>{line.description}</span>
              <span className="text-ink-muted font-sans text-xs tabular-nums">
                {t('preview.line', {
                  quantity: line.quantity,
                  price: money(line.unitPricePaise),
                })}
              </span>
            </span>
            <span className="text-right tabular-nums">{money(line.amountPaise)}</span>
          </li>
        ))}
      </ul>
      <dl className="border-line flex flex-col gap-1 border-t pt-3">
        <Row label={t('preview.taxable')} value={money(totals.taxablePaise)} />
        {taxRows.map(([label, value]) =>
          value === undefined || value === 0 ? null : (
            <Row key={label} label={label} value={money(value)} />
          ),
        )}
        {totals.cgst === undefined && totals.taxPaise ? (
          <Row label={t('preview.tax')} value={money(totals.taxPaise)} />
        ) : null}
        {totals.rcmPaise ? <Row label={t('preview.rcm')} value={money(totals.rcmPaise)} /> : null}
        <Row label={t('preview.total')} value={money(totals.totalPaise)} strong />
      </dl>
    </article>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'text-lg font-medium' : ''}`}>
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}
