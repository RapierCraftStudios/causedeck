// SaaS invoices for the billing page (#256): the workspace's issued, paid and void invoices, newest
// first. Drafts are never listed; they have no number yet. Reads run on the caller's queryable:
// `saas_invoice` is workspace-isolated (RLS), so callers pass their workspace-scoped transaction.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, desc, eq, inArray } from 'drizzle-orm';

type Queryable = Database | Transaction;

const { saasInvoice } = schema;

/** Statuses shown on the billing page. */
export const LISTED_INVOICE_STATUSES = ['issued', 'paid', 'void'] as const;
export type ListedInvoiceStatus = (typeof LISTED_INVOICE_STATUSES)[number];

export interface SaasInvoiceSummary {
  id: string;
  number: string;
  /** `yyyy-mm-dd`. */
  issueDate: string;
  status: ListedInvoiceStatus;
  totalPaise: number;
  pdfBlobId: string | null;
}

const isListed = (status: string): status is ListedInvoiceStatus =>
  (LISTED_INVOICE_STATUSES as readonly string[]).includes(status);

/** The workspace's invoices, newest first (by issue date, then number). */
export async function listSaasInvoices(
  db: Queryable,
  workspaceId: string,
): Promise<SaasInvoiceSummary[]> {
  const rows = await db
    .select({
      id: saasInvoice.id,
      number: saasInvoice.number,
      issueDate: saasInvoice.issueDate,
      status: saasInvoice.status,
      totalPaise: saasInvoice.totalPaise,
      pdfBlobId: saasInvoice.pdfBlobId,
    })
    .from(saasInvoice)
    .where(
      and(
        eq(saasInvoice.workspaceId, workspaceId),
        inArray(saasInvoice.status, [...LISTED_INVOICE_STATUSES]),
      ),
    )
    .orderBy(desc(saasInvoice.issueDate), desc(saasInvoice.number));
  // `saas_invoice_number_issued_chk` guarantees a number and an issue date once issued.
  return rows.flatMap(({ number, issueDate, status, ...rest }) =>
    number !== null && issueDate !== null && isListed(status)
      ? [{ ...rest, number, issueDate, status }]
      : [],
  );
}
