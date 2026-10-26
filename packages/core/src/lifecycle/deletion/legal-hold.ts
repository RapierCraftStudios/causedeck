// Statutory retention of SaaS invoices (#302; docs/engineering/data-lifecycle.md, "Retention").
// Before the erase purges the tenant rows, every issued, paid or void `saas_invoice` of the
// workspace is copied, in minimal form, into the global write-once `legal_hold_invoice` table. The
// rule (`LEGAL_HOLD_RULE`) is explicit so the exclusion from erasure is documented in code too.
import { schema, type Queryable } from '@causedeck/db';
import { and, eq, inArray } from 'drizzle-orm';

const { legalHoldInvoice, saasInvoice } = schema;

/** Years an invoice is kept after the end of its financial year (#31 spec; counsel to confirm). */
export const LEGAL_HOLD_YEARS = 8;

/** Invoice statuses that are tax invoices (a draft never was one, so it is erased). */
export const LEGAL_HOLD_STATUSES = ['issued', 'paid', 'void'] as const;

export const LEGAL_HOLD_RULE = {
  table: 'saas_invoice',
  statuses: LEGAL_HOLD_STATUSES,
  years: LEGAL_HOLD_YEARS,
  kept: [
    'number',
    'series',
    'fy',
    'status',
    'issue_date',
    'period_start',
    'period_end',
    'place_of_supply_state_code',
    'sac',
    'taxable_paise',
    'cgst_paise',
    'sgst_paise',
    'igst_paise',
    'total_paise',
    'currency',
    'supplier_gstin',
    'supplier_state_code',
    'recipient_gstin',
    'recipient_state_code',
  ],
  dropped: [
    'supplier.legalName',
    'supplier.address',
    'recipient.legalName',
    'recipient.address',
    'saas_invoice_line.description',
    'provider_payment_id',
    'subscription_id',
    'pdf_blob_id (the PDF object is erased with the other blobs)',
  ],
  reason:
    'GST law requires tax invoices to be kept for the statutory period, so issued SaaS invoices ' +
    'survive workspace erasure in minimal form under legal hold: tax identifiers and amounts only, ' +
    'no names, addresses, line descriptions or documents. The exact field list awaits counsel/CA ' +
    'confirmation (#31).',
} as const;

/** The day an invoice issued on `issueDate` (YYYY-MM-DD) may be discarded: FY end + 8 years. */
export function legalHoldRetainUntil(issueDate: string): string {
  const [year, month] = issueDate.split('-').map(Number);
  if (year === undefined || month === undefined || Number.isNaN(year) || Number.isNaN(month)) {
    throw new TypeError('legalHoldRetainUntil: bad issue date');
  }
  // The Indian financial year ends on 31 March.
  const fyEndYear = month >= 4 ? year + 1 : year;
  return `${String(fyEndYear + LEGAL_HOLD_YEARS)}-03-31`;
}

/**
 * Copy the workspace's tax invoices into `legal_hold_invoice` (call inside the workspace's
 * `withWorkspace`). Idempotent: an invoice already held is left as it is. Returns how many the
 * workspace has under legal hold.
 */
export async function retainInvoicesForLegalHold(
  tx: Queryable,
  workspaceId: string,
): Promise<number> {
  const invoices = await tx
    .select()
    .from(saasInvoice)
    .where(
      and(
        eq(saasInvoice.workspaceId, workspaceId),
        inArray(saasInvoice.status, [...LEGAL_HOLD_STATUSES]),
      ),
    );
  const held = invoices.flatMap((inv) => {
    if (inv.number === null || inv.issueDate === null) return [];
    return [
      {
        invoiceId: inv.id,
        workspaceId,
        number: inv.number,
        series: inv.series,
        fy: inv.fy,
        status: inv.status,
        issueDate: inv.issueDate,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        placeOfSupplyStateCode: inv.placeOfSupplyStateCode,
        sac: inv.sac,
        taxablePaise: inv.taxablePaise,
        cgstPaise: inv.cgstPaise,
        sgstPaise: inv.sgstPaise,
        igstPaise: inv.igstPaise,
        totalPaise: inv.totalPaise,
        currency: inv.currency,
        supplierGstin: inv.supplier.gstin,
        supplierStateCode: inv.supplier.stateCode,
        recipientGstin: inv.recipient.gstin,
        recipientStateCode: inv.recipient.stateCode,
        legalHold: true,
        retainUntil: legalHoldRetainUntil(inv.issueDate),
      },
    ];
  });
  if (held.length > 0) await tx.insert(legalHoldInvoice).values(held).onConflictDoNothing();
  return held.length;
}
