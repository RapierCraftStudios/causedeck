// Issuing a SaaS tax invoice (#253, #29). `issueInvoice` is the order of operations; storage is the
// `InvoiceStore` port, implemented on the database by `@causedeck/core` (this package never touches
// the database). The core adapter runs every store call in one workspace transaction, so a failure
// anywhere rolls back the invoice and its number together.
//
// Order: validate, resolve the supplier (a production refusal happens before anything is written or
// numbered), snapshot the recipient (the subscription's GSTIN as it is now; later edits never touch
// an issued invoice), compute GST, allocate the number, insert the draft with its lines (the 0017
// trigger only accepts lines on a draft), then mark it issued.
import type { SupplierConfig } from '../config/supplier';
import { normalizeGstin } from '../gstin';
import { calcGst } from '../gst/calc';
import { stateCodeFromGstin } from '../gst/state-codes';

import {
  financialYear,
  formatInvoiceNumber,
  invoiceIssueDate,
  type InvoiceNumberAllocator,
} from './numbering';

/** Supplier or recipient snapshot (matches `saas_invoice.supplier` / `.recipient`). */
export interface InvoiceParty {
  legalName: string;
  address: string;
  gstin: string | null;
  stateCode: string;
}

export interface SaasInvoiceLineInput {
  description: string;
  quantity: number;
  /** Integer paise, ex-GST. */
  unitPricePaise: number;
}

export interface SaasInvoiceLine extends SaasInvoiceLineInput {
  /** `quantity × unitPricePaise`. */
  amountPaise: number;
}

export interface IssueInvoiceInput {
  subscriptionId: string;
  /** A `YYYY-MM-DD` date, or an instant read as an India-time date. */
  periodStart: string | Date;
  periodEnd: string | Date;
  lines: readonly SaasInvoiceLineInput[];
  /** The provider payment this invoice bills (#255); one invoice per payment. */
  providerPaymentId?: string | null;
}

export interface SaasInvoice {
  id: string;
  subscriptionId: string;
  number: string;
  series: string;
  fy: string;
  status: 'issued';
  issueDate: string;
  periodStart: string;
  periodEnd: string;
  supplier: InvoiceParty;
  recipient: InvoiceParty;
  placeOfSupplyStateCode: string;
  sac: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  currency: 'INR';
  lines: SaasInvoiceLine[];
  /** Set when the invoice was issued for a provider payment (#255). */
  providerPaymentId?: string | null;
}

/** A draft as handed to `InvoiceStore.insertDraft`: everything but the id, number and issue date. */
export type SaasInvoiceDraft = Omit<SaasInvoice, 'id' | 'number' | 'issueDate' | 'status'>;

/** The recipient as stored on the subscription's workspace now. */
export interface InvoiceRecipientRecord {
  name: string;
  address?: string | null;
  gstin: string | null;
}

export interface InvoiceStore extends InvoiceNumberAllocator {
  /** The recipient of `subscriptionId` in the current workspace, or null when there is none. */
  loadRecipient(subscriptionId: string): Promise<InvoiceRecipientRecord | null>;
  /** Insert the invoice as `draft` with its lines; returns its id. */
  insertDraft(draft: SaasInvoiceDraft): Promise<string>;
  /** Move the draft to `issued` with its number and issue date. */
  markIssued(id: string, number: string, issueDate: string): Promise<void>;
}

export interface IssueInvoiceContext {
  store: InvoiceStore;
  /** Resolves (or refuses) the supplier; called before any write. */
  supplier: () => SupplierConfig;
  now?: () => Date;
}

export type InvoiceIssueErrorCode = 'INVALID_INPUT' | 'SUBSCRIPTION_NOT_FOUND';

export class InvoiceIssueError extends Error {
  readonly code: InvoiceIssueErrorCode;

