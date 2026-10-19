// SaaS invoices on the database (#253, #29). `@causedeck/billing` is pure (`@causedeck/db` depends
// on it), so `issueInvoice` there runs over the `InvoiceStore` port implemented here.
//
// `issueSaasInvoice` runs the whole issuance in ONE `withWorkspace` transaction. The number comes
// from `invoice_counter` (global, one row per series and financial year) under a row lock: insert
// the row if missing, `SELECT ... FOR UPDATE`, then increment. Concurrent issuances in the same
// series queue on that lock, and a rolled-back issuance returns its number with the transaction, so
// the series is gapless. Lines are inserted while the invoice is a draft (the 0017 trigger rejects
// lines on an issued invoice), then the invoice is marked issued.
//
// `createInvoiceStore` also implements `OnPaymentStore` (#255): `findByPaymentId` is the lookup that
// makes `invoiceOnPayment` idempotent per provider payment (backed by `saas_invoice_payment_uq`).
// `loadSaasInvoiceForRender` reads an issued invoice with its lines for the render job.
//
// `listSaasInvoices` (#256) lists the workspace's issued, paid and void invoices for the billing
// page, newest first. Drafts are never listed; they have no number yet. It runs on the caller's
// queryable: `saas_invoice` is workspace-isolated (RLS), so callers pass their workspace-scoped
// transaction.
import { supplierFromEnv, type SupplierConfig } from '@causedeck/billing/config/supplier';
import {
  issueInvoice,
  type IssueInvoiceInput,
  type SaasInvoice,
} from '@causedeck/billing/invoice/generate';
import type { OnPaymentStore } from '@causedeck/billing/invoice/on-payment';
import { isUuid, schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

type Queryable = Database | Transaction;

const { invoiceCounter, organization, saasInvoice, saasInvoiceLine, subscription } = schema;

export interface InvoiceContext {
  db: Database | Transaction;
  workspaceId: string;
  /** Clock override (tests, replays). */
  now?: () => Date;
  /** Supplier override; defaults to `supplierFromEnv()` (refuses in production when unset). */
  supplier?: () => SupplierConfig;
}

/** The `InvoiceStore` (and `OnPaymentStore`) over a workspace-scoped transaction. */
export function createInvoiceStore(tx: Transaction, workspaceId: string): OnPaymentStore {
  return {
    async findByPaymentId(providerPaymentId) {
      const [row] = await tx
        .select({ id: saasInvoice.id })
        .from(saasInvoice)
        .where(
          and(
            eq(saasInvoice.workspaceId, workspaceId),
            eq(saasInvoice.providerPaymentId, providerPaymentId),
          ),
        );
      return row ?? null;
    },

    async loadRecipient(subscriptionId) {
      if (!isUuid(subscriptionId)) return null;
      const [row] = await tx
        .select({ name: organization.name, gstin: subscription.gstin })
        .from(subscription)
        .innerJoin(organization, eq(organization.id, subscription.workspaceId))
        .where(and(eq(subscription.id, subscriptionId), eq(subscription.workspaceId, workspaceId)));
      return row ?? null;
    },

    async allocate(series, fy) {
      const key = and(eq(invoiceCounter.series, series), eq(invoiceCounter.fy, fy));
      await tx.insert(invoiceCounter).values({ series, fy }).onConflictDoNothing();
      const [row] = await tx
        .select({ lastNumber: invoiceCounter.lastNumber })
        .from(invoiceCounter)
        .where(key)
        .for('update');
      if (!row) throw new Error(`invoice_counter row ${series}/${fy} is missing`);
      const next = row.lastNumber + 1;
      await tx.update(invoiceCounter).set({ lastNumber: next }).where(key);
      return next;
    },

    async insertDraft({ lines, ...draft }) {
      const [row] = await tx
        .insert(saasInvoice)
        .values({ ...draft, workspaceId, status: 'draft' })
        .returning({ id: saasInvoice.id });
      if (!row) throw new Error('saas_invoice insert returned no row');
      await tx
        .insert(saasInvoiceLine)
        .values(lines.map((line) => ({ ...line, invoiceId: row.id, workspaceId })));
      return row.id;
    },

    async markIssued(id, number, issueDate) {
      await tx
        .update(saasInvoice)
        .set({ status: 'issued', number, issueDate })
        .where(and(eq(saasInvoice.id, id), eq(saasInvoice.workspaceId, workspaceId)));
    },
  };
}

/** Issue a SaaS GST invoice in the context workspace (one transaction, gapless number). */
export async function issueSaasInvoice(
  ctx: InvoiceContext,
  input: IssueInvoiceInput,
): Promise<SaasInvoice> {
  const { workspaceId } = ctx;
  const supplier = ctx.supplier ?? (() => supplierFromEnv());
  return withWorkspace(ctx.db, { workspaceId }, (tx) =>
    issueInvoice(
      {
        store: createInvoiceStore(tx, workspaceId),
        supplier,
        ...(ctx.now ? { now: ctx.now } : {}),
      },
      input,
    ),
  );
}

/** An issued (or later) invoice with its lines, as the PDF template takes it. */
export interface RenderableSaasInvoice {
  invoice: SaasInvoice;
  status: string;
  pdfBlobId: string | null;
}

/**
 * The invoice `invoiceId` of the workspace with its lines, for rendering; null when it does not
 * exist in this workspace or is still a draft (no number yet).
 */
export async function loadSaasInvoiceForRender(
  db: Queryable,
  workspaceId: string,
  invoiceId: string,
): Promise<RenderableSaasInvoice | null> {
  if (!isUuid(invoiceId)) return null;
  const [row] = await db
    .select()
    .from(saasInvoice)
    .where(and(eq(saasInvoice.id, invoiceId), eq(saasInvoice.workspaceId, workspaceId)));
  if (!row || row.status === 'draft' || row.number === null || row.issueDate === null) return null;
  const lines = await db
    .select({
      description: saasInvoiceLine.description,
      quantity: saasInvoiceLine.quantity,
      unitPricePaise: saasInvoiceLine.unitPricePaise,
      amountPaise: saasInvoiceLine.amountPaise,
    })
    .from(saasInvoiceLine)
    .where(
      and(eq(saasInvoiceLine.invoiceId, invoiceId), eq(saasInvoiceLine.workspaceId, workspaceId)),
    )
    // Lines have no position column; they are inserted once, in order, and never updated (0017
    // trigger), so their physical order is the insertion order.
    .orderBy(sql`ctid`);
  return {
    status: row.status,
    pdfBlobId: row.pdfBlobId,
    invoice: {
      id: row.id,
      subscriptionId: row.subscriptionId ?? '',
      number: row.number,
      series: row.series,
      fy: row.fy,
      status: 'issued',
      issueDate: row.issueDate,
      periodStart: row.periodStart ?? row.issueDate,
      periodEnd: row.periodEnd ?? row.issueDate,
      supplier: row.supplier,
      recipient: row.recipient,
      placeOfSupplyStateCode: row.placeOfSupplyStateCode,
      sac: row.sac,
      taxablePaise: row.taxablePaise,
      cgstPaise: row.cgstPaise,
      sgstPaise: row.sgstPaise,
      igstPaise: row.igstPaise,
      totalPaise: row.totalPaise,
      currency: 'INR',
      lines,
      providerPaymentId: row.providerPaymentId,
    },
  };
}

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
