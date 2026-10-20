// Statutory retention of SaaS invoices after workspace deletion (#302, part 2 of #31; see
// docs/engineering/data-lifecycle.md). `legal_hold_invoice` is a minimal, content-free copy of each
// issued, paid or void `saas_invoice` of an erased workspace: the GST identifiers (number, series,
// financial year, GSTINs, state codes, SAC) and the amounts, never a legal name, address, line
// description, payment id or PDF. Written once by the erase job before the tenant rows are purged;
// like `deletion_tombstone` it is global (GLOBAL_TABLES), has no foreign key so it outlives the
// purge, and the app and clerk roles may not UPDATE, DELETE or TRUNCATE it (0031).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const paise = (name: string) => bigint(name, { mode: 'number' }).notNull();

export const legalHoldInvoice = pgTable(
  'legal_hold_invoice',
  {
    /** The id the invoice had in `saas_invoice`. */
    invoiceId: uuid('invoice_id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    number: text('number').notNull(),
    series: text('series').notNull(),
    fy: text('fy').notNull(),
    status: text('status').notNull(),
    issueDate: date('issue_date').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    placeOfSupplyStateCode: text('place_of_supply_state_code').notNull(),
    sac: text('sac').notNull(),
    taxablePaise: paise('taxable_paise'),
    cgstPaise: paise('cgst_paise'),
    sgstPaise: paise('sgst_paise'),
    igstPaise: paise('igst_paise'),
    totalPaise: paise('total_paise'),
    currency: text('currency').notNull(),
    supplierGstin: text('supplier_gstin'),
    supplierStateCode: text('supplier_state_code').notNull(),
    recipientGstin: text('recipient_gstin'),
    recipientStateCode: text('recipient_state_code').notNull(),
    legalHold: boolean('legal_hold').notNull().default(true),
    retainUntil: date('retain_until').notNull(),
    retainedAt: timestamp('retained_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('legal_hold_invoice_workspace_id_idx').on(t.workspaceId),
    check('legal_hold_invoice_hold_chk', sql`legal_hold = true`),
    check('legal_hold_invoice_status_chk', sql`status in ('issued', 'paid', 'void')`),
  ],
);
