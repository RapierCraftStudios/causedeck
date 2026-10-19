// Golden GST invoice PDF test (#254, #29): render real invoices, extract the PDF text and assert
// every mandatory field (docs/engineering/gst-invoicing.md) is printed.
import { readFileSync } from 'node:fs';

import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';

import { TEST_SUPPLIER_GSTIN, TEST_SUPPLIER_LEGAL_NAME } from '../config/supplier';
import { calcGst } from '../gst/calc';
import * as barrel from '../index';
import { amountInWords } from '../invoice/amount-in-words';
import type { InvoiceParty, SaasInvoice } from '../invoice/generate';
import { renderInvoicePdf } from '../invoice/render-pdf';
import { TEST_INVOICE_BANNER } from '../invoice/template';

const SUPPLIER: InvoiceParty = {
  legalName: 'CauseDeck Technologies Pvt Ltd',
  address: '12 MG Road, Bengaluru, Karnataka 560001',
  gstin: '29AAGCB7383J1Z4',
  stateCode: '29',
};

const TEST_SUPPLIER: InvoiceParty = {
  legalName: TEST_SUPPLIER_LEGAL_NAME,
  address: 'TEST ADDRESS - development only, Mumbai, Maharashtra',
  gstin: TEST_SUPPLIER_GSTIN,
  stateCode: '27',
};

function invoice(
  supplier: InvoiceParty,
  recipient: InvoiceParty,
  placeOfSupply: string,
  quantity: number,
  unitPricePaise: number,
): SaasInvoice {
  const taxable = quantity * unitPricePaise;
  const gst = calcGst({ taxable, supplierState: supplier.stateCode, placeOfSupply });
  return {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    number: 'CD/26-27/000042',
    series: 'CD',
    fy: '26-27',
    status: 'issued',
    issueDate: '2026-05-01',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
    supplier,
    recipient,
    placeOfSupplyStateCode: placeOfSupply,
    sac: '998314',
    taxablePaise: taxable,
    cgstPaise: gst.cgst,
    sgstPaise: gst.sgst,
    igstPaise: gst.igst,
    totalPaise: gst.total,
    currency: 'INR',
    lines: [
      { description: 'Chamber plan, April 2026', quantity, unitPricePaise, amountPaise: taxable },
    ],
  };
}

interface Golden {
  name: string;
  invoice: SaasInvoice;
  expected: string[];
  absent: string[];
  test: boolean;
}

const GOLDEN: Golden[] = [
  {
    // 3 × 999 = 2,997.00; IGST 539.46; total 3,536.46.
    name: 'inter-state, registered recipient: IGST 18%',
    invoice: invoice(
      SUPPLIER,
      {
        legalName: 'Sharma Chambers',
        address: '21 Lawyers Chambers, Patiala House Courts, New Delhi',
        gstin: '07AAACS1234A1Z5',
        stateCode: '07',
      },
      '07',
      3,
      99_900,
    ),
    expected: [
      'GSTIN: 07AAACS1234A1Z5',
      'Place of Supply: Delhi (07)',
      '3 Rs. 999.00 Rs. 2,997.00',
      'IGST @ 18% Rs. 539.46',
      'Total (INR) Rs. 3,536.46',
    ],
    absent: ['CGST', 'SGST'],
    test: false,
  },
  {
    // 1 × 99,999.99 = taxable 99,999.99; tax round-half-up(17,999.9982) = 18,000.00 → 9,000.00 each.
    name: 'intra-state, registered recipient: CGST 9% + SGST 9%',
    invoice: invoice(
      SUPPLIER,
      {
        legalName: 'Iyer & Rao Advocates LLP',
        address: '4 Residency Road, Bengaluru',
        gstin: '29AABFI1234K1Z2',
        stateCode: '29',
      },
      '29',
      1,
      99_99_999,
    ),
    expected: [
      'GSTIN: 29AABFI1234K1Z2',
      'Place of Supply: Karnataka (29)',
      '1 Rs. 99,999.99 Rs. 99,999.99',
      'CGST @ 9% Rs. 9,000.00',
      'SGST @ 9% Rs. 9,000.00',
      'Total (INR) Rs. 1,17,999.99',
    ],
    absent: ['IGST'],
    test: false,
  },
  {
    // 2 × 1,234.57 = 2,469.14; tax round-half-up(444.4452) = 444.45 → CGST 222.22, SGST 222.23.
    name: 'unregistered recipient, TEST supplier: intra-state at the supplier state',
    invoice: invoice(
      TEST_SUPPLIER,
      {
        legalName: 'Adv. Meera Nair',
        address: 'Flat 7, Shanti Niwas, Dadar, Mumbai',
        gstin: null,
        stateCode: '27',
      },
      '27',
      2,
      1_23_457,
    ),
    expected: [
      'Place of Supply: Maharashtra (27)',
      '2 Rs. 1,234.57 Rs. 2,469.14',
      'CGST @ 9% Rs. 222.22',
      'SGST @ 9% Rs. 222.23',
      'Total (INR) Rs. 2,913.59',
    ],
    absent: ['IGST'],
    test: true,
  },
];

