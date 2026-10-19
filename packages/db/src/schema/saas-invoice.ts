// SaaS invoice tables (#252, #29 part 1): the GST tax invoices CauseDeck issues to workspaces for
// their subscription. Named `saas_*` so they never collide with the client-fee `invoice` tables,
// which are legal-gated and separate (spike §4.2). `saas_invoice` and `saas_invoice_line` are tenant
// tables built with `tenantTable()` and get `ws_isolation` in 0016_saas_invoices; `invoice_counter`
// is global (GLOBAL_TABLES): one gapless series per supplier and financial year, allocated under a
// row lock by #253. Issued invoices are immutable: the 0016 triggers reject any change to an issued
// invoice except `status` and `pdf_blob_id`, and any change to its lines (void and reissue only).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';

export const SAAS_INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export type SaasInvoiceStatus = (typeof SAAS_INVOICE_STATUSES)[number];

/** Supplier or recipient snapshot taken when the invoice is drafted (GSTIN null for unregistered). */
export interface SaasInvoiceParty {
  legalName: string;
  address: string;
  gstin: string | null;
  stateCode: string;
}

const paise = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);

/** A SaaS tax invoice. `number` is allocated from `invoice_counter` when the invoice is issued. */
export const saasInvoice = tenantTable(
  'saas_invoice',
  {
    id: id(),
    // No foreign key: db:check-rls requires FKs to tenant tables to pair `workspace_id`, and
    // `subscription` has no unique (id, workspace_id). An issued invoice outlives its subscription.
    subscriptionId: uuid('subscription_id'),
    number: text('number'),
    series: text('series').notNull(),
    fy: text('fy').notNull(),
    status: text('status').notNull().default('draft'),
    issueDate: date('issue_date'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    supplier: jsonb('supplier').$type<SaasInvoiceParty>().notNull(),
    recipient: jsonb('recipient').$type<SaasInvoiceParty>().notNull(),
    placeOfSupplyStateCode: text('place_of_supply_state_code').notNull(),
    sac: text('sac').notNull().default('998314'),
    taxablePaise: paise('taxable_paise'),
    cgstPaise: paise('cgst_paise'),
    sgstPaise: paise('sgst_paise'),
    igstPaise: paise('igst_paise'),
    totalPaise: paise('total_paise'),
    currency: text('currency').notNull().default('INR'),
    providerPaymentId: text('provider_payment_id'),
    pdfBlobId: text('pdf_blob_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId], foreignColumns: [organization.id] }).onDelete('cascade'),
    uniqueIndex('saas_invoice_number_uq').on(t.number),
    // The target of the composite line FK (db:check-rls cross-workspace-fk).
    unique('saas_invoice_id_workspace_uq').on(t.id, t.workspaceId),
    check('saas_invoice_status_chk', sql`status in ${inList(SAAS_INVOICE_STATUSES)}`),
    check(
      'saas_invoice_number_issued_chk',
      sql`status = 'draft' or (number is not null and issue_date is not null)`,
    ),
    check('saas_invoice_place_of_supply_chk', sql.raw(`place_of_supply_state_code ~ '^[0-9]{2}$'`)),
    check(
      'saas_invoice_amounts_chk',
      sql`taxable_paise >= 0 and cgst_paise >= 0 and sgst_paise >= 0 and igst_paise >= 0 and total_paise >= 0`,
    ),
    check('saas_invoice_currency_chk', sql`currency = 'INR'`),
  ],
);

/** A line of a SaaS invoice, in the invoice's workspace (composite FK). */
export const saasInvoiceLine = tenantTable(
  'saas_invoice_line',
  {
    id: id(),
    invoiceId: uuid('invoice_id').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId], foreignColumns: [organization.id] }).onDelete('cascade'),
    foreignKey({
      name: 'saas_invoice_line_invoice_fk',
      columns: [t.invoiceId, t.workspaceId],
      foreignColumns: [saasInvoice.id, saasInvoice.workspaceId],
    }).onDelete('cascade'),
    index('saas_invoice_line_workspace_invoice_idx').on(t.workspaceId, t.invoiceId),
    check('saas_invoice_line_description_chk', sql`length(btrim(description)) > 0`),
    check('saas_invoice_line_quantity_chk', sql`quantity > 0`),
    check('saas_invoice_line_amounts_chk', sql`unit_price_paise >= 0 and amount_paise >= 0`),
  ],
);

/** The last invoice number used per series and financial year (global, gapless, #253). */
export const invoiceCounter = pgTable(
  'invoice_counter',
  {
    series: text('series').notNull(),
    fy: text('fy').notNull(),
    lastNumber: bigint('last_number', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'invoice_counter_pkey', columns: [t.series, t.fy] }),
    check('invoice_counter_last_number_chk', sql`last_number >= 0`),
  ],
);
