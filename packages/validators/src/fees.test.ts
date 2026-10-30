// Fees inputs (#83): integer paise, GST treatments, line maths, strict objects.
import { describe, expect, it } from 'vitest';

import {
  FeeAgreementInput,
  GST_TREATMENTS,
  GstTreatmentSchema,
  InvoiceInput,
  InvoiceLine,
  LedgerEntry,
  PaymentRecord,
} from './fees';

const id = '8c5ab3c2-6a7e-4a43-8c4d-3f1b2d9b7a10';
const line = {
  description: 'Appearance fee',
  quantity: 2,
  unitPricePaise: 500000,
  amountPaise: 1000000,
  gstTreatment: 'forward_charge',
};

describe('GstTreatment', () => {
  it.each(GST_TREATMENTS)('accepts %s', (value) => {
    expect(GstTreatmentSchema.safeParse(value).success).toBe(true);
  });
  it('rejects an unknown treatment', () => {
    expect(GstTreatmentSchema.safeParse('zero_rated').success).toBe(false);
  });
});

describe('FeeAgreementInput', () => {
  const base = {
    matterId: id,
    personId: id,
    basis: 'fixed',
    amountPaise: 2500000,
    gstTreatment: 'forward_charge',
    startsOn: '2026-04-01',
  };
  it('accepts a valid agreement', () => {
    expect(FeeAgreementInput.safeParse(base).success).toBe(true);
  });
  it('rejects an end date before the start, fractional paise and unknown keys', () => {
    expect(FeeAgreementInput.safeParse({ ...base, endsOn: '2026-03-01' }).success).toBe(false);
    expect(FeeAgreementInput.safeParse({ ...base, amountPaise: 10.5 }).success).toBe(false);
    expect(FeeAgreementInput.safeParse({ ...base, amountPaise: -1 }).success).toBe(false);
    expect(FeeAgreementInput.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('InvoiceLine and InvoiceInput', () => {
  it('requires the amount to be quantity times unit price', () => {
    expect(InvoiceLine.safeParse(line).success).toBe(true);
    expect(InvoiceLine.safeParse({ ...line, amountPaise: 1 }).success).toBe(false);
  });
  it('needs a line and a well-formed GSTIN', () => {
    const base = { matterId: id, personId: id, placeOfSupplyStateCode: '29', lines: [line] };
    expect(InvoiceInput.safeParse(base).success).toBe(true);
    expect(InvoiceInput.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(InvoiceInput.safeParse({ ...base, recipientGstin: '29ABCDE1234F1Z5' }).success).toBe(
      true,
    );
    expect(InvoiceInput.safeParse({ ...base, recipientGstin: 'nope' }).success).toBe(false);
  });
});

describe('PaymentRecord and LedgerEntry', () => {
  it('rejects a zero payment', () => {
    const base = { invoiceId: id, amountPaise: 100, method: 'upi', receivedOn: '2026-05-01' };
    expect(PaymentRecord.safeParse(base).success).toBe(true);
    expect(PaymentRecord.safeParse({ ...base, amountPaise: 0 }).success).toBe(false);
  });
  it('needs a direction and a positive amount', () => {
    const base = {
      personId: id,
      kind: 'disbursement',
      direction: 'debit',
      amountPaise: 5000,
      description: 'Court fee',
      occurredOn: '2026-05-01',
    };
    expect(LedgerEntry.safeParse(base).success).toBe(true);
    expect(LedgerEntry.safeParse({ ...base, direction: 'sideways' }).success).toBe(false);
    expect(LedgerEntry.safeParse({ ...base, amountPaise: 0 }).success).toBe(false);
  });
});
