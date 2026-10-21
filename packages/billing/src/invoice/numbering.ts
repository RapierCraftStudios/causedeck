// SaaS invoice numbering (#253, #29): `CD/26-27/000001`, gapless per series and financial year.
// The financial year runs 1 April to 31 March in India time, so the series resets at 00:00 IST on
// 1 April. GST caps an invoice number at 16 characters; `CD/26-27/000001` is 15.
//
// Allocation is a port: the `@causedeck/core` adapter increments `invoice_counter` under a row lock
// (`SELECT ... FOR UPDATE`) inside the transaction that writes the invoice, so a rolled-back
// issuance releases its number and the series stays gapless.

const IST_OFFSET_MS = 330 * 60 * 1000;

/** GST invoice numbers are at most 16 characters. */
export const INVOICE_NUMBER_MAX_LENGTH = 16;
/** The running number is zero-padded to six digits. */
export const INVOICE_SEQUENCE_DIGITS = 6;
export const MAX_INVOICE_SEQUENCE = 10 ** INVOICE_SEQUENCE_DIGITS - 1;
/** One to three capitals, so `SERIES/YY-YY/NNNNNN` fits in 16 characters. */
export const INVOICE_SERIES_PATTERN = /^[A-Z]{1,3}$/;
export const FINANCIAL_YEAR_PATTERN = /^[0-9]{2}-[0-9]{2}$/;

const NUMBER_PATTERN = /^([A-Z]{1,3})\/([0-9]{2}-[0-9]{2})\/([0-9]{6})$/;

/** Allocates the next number of a series and financial year, inside the issuing transaction. */
export interface InvoiceNumberAllocator {
  allocate(series: string, fy: string): Promise<number>;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function ist(date: Date): Date {
  if (Number.isNaN(date.getTime())) throw new RangeError('invoice numbering: invalid date');
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** The financial year (April–March, India time) of `date`, as `YY-YY` (e.g. `26-27`). */
export function financialYear(date: Date): string {
  const local = ist(date);
  const year = local.getUTCFullYear();
  const start = local.getUTCMonth() >= 3 ? year : year - 1;
  return `${pad(start % 100, 2)}-${pad((start + 1) % 100, 2)}`;
}

/** The invoice date of `date` in India time, as `YYYY-MM-DD`. */
export function invoiceIssueDate(date: Date): string {
  return ist(date).toISOString().slice(0, 10);
}

export function isInvoiceSeries(series: string): boolean {
  return INVOICE_SERIES_PATTERN.test(series);
}

/** `SERIES/YY-YY/NNNNNN`. Throws when a part is invalid or the number would exceed 16 characters. */
export function formatInvoiceNumber(series: string, fy: string, sequence: number): string {
  if (!isInvoiceSeries(series)) {
    throw new RangeError(`Invalid invoice series ${JSON.stringify(series)}: expected A-Z, 1-3`);
  }
  if (!FINANCIAL_YEAR_PATTERN.test(fy)) {
    throw new RangeError(`Invalid financial year ${JSON.stringify(fy)}: expected YY-YY`);
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_INVOICE_SEQUENCE) {
    throw new RangeError(
      `Invoice sequence ${String(sequence)} is outside 1..${String(MAX_INVOICE_SEQUENCE)}`,
    );
  }
  const number = `${series}/${fy}/${pad(sequence, INVOICE_SEQUENCE_DIGITS)}`;
  if (number.length > INVOICE_NUMBER_MAX_LENGTH) {
    throw new RangeError(`Invoice number ${number} exceeds 16 characters`);
  }
  return number;
}

export interface ParsedInvoiceNumber {
  series: string;
  fy: string;
  sequence: number;
}

/** The inverse of `formatInvoiceNumber`, or null when `value` is not an invoice number. */
export function parseInvoiceNumber(value: string): ParsedInvoiceNumber | null {
  const match = NUMBER_PATTERN.exec(value);
  if (!match) return null;
  const [, series = '', fy = '', digits = ''] = match;
  const sequence = Number(digits);
  return sequence >= 1 ? { series, fy, sequence } : null;
}
