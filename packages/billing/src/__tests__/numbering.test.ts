import { describe, expect, it } from 'vitest';

import { resolveSupplier, type SupplierConfig } from '../config/supplier';
import { issueInvoice, InvoiceIssueError, type IssueInvoiceInput } from '../invoice/generate';
import {
  financialYear,
  formatInvoiceNumber,
  INVOICE_NUMBER_MAX_LENGTH,
  invoiceIssueDate,
  parseInvoiceNumber,
} from '../invoice/numbering';

import { createMemoryInvoiceStore } from './invoice-memory-store';

const SUPPLIER: SupplierConfig = resolveSupplier(
  { legalName: 'CauseDeck Technologies Pvt Ltd', address: 'Bengaluru', gstin: '29AAGCB7383J1Z4' },
  { nodeEnv: 'production' },
);

const INPUT: IssueInvoiceInput = {
  subscriptionId: 'sub-1',
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  lines: [{ description: 'Chamber plan, April 2026', quantity: 3, unitPricePaise: 99_900 }],
};

function setup(gstin: string | null = null) {
  const store = createMemoryInvoiceStore();
  store.recipients.set('sub-1', { name: 'Sharma Chambers', gstin });
  return store;
}

describe('financialYear', () => {
  it('runs April to March in India time', () => {
    // 31 Mar 2027 23:59 IST is still FY 26-27; 1 Apr 2027 00:00 IST starts 27-28.
    expect(financialYear(new Date('2027-03-31T18:29:59Z'))).toBe('26-27');
    expect(financialYear(new Date('2027-03-31T18:30:00Z'))).toBe('27-28');
    expect(financialYear(new Date('2026-04-01T00:00:00+05:30'))).toBe('26-27');
    expect(financialYear(new Date('2027-01-15T12:00:00Z'))).toBe('26-27');
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('99-00');
  });

  it('dates the invoice in India time', () => {
    expect(invoiceIssueDate(new Date('2027-03-31T18:30:00Z'))).toBe('2027-04-01');
    expect(invoiceIssueDate(new Date('2027-03-31T18:29:59Z'))).toBe('2027-03-31');
  });
});

describe('formatInvoiceNumber', () => {
  it('formats CD/YY-YY/000001 within 16 characters', () => {
    const number = formatInvoiceNumber('CD', '26-27', 1);
    expect(number).toBe('CD/26-27/000001');
    expect(number).toHaveLength(15);
    expect(formatInvoiceNumber('ABC', '26-27', 999_999)).toHaveLength(INVOICE_NUMBER_MAX_LENGTH);
  });

  it('rejects overflow and invalid parts', () => {
    expect(() => formatInvoiceNumber('CD', '26-27', 0)).toThrow(RangeError);
    expect(() => formatInvoiceNumber('CD', '26-27', 1_000_000)).toThrow(RangeError);
    expect(() => formatInvoiceNumber('ABCD', '26-27', 1)).toThrow(RangeError);
    expect(() => formatInvoiceNumber('cd', '26-27', 1)).toThrow(RangeError);
    expect(() => formatInvoiceNumber('CD', '2026-27', 1)).toThrow(RangeError);
  });

  it('round-trips through parseInvoiceNumber', () => {
    expect(parseInvoiceNumber('CD/26-27/000042')).toEqual({
      series: 'CD',
      fy: '26-27',
      sequence: 42,
    });
    expect(parseInvoiceNumber('CD/26-27/000000')).toBeNull();
    expect(parseInvoiceNumber('CD-26-27-000001')).toBeNull();
  });
});