  constructor(code: InvoiceIssueErrorCode, message: string) {
    super(message);
    this.name = 'InvoiceIssueError';
    this.code = code;
  }
}

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const invalid = (message: string) => new InvoiceIssueError('INVALID_INPUT', message);

function toDate(value: string | Date, field: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalid(`${field} is not a valid date`);
    return invoiceIssueDate(value);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!DATE_PATTERN.test(value) || Number.isNaN(parsed.getTime())) {
    throw invalid(`${field} must be a YYYY-MM-DD date`);
  }
  if (parsed.toISOString().slice(0, 10) !== value) throw invalid(`${field} is not a real date`);
  return value;
}

function toLines(lines: readonly SaasInvoiceLineInput[]): SaasInvoiceLine[] {
  if (lines.length === 0) throw invalid('An invoice needs at least one line');
  return lines.map((line, i) => {
    const description = line.description.trim();
    if (description === '') throw invalid(`Line ${String(i + 1)} needs a description`);
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw invalid(`Line ${String(i + 1)} quantity must be a positive integer`);
    }
    if (!Number.isSafeInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
      throw invalid(`Line ${String(i + 1)} unit price must be a non-negative integer of paise`);
    }
    const amountPaise = line.quantity * line.unitPricePaise;
    if (!Number.isSafeInteger(amountPaise)) throw invalid(`Line ${String(i + 1)} is too large`);
    return {
      description,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      amountPaise,
    };
  });
}

/** Issue a GST tax invoice for one billing period of a subscription. */
export async function issueInvoice(
  ctx: IssueInvoiceContext,
  input: IssueInvoiceInput,
): Promise<SaasInvoice> {
  const periodStart = toDate(input.periodStart, 'periodStart');
  const periodEnd = toDate(input.periodEnd, 'periodEnd');
  if (periodEnd < periodStart) throw invalid('periodEnd is before periodStart');
  const lines = toLines(input.lines);
  const taxablePaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);

  const supplier = ctx.supplier();
  const supplierParty: InvoiceParty = {
    legalName: supplier.legalName,
    address: supplier.address,
    gstin: supplier.gstin,
    stateCode: supplier.stateCode,
  };

  const record = await ctx.store.loadRecipient(input.subscriptionId);
  if (!record) {
    throw new InvoiceIssueError(
      'SUBSCRIPTION_NOT_FOUND',
      `Subscription ${input.subscriptionId} not found in this workspace`,
    );
  }
  const gstin = normalizeGstin(record.gstin);
  // Place of supply: the registered recipient's state, else the supplier's (no address on record).
  const recipient: InvoiceParty = {
    legalName: record.name,
    address: record.address ?? '',
    gstin,
    stateCode: gstin === null ? supplier.stateCode : stateCodeFromGstin(gstin),
  };
  const placeOfSupplyStateCode = recipient.stateCode;

  const gst = calcGst({
    taxable: taxablePaise,
    supplierState: supplier.stateCode,
    placeOfSupply: placeOfSupplyStateCode,
  });

  const now = ctx.now?.() ?? new Date();
  const fy = financialYear(now);
  const issueDate = invoiceIssueDate(now);
  const sequence = await ctx.store.allocate(supplier.series, fy);
  const number = formatInvoiceNumber(supplier.series, fy, sequence);

  const draft: SaasInvoiceDraft = {
    subscriptionId: input.subscriptionId,
    series: supplier.series,
    fy,
    periodStart,
    periodEnd,
    supplier: supplierParty,
    recipient,
    placeOfSupplyStateCode,
    sac: supplier.sac,
    taxablePaise,
    cgstPaise: gst.cgst,
    sgstPaise: gst.sgst,
    igstPaise: gst.igst,
    totalPaise: gst.total,
    currency: 'INR',
    lines,
    ...(input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : {}),
  };
  const id = await ctx.store.insertDraft(draft);
  await ctx.store.markIssued(id, number, issueDate);
  return { ...draft, id, number, issueDate, status: 'issued' };
}
