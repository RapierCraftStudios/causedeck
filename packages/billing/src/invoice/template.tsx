// The GST tax-invoice PDF layout (#254, #29): one A4 page per SaaS invoice, printing every field
// rule 46 of the CGST Rules 2017 requires (mapping in docs/engineering/gst-invoicing.md). It
// renders the stored `SaasInvoice` snapshot only and never recomputes tax.
//
// Server-only (@react-pdf/renderer), so it is a subpath export and not in the package barrel.
// Fonts are the built-in Helvetica, which has no rupee glyph: amounts print as "Rs.".
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import { TEST_SUPPLIER_LEGAL_NAME } from '../config/supplier';
import { isIntraState } from '../gst/calc';
import { GST_STATE_CODES } from '../gst/state-codes';

import { amountInWords } from './amount-in-words';
import type { InvoiceParty, SaasInvoice } from './generate';

export interface InvoiceDocumentProps {
  /** The issued invoice. `isTestSupplier` forces the TEST banner (the TEST legal name does too). */
  invoice: SaasInvoice & { isTestSupplier?: boolean };
}

export const TEST_INVOICE_BANNER = 'TEST - NOT A VALID TAX INVOICE';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `2026-04-01` as `01 Apr 2026`. */
export function formatInvoiceDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const [, year, monthNumber, day] = match ?? [];
  const month = monthNumber === undefined ? undefined : MONTHS[Number(monthNumber) - 1];
  if (year === undefined || day === undefined || month === undefined)
    throw new RangeError(`formatInvoiceDate: expected YYYY-MM-DD, got ${isoDate}`);
  return `${day} ${month} ${year}`;
}

/** Integer paise as `Rs. 1,18,050.50`: Indian digit grouping, always two decimals. */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise))
    throw new RangeError(`formatPaise: expected integer paise, got ${String(paise)}`);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = String(Math.floor(abs / 100));
  const decimals = String(abs % 100).padStart(2, '0');
  const last3 = rupees.slice(-3);
  const head = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}Rs. ${head ? `${head},${last3}` : last3}.${decimals}`;
}

/** `Karnataka (29)`; an unknown code prints bare. */
export function formatStateCode(code: string): string {
  const name = GST_STATE_CODES[code];
  return name ? `${name} (${code})` : code;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Helvetica', fontSize: 9, color: '#111111' },
  banner: {
    marginBottom: 10,
    padding: 6,
    borderWidth: 1,
    borderColor: '#b91c1c',
    color: '#b91c1c',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textAlign: 'center',
  },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 16, marginBottom: 12, textAlign: 'center' },
  parties: { flexDirection: 'row', marginBottom: 12 },
  party: { flex: 1, paddingRight: 12 },
  label: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  meta: { marginBottom: 12 },
  row: { flexDirection: 'row' },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#111111',
    paddingBottom: 3,
    fontFamily: 'Helvetica-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderColor: '#999999',
  },
  colDescription: { flex: 4 },
  colSac: { flex: 1.2 },
  colQty: { flex: 0.8, textAlign: 'right' },
  colRate: { flex: 1.6, textAlign: 'right' },
  colAmount: { flex: 1.8, textAlign: 'right' },
  totals: { marginTop: 8, marginLeft: 'auto', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grandTotal: {
    fontFamily: 'Helvetica-Bold',
    borderTopWidth: 1,
    borderColor: '#111111',
    marginTop: 2,
  },
  words: { marginTop: 10 },
  footer: { marginTop: 24, color: '#555555' },
});

function Party({ heading, party }: { heading: string; party: InvoiceParty }) {
  return (
    <View style={styles.party}>
      <Text style={styles.label}>{heading}</Text>
      <Text>{party.legalName}</Text>
      <Text>{party.address}</Text>
      {party.gstin === null ? null : <Text>GSTIN: {party.gstin}</Text>}
    </View>
  );
}

function TotalRow({ label, paise, grand }: { label: string; paise: number; grand?: boolean }) {
  return (
    <View style={grand ? [styles.totalRow, styles.grandTotal] : styles.totalRow}>
      <Text>{label}</Text>
      <Text>{formatPaise(paise)}</Text>
    </View>
  );
}

/** One A4 page; see the file header. */
export function InvoiceDocument({ invoice }: InvoiceDocumentProps) {
  const isTest =
    invoice.isTestSupplier === true || invoice.supplier.legalName === TEST_SUPPLIER_LEGAL_NAME;
  // The split calcGst chose: intra-state is CGST + SGST, otherwise IGST.
  const intraState =
    invoice.igstPaise === 0 &&
    isIntraState(invoice.supplier.stateCode, invoice.placeOfSupplyStateCode);
  return (
    <Document title={`Tax Invoice ${invoice.number}`} author={invoice.supplier.legalName}>
      <Page size="A4" style={styles.page}>
        {isTest ? <Text style={styles.banner}>{TEST_INVOICE_BANNER}</Text> : null}
        <Text style={styles.title}>Tax Invoice</Text>

        <View style={styles.parties}>
          <Party heading="Supplier" party={invoice.supplier} />
          <Party heading="Bill to" party={invoice.recipient} />
        </View>

        <View style={styles.meta}>
          <Text>Invoice No.: {invoice.number}</Text>
          <Text>Invoice Date: {formatInvoiceDate(invoice.issueDate)}</Text>
          <Text>
            Billing Period: {formatInvoiceDate(invoice.periodStart)} to{' '}
            {formatInvoiceDate(invoice.periodEnd)}
          </Text>
          <Text>Place of Supply: {formatStateCode(invoice.placeOfSupplyStateCode)}</Text>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colDescription}>Description</Text>
          <Text style={styles.colSac}>SAC</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colRate}>Rate</Text>
          <Text style={styles.colAmount}>Taxable Value</Text>
        </View>
        {invoice.lines.map((line, index) => (
          <View key={index} style={styles.tableRow} wrap={false}>
            <Text style={styles.colDescription}>{line.description}</Text>
            <Text style={styles.colSac}>{invoice.sac}</Text>
            <Text style={styles.colQty}>{String(line.quantity)}</Text>
            <Text style={styles.colRate}>{formatPaise(line.unitPricePaise)}</Text>
            <Text style={styles.colAmount}>{formatPaise(line.amountPaise)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <TotalRow label="Taxable Value" paise={invoice.taxablePaise} />
          {intraState ? (
            <>
              <TotalRow label="CGST @ 9%" paise={invoice.cgstPaise} />
              <TotalRow label="SGST @ 9%" paise={invoice.sgstPaise} />
            </>
          ) : (
            <TotalRow label="IGST @ 18%" paise={invoice.igstPaise} />
          )}
          <TotalRow label="Total (INR)" paise={invoice.totalPaise} grand />
        </View>

        <Text style={styles.words}>Amount in words: {amountInWords(invoice.totalPaise)}</Text>

        <Text style={styles.footer}>
          This is a computer-generated invoice. Tax is not payable on reverse charge basis.
        </Text>
      </Page>
    </Document>
  );
}
