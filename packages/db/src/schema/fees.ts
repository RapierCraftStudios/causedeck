// Fees, invoices and the client ledger (#83, part 1): the legal-gated client-fee tables, kept apart
// from the `saas_*` invoices CauseDeck issues to workspaces. `fee_agreement` is the terms for a matter,
// `invoice` and `invoice_line` the bill, `payment` money received against an issued invoice and
// `client_ledger_entry` the append-only running account of one client. Money is bigint paise. Every
// table is a tenant table under FORCE RLS. Matter and person links are NO ACTION, not CASCADE (a workspace delete still cascades): a ledger
// line is kept for the statutory period, and the DPDP erasure sweep anonymises it (`anonymised_at`,
// description cleared) instead of deleting it (docs/adr/0043-legal-gated-billing-flag.md).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { matter } from './matter-graph.ts';
import { person } from './people.ts';

/** These mirror the enums in `@causedeck/validators/fees` (CHECKs). */
export const GST_TREATMENTS = [
  'forward_charge',
  'reverse_charge',
  'exempt',
  'nil_rated',
  'out_of_scope',
  'pure_agent',
] as const;
export const FEE_BASES = ['fixed', 'hourly', 'retainer', 'per_appearance'] as const;
export const FEE_AGREEMENT_STATUSES = ['draft', 'active', 'ended'] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'] as const;
export const LEDGER_ENTRY_KINDS = [
  'fee',
  'disbursement',
  'receipt',
  'refund',
  'adjustment',
] as const;
export const LEDGER_DIRECTIONS = ['debit', 'credit'] as const;

const paise = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);

export const feeAgreement = tenantTable(
  'fee_agreement',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    personId: uuid('person_id').notNull(),
    basis: text('basis').notNull(),
    amountPaise: paise('amount_paise'),
    gstTreatment: text('gst_treatment').notNull(),
    status: text('status').notNull().default('draft'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('fee_agreement_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'fee_agreement_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fee_agreement_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'fee_agreement_person_fk',
      columns: [t.workspaceId, t.personId],
      foreignColumns: [person.workspaceId, person.id],
    }).onDelete('no action'),
    check('fee_agreement_basis_chk', sql`basis in ${inList(FEE_BASES)}`),
    check('fee_agreement_gst_treatment_chk', sql`gst_treatment in ${inList(GST_TREATMENTS)}`),
    check('fee_agreement_status_chk', sql`status in ${inList(FEE_AGREEMENT_STATUSES)}`),
    check('fee_agreement_amount_chk', sql`amount_paise >= 0`),
    check('fee_agreement_dates_chk', sql`ends_on is null or ends_on >= starts_on`),
  ],
);

export const invoice = tenantTable(
  'invoice',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    personId: uuid('person_id').notNull(),
    feeAgreementId: uuid('fee_agreement_id'),
    /** Allocated when the invoice is issued (#869); null while a draft. */
    number: text('number'),
    status: text('status').notNull().default('draft'),
    issueDate: date('issue_date'),
    dueDate: date('due_date'),
    placeOfSupplyStateCode: text('place_of_supply_state_code').notNull(),
    recipientGstin: text('recipient_gstin'),
    taxablePaise: paise('taxable_paise'),
    taxPaise: paise('tax_paise'),
    totalPaise: paise('total_paise'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('invoice_workspace_id_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('invoice_workspace_number_uq')
      .on(t.workspaceId, t.number)
      .where(sql`number is not null`),
    foreignKey({
      name: 'invoice_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invoice_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'invoice_person_fk',
      columns: [t.workspaceId, t.personId],
      foreignColumns: [person.workspaceId, person.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'invoice_fee_agreement_fk',
      columns: [t.workspaceId, t.feeAgreementId],
      foreignColumns: [feeAgreement.workspaceId, feeAgreement.id],
    }).onDelete('no action'),
    check('invoice_status_chk', sql`status in ${inList(INVOICE_STATUSES)}`),
    check('invoice_amounts_chk', sql`taxable_paise >= 0 and tax_paise >= 0 and total_paise >= 0`),
    check('invoice_number_chk', sql`status = 'draft' or number is not null`),
    check(
      'invoice_gstin_chk',
      sql`recipient_gstin is null or recipient_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
  ],
);

export const invoiceLine = tenantTable(
  'invoice_line',
  {
    id: id(),
    invoiceId: uuid('invoice_id').notNull(),
    position: integer('position').notNull().default(0),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPricePaise: paise('unit_price_paise'),
    amountPaise: paise('amount_paise'),
    gstTreatment: text('gst_treatment').notNull(),
    sac: text('sac'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'invoice_line_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invoice_line_invoice_fk',
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoice.workspaceId, invoice.id],
    }).onDelete('cascade'),
    check('invoice_line_gst_treatment_chk', sql`gst_treatment in ${inList(GST_TREATMENTS)}`),
    check('invoice_line_quantity_chk', sql`quantity > 0`),
    check('invoice_line_amounts_chk', sql`unit_price_paise >= 0 and amount_paise >= 0`),
  ],
);

export const payment = tenantTable(
  'payment',
  {
    id: id(),
    invoiceId: uuid('invoice_id').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    receivedOn: date('received_on').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'payment_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'payment_invoice_fk',
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoice.workspaceId, invoice.id],
    }).onDelete('no action'),
    check('payment_method_chk', sql`method in ${inList(PAYMENT_METHODS)}`),
    check('payment_amount_chk', sql`amount_paise > 0`),
  ],
);

export const clientLedgerEntry = tenantTable(
  'client_ledger_entry',
  {
    id: id(),
    personId: uuid('person_id').notNull(),
    matterId: uuid('matter_id'),
    invoiceId: uuid('invoice_id'),
    kind: text('kind').notNull(),
    direction: text('direction').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    /** Cleared by the DPDP erasure sweep, which sets `anonymised_at`; the money columns stay. */
    description: text('description'),
    occurredOn: date('occurred_on').notNull(),
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'client_ledger_entry_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'client_ledger_entry_person_fk',
      columns: [t.workspaceId, t.personId],
      foreignColumns: [person.workspaceId, person.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'client_ledger_entry_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'client_ledger_entry_invoice_fk',
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoice.workspaceId, invoice.id],
    }).onDelete('no action'),
    check('client_ledger_entry_kind_chk', sql`kind in ${inList(LEDGER_ENTRY_KINDS)}`),
    check('client_ledger_entry_direction_chk', sql`direction in ${inList(LEDGER_DIRECTIONS)}`),
    check('client_ledger_entry_amount_chk', sql`amount_paise > 0`),
    check('client_ledger_entry_anonymised_chk', sql`anonymised_at is null or description is null`),
  ],
);
