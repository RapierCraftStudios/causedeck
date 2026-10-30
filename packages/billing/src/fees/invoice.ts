// Fee invoices (#83, part 2): pricing and numbering, pure. Numbers come from a port that the
// `@causedeck/core` adapter backs with a row-locked counter inside the issuing transaction, so a
// rolled-back issuance releases its number and the series stays gapless per series and year.
import { InvoiceInput } from '@causedeck/validators/fees';

import {
  type InvoiceNumberAllocator,
  financialYear,
  formatInvoiceNumber,
  invoiceIssueDate,
} from '../invoice/numbering';

import { type FeeGstBreakdown, computeGst } from './gst';

/** The fee series; the SaaS series is `CD`. */
export const FEE_INVOICE_SERIES = 'FE';

export interface FeeSupplier {
  name: string;
  /** Two-digit GST state code. */
  stateCode: string;
  /** Null or absent when the advocate is not GST registered. */
  gstin?: string | null;
}

export interface PreparedFeeLine {
  description: string;
  quantity: number;
  unitPricePaise: number;
  amountPaise: number;
  sac?: string;
  gst: FeeGstBreakdown;
}

export interface PreparedFeeInvoice {
  matterId: string;
  personId: string;
  supplier: FeeSupplier;
  placeOfSupplyStateCode: string;
  recipientGstin?: string;
  dueDate?: string;
  lines: PreparedFeeLine[];
  taxablePaise: number;
  cgst: number;
  sgst: number;
  igst: number;
  rcmPaise: number;
  totalPaise: number;
  /** Set by `numberInvoice` when the invoice is issued. */
  number?: string;
  issueDate?: string;
}

/** Validates `input` and prices each line. A supplier without a GSTIN charges no GST. */
export function prepareInvoice(input: unknown, supplier: FeeSupplier): PreparedFeeInvoice {
  const parsed = InvoiceInput.parse(input);
  const registered = Boolean(supplier.gstin);
  const lines = parsed.lines.map((line): PreparedFeeLine => {
    const gst = computeGst({
      taxablePaise: line.amountPaise,
      treatment: registered ? line.gstTreatment : 'unregistered',
      supplierState: supplier.stateCode,
      placeOfSupply: parsed.placeOfSupplyStateCode,
    });
    return {
      description: line.description,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      amountPaise: line.amountPaise,
      ...(line.sac ? { sac: line.sac } : {}),
      gst,
    };
  });
  const sum = (pick: (line: PreparedFeeLine) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  const totalPaise = sum((line) => line.gst.total);
  if (!Number.isSafeInteger(totalPaise)) throw new RangeError('prepareInvoice: total too large');
  return {
    matterId: parsed.matterId,
    personId: parsed.personId,
    supplier,
    placeOfSupplyStateCode: parsed.placeOfSupplyStateCode,
    ...(parsed.recipientGstin ? { recipientGstin: parsed.recipientGstin } : {}),
    ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
    lines,
    taxablePaise: sum((line) => line.amountPaise),
    cgst: sum((line) => line.gst.cgst),
    sgst: sum((line) => line.gst.sgst),
    igst: sum((line) => line.gst.igst),
    rcmPaise: sum((line) => line.gst.rcmPaise),
    totalPaise,
  };
}

/** The next gapless `FE/YY-YY/NNNNNN` number for the financial year of `date` (India time). */
export async function numberInvoice(
  allocator: InvoiceNumberAllocator,
  date: Date,
  series: string = FEE_INVOICE_SERIES,
): Promise<{ number: string; issueDate: string }> {
  const fy = financialYear(date);
  const sequence = await allocator.allocate(series, fy);
  return { number: formatInvoiceNumber(series, fy, sequence), issueDate: invoiceIssueDate(date) };
}