const INTER_STATE = GOLDEN[0]?.invoice as SaasInvoice;

/** Extracted text with whitespace (line breaks between PDF runs) collapsed to single spaces. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(bytes.slice(), { mergePages: true });
  return text.replace(/\s+/g, ' ');
}

describe('renderInvoicePdf', () => {
  for (const golden of GOLDEN) {
    describe(golden.name, () => {
      it('prints every mandatory GST field', async () => {
        const inv = golden.invoice;
        const bytes = await renderInvoicePdf(inv);
        const text = await pdfText(bytes);

        // Rule 46 fields, in the order docs/engineering/gst-invoicing.md lists them.
        expect(text).toContain('Tax Invoice');
        expect(text).toContain(inv.supplier.legalName);
        expect(text).toContain(inv.supplier.address);
        expect(text).toContain(`GSTIN: ${inv.supplier.gstin ?? ''}`);
        expect(text).toContain('Invoice No.: CD/26-27/000042');
        expect(text).toContain('Invoice Date: 01 May 2026');
        expect(text).toContain('Billing Period: 01 Apr 2026 to 30 Apr 2026');
        expect(text).toContain(inv.recipient.legalName);
        expect(text).toContain(inv.recipient.address);
        expect(text).toContain('Description SAC Qty Rate Taxable Value');
        for (const line of inv.lines) {
          expect(text).toContain(`${line.description} 998314 ${String(line.quantity)} Rs.`);
        }
        expect(text).toContain(`Amount in words: ${amountInWords(inv.totalPaise)}`);
        for (const value of golden.expected) expect(text).toContain(value);
        for (const value of golden.absent) expect(text).not.toContain(value);

        // The recipient GSTIN label is printed only when the recipient has one.
        const gstinLabels = text.match(/GSTIN: /g) ?? [];
        expect(gstinLabels).toHaveLength(inv.recipient.gstin === null ? 1 : 2);

        if (golden.test) expect(text).toContain(TEST_INVOICE_BANNER);
        else expect(text).not.toContain(TEST_INVOICE_BANNER);
      });

      it('is a single A4 page', async () => {
        const bytes = await renderInvoicePdf(golden.invoice);
        expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
        const doc = await getDocumentProxy(bytes.slice());
        expect(doc.numPages).toBe(1);
        const page = await doc.getPage(1);
        const [, , width, height] = page.view;
        expect(width).toBeCloseTo(595.28, 1);
        expect(height).toBeCloseTo(841.89, 1);
      });
    });
  }

  it('prints the words of the stored total, never a recomputed one', async () => {
    const inv = { ...INTER_STATE, totalPaise: 1_00_00_000_00 };
    const text = await pdfText(await renderInvoicePdf(inv));
    expect(text).toContain('Total (INR) Rs. 1,00,00,000.00');
    expect(text).toContain('Rupees One Crore Only');
  });

  it('shows the TEST banner when flagged, whatever the supplier name', async () => {
    const text = await pdfText(await renderInvoicePdf({ ...INTER_STATE, isTestSupplier: true }));
    expect(text).toContain(TEST_INVOICE_BANNER);
  });

  it('stays out of the client-safe package barrel', () => {
    expect(barrel).not.toHaveProperty('renderInvoicePdf');
    expect(barrel).not.toHaveProperty('InvoiceDocument');
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/render-pdf|template|@react-pdf/);
  });
});
