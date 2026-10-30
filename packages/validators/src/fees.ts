// Fees, invoices and the client ledger (#83, part 1 of 5): the zod inputs of the legal-gated fees
// domain. Money is an integer count of paise (never a float); objects are strict, so an unknown key
// is an error. No money moves here: a payment is a record of money the advocate was already paid.
import { z } from 'zod';

import { GSTIN_PATTERN_SOURCE } from './gstin';

/** How GST applies to a fee line (docs/engineering/gst-invoicing.md); counsel signs these off (#120). */
export const GST_TREATMENTS = [
  'forward_charge',
  'reverse_charge',
  'exempt',
  'nil_rated',
  'out_of_scope',
  'pure_agent',
] as const;
export type GstTreatment = (typeof GST_TREATMENTS)[number];

export const FEE_BASES = ['fixed', 'hourly', 'retainer', 'per_appearance'] as const;
export type FeeBasis = (typeof FEE_BASES)[number];

export const FEE_AGREEMENT_STATUSES = ['draft', 'active', 'ended'] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const LEDGER_ENTRY_KINDS = [
  'fee',
  'disbursement',
  'receipt',
  'refund',
  'adjustment',
] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export const LEDGER_DIRECTIONS = ['debit', 'credit'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

const uuid = z.uuid();
const paise = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positivePaise = paise.positive();
const isoDate = z.iso.date();
const text = (max: number) => z.string().trim().min(1).max(max);
const gstin = z.string().trim().toUpperCase().regex(new RegExp(GSTIN_PATTERN_SOURCE));
const stateCode = z.string().regex(/^[0-9]{2}$/);

export const GstTreatmentSchema = z.enum(GST_TREATMENTS);

/** The fee terms agreed with a client for a matter. */
export const FeeAgreementInput = z
  .strictObject({
    matterId: uuid,
    personId: uuid,
    basis: z.enum(FEE_BASES),
    amountPaise: paise,
    gstTreatment: GstTreatmentSchema,
    startsOn: isoDate,
    endsOn: isoDate.optional(),
    notes: text(2000).optional(),
  })
  .refine((value) => value.endsOn === undefined || value.endsOn >= value.startsOn, {
    path: ['endsOn'],
    message: 'The end date cannot be before the start date',
  });

/** One line of an invoice; `amountPaise` is quantity times unit price. */
export const InvoiceLine = z
  .strictObject({
    description: text(500),
    quantity: z.number().int().positive().max(1_000_000),
    unitPricePaise: paise,
    amountPaise: paise,
    gstTreatment: GstTreatmentSchema,
    sac: z
      .string()
      .regex(/^[0-9]{4,8}$/)
      .optional(),
  })
  .refine((line) => line.amountPaise === line.quantity * line.unitPricePaise, {
    path: ['amountPaise'],
    message: 'The amount must be the quantity times the unit price',
  });

/** An invoice to a client for a matter; at least one line. */
export const InvoiceInput = z.strictObject({
  matterId: uuid,
  personId: uuid,
  feeAgreementId: uuid.optional(),
  placeOfSupplyStateCode: stateCode,
  recipientGstin: gstin.optional(),
  dueDate: isoDate.optional(),
  lines: z.array(InvoiceLine).min(1).max(200),
});

/** Money received against an issued invoice. */
export const PaymentRecord = z.strictObject({
  invoiceId: uuid,
  amountPaise: positivePaise,
  method: z.enum(PAYMENT_METHODS),
  reference: text(200).optional(),
  receivedOn: isoDate,
});

/** A line in the client's ledger: a debit raises what the client owes, a credit lowers it. */
export const LedgerEntry = z.strictObject({
  personId: uuid,
  matterId: uuid.optional(),
  invoiceId: uuid.optional(),
  kind: z.enum(LEDGER_ENTRY_KINDS),
  direction: z.enum(LEDGER_DIRECTIONS),
  amountPaise: positivePaise,
  description: text(500),
  occurredOn: isoDate,
});

export type FeeAgreementInput = z.input<typeof FeeAgreementInput>;
export type InvoiceLine = z.input<typeof InvoiceLine>;
export type InvoiceInput = z.input<typeof InvoiceInput>;
export type PaymentRecord = z.input<typeof PaymentRecord>;
export type LedgerEntry = z.input<typeof LedgerEntry>;
