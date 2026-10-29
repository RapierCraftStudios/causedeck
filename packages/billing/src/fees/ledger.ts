// Client ledger maths (#83, part 2): records of money the advocate spent or was paid, and the
// balance they imply. Pure; the caller persists the entries. A debit raises what the client owes,
// a credit lowers it.
import { LedgerEntry } from '@causedeck/validators/fees';

export interface ExpenseInput {
  personId: string;
  matterId?: string;
  invoiceId?: string;
  amountPaise: number;
  description: string;
  occurredOn: string;
}

/** A disbursement the advocate paid on the client's behalf: a debit. */
export function recordExpense(input: ExpenseInput): LedgerEntry {
  return LedgerEntry.parse({ ...input, kind: 'disbursement', direction: 'debit' });
}

export interface ReceiptInput {
  personId: string;
  matterId?: string;
  invoiceId?: string;
  amountPaise: number;
  /** A reference such as a UPI id or cheque number. */
  reference?: string;
  receivedOn: string;
}

/** Money received from the client: a credit. */
export function recordReceipt(input: ReceiptInput): LedgerEntry {
  const { reference, receivedOn, ...rest } = input;
  return LedgerEntry.parse({
    ...rest,
    kind: 'receipt',
    direction: 'credit',
    description: reference ? `Receipt ${reference}` : 'Receipt',
    occurredOn: receivedOn,
  });
}

/** What the client owes, in paise: debits minus credits. Negative means the client is in credit. */
export function clientBalance(entries: readonly LedgerEntry[]): number {
  let balance = 0;
  for (const entry of entries) {
    balance += entry.direction === 'debit' ? entry.amountPaise : -entry.amountPaise;
    if (!Number.isSafeInteger(balance)) throw new RangeError('clientBalance: balance overflow');
  }
  return balance;
}