describe('issueInvoice', () => {
  it('numbers sequentially per series and FY and resets on a new FY', async () => {
    const store = setup();
    const issue = (iso: string) =>
      issueInvoice({ store, supplier: () => SUPPLIER, now: () => new Date(iso) }, INPUT);

    expect((await issue('2027-03-30T10:00:00Z')).number).toBe('CD/26-27/000001');
    expect((await issue('2027-03-31T18:29:59Z')).number).toBe('CD/26-27/000002');
    const april = await issue('2027-03-31T18:30:00Z');
    expect(april.number).toBe('CD/27-28/000001');
    expect(april.fy).toBe('27-28');
    expect(april.issueDate).toBe('2027-04-01');
  });

  it('inserts a draft with lines, then marks it issued', async () => {
    const store = setup();
    const invoice = await issueInvoice(
      { store, supplier: () => SUPPLIER, now: () => new Date('2026-05-01T06:00:00Z') },
      INPUT,
    );
    expect(store.calls).toEqual(['loadRecipient', 'allocate', 'insertDraft', 'markIssued']);
    expect(invoice).toMatchObject({
      status: 'issued',
      number: 'CD/26-27/000001',
      issueDate: '2026-05-01',
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      sac: '998314',
      taxablePaise: 299_700,
      currency: 'INR',
    });
    expect(invoice.lines).toEqual([{ ...INPUT.lines[0], amountPaise: 299_700 }]);
    expect(store.invoices[0]).toMatchObject({ status: 'issued', number: invoice.number });
  });

  it('snapshots the recipient GSTIN at issue time and picks the tax by place of supply', async () => {
    const store = setup('27AAPFU0939F1ZV');
    const ctx = { store, supplier: () => SUPPLIER, now: () => new Date('2026-05-01T06:00:00Z') };
    const inter = await issueInvoice(ctx, INPUT);
    expect(inter.recipient).toEqual({
      legalName: 'Sharma Chambers',
      address: '',
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
    });
    expect(inter.placeOfSupplyStateCode).toBe('27');
    expect(inter).toMatchObject({
      igstPaise: 53_946,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 353_646,
    });

    // A later GSTIN change reaches the next invoice only.
    store.recipients.set('sub-1', { name: 'Sharma Chambers', gstin: '29AABCU9603R1ZJ' });
    const intra = await issueInvoice(ctx, INPUT);
    expect(store.invoices[0]?.recipient.gstin).toBe('27AAPFU0939F1ZV');
    expect(intra.recipient.gstin).toBe('29AABCU9603R1ZJ');
    expect(intra).toMatchObject({ cgstPaise: 26_973, sgstPaise: 26_973, igstPaise: 0 });
  });

  it('uses the supplier state as place of supply for an unregistered recipient', async () => {
    const invoice = await issueInvoice({ store: setup(null), supplier: () => SUPPLIER }, INPUT);
    expect(invoice.recipient.gstin).toBeNull();
    expect(invoice.placeOfSupplyStateCode).toBe('29');
    expect(invoice.cgstPaise + invoice.sgstPaise).toBe(53_946);
  });

  it('rejects invalid input and unknown subscriptions before allocating a number', async () => {
    const store = setup();
    const ctx = { store, supplier: () => SUPPLIER };
    await expect(issueInvoice(ctx, { ...INPUT, lines: [] })).rejects.toThrow(InvoiceIssueError);
    await expect(
      issueInvoice(ctx, {
        ...INPUT,
        lines: [{ description: 'x', quantity: 0, unitPricePaise: 1 }],
      }),
    ).rejects.toThrow(InvoiceIssueError);
    await expect(issueInvoice(ctx, { ...INPUT, periodEnd: '2026-03-01' })).rejects.toThrow(
      InvoiceIssueError,
    );
    await expect(issueInvoice(ctx, { ...INPUT, periodStart: '2026-02-30' })).rejects.toThrow(
      InvoiceIssueError,
    );
    await expect(issueInvoice(ctx, { ...INPUT, subscriptionId: 'missing' })).rejects.toMatchObject({
      code: 'SUBSCRIPTION_NOT_FOUND',
    });
    expect(store.calls).not.toContain('allocate');
    expect(store.counters.size).toBe(0);
  });

  it('accepts period instants as India-time dates', async () => {
    const invoice = await issueInvoice(
      { store: setup(), supplier: () => SUPPLIER },
      {
        ...INPUT,
        periodStart: new Date('2026-03-31T18:30:00Z'),
        periodEnd: new Date('2026-04-30T18:29:59Z'),
      },
    );
    expect(invoice.periodStart).toBe('2026-04-01');
    expect(invoice.periodEnd).toBe('2026-04-30');
  });
});
