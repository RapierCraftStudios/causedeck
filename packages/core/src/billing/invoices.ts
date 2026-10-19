// SaaS invoices on the database (#253, #29). `@causedeck/billing` is pure (`@causedeck/db` depends
// on it), so `issueInvoice` there runs over the `InvoiceStore` port implemented here.
//
// `issueSaasInvoice` runs the whole issuance in ONE `withWorkspace` transaction. The number comes
// from `invoice_counter` (global, one row per series and financial year) under a row lock: insert
// the row if missing, `SELECT ... FOR UPDATE`, then increment. Concurrent issuances in the same
// series queue on that lock, and a rolled-back issuance returns its number with the transaction, so
// the series is gapless. Lines are inserted while the invoice is a draft (the 0017 trigger rejects
// lines on an issued invoice), then the invoice is marked issued.
import { supplierFromEnv, type SupplierConfig } from '@causedeck/billing/config/supplier';
import {
  issueInvoice,
  type InvoiceStore,
  type IssueInvoiceInput,
  type SaasInvoice,
} from '@causedeck/billing/invoice/generate';
import { isUuid, schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

const { invoiceCounter, organization, saasInvoice, saasInvoiceLine, subscription } = schema;

export interface InvoiceContext {
  db: Database | Transaction;
  workspaceId: string;
  /** Clock override (tests, replays). */
  now?: () => Date;
  /** Supplier override; defaults to `supplierFromEnv()` (refuses in production when unset). */
  supplier?: () => SupplierConfig;
}

/** The `InvoiceStore` over a workspace-scoped transaction. */
export function createInvoiceStore(tx: Transaction, workspaceId: string): InvoiceStore {
  return {
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
