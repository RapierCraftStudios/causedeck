import { describe, expect, it } from 'vitest';

import { numberInvoice, prepareInvoice } from '../fees/invoice';
import { renderFeeInvoiceHtml } from '../fees/render';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = (
  lines: unknown[] = [
    {
      description: 'Drafting <b>',
      quantity: 2,
      unitPricePaise: 50_000,
      amountPaise: 100_000,
      gstTreatment: 'forward_charge',
    },
  ],
) => ({
  matterId: id(1),
  personId: id(2),
  placeOfSupplyStateCode: '27',
  lines,
});
const supplier = { name: 'A & Co', stateCode: '27', gstin: '27AAPFU0939F1ZV' };

function allocator() {
  const counters = new Map<string, number>();
  return {
    allocate: (series: string, fy: string) => {
      const key = `${series}|${fy}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve(next);
    },
  };
}

describe('prepareInvoice', () => {
  it('prices lines and totals', () => {
    const inv = prepareInvoice(input(), supplier);
    expect(inv).toMatchObject({
      taxablePaise: 100_000,
      cgst: 9000,
      sgst: 9000,
      totalPaise: 118_000,
    });
  });
  it('charges no GST for an unregistered supplier', () => {
    const inv = prepareInvoice(input(), { name: 'B', stateCode: '27' });
    expect(inv).toMatchObject({ cgst: 0, totalPaise: 100_000 });
  });
  it('rejects invalid input', () => {
    expect(() => prepareInvoice(input([]), supplier)).toThrow();
  });
});

describe('numberInvoice', () => {
  it('is gapless per series and rolls over at IST 1 April', async () => {
    const a = allocator();
    expect((await numberInvoice(a, new Date('2026-03-31T10:00:00Z'))).number).toBe(
      'FE/25-26/000001',
    );
    expect((await numberInvoice(a, new Date('2026-03-31T10:00:00Z'))).number).toBe(
      'FE/25-26/000002',
    );
    const next = await numberInvoice(a, new Date('2026-03-31T18:30:00Z'));
    expect(next).toEqual({ number: 'FE/26-27/000001', issueDate: '2026-04-01' });
  });
});

describe('renderFeeInvoiceHtml', () => {
  it('escapes values and shows the number', () => {
    const html = renderFeeInvoiceHtml({
      ...prepareInvoice(input(), supplier),
      number: 'FE/26-27/000001',
      issueDate: '2026-04-01',
    });
    expect(html).toContain('FE/26-27/000001');
    expect(html).toContain('Drafting &lt;b&gt;');
    expect(html).toContain('A &amp; Co');
    expect(html).not.toContain('<b>');
  });
});
