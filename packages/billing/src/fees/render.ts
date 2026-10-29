// Fee invoice print fallback (#83, part 2): a self-contained HTML page the browser prints to PDF.
// Every value is escaped. Pure string output, so it is safe in any runtime.
import type { PreparedFeeInvoice } from './invoice';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const rupees = (paise: number) => `Rs. ${(paise / 100).toFixed(2)}`;

export function renderFeeInvoiceHtml(invoice: PreparedFeeInvoice): string {
  const rows = invoice.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.description)}</td><td>${String(line.quantity)}</td>` +
        `<td>${rupees(line.unitPricePaise)}</td><td>${rupees(line.amountPaise)}</td></tr>`,
    )
    .join('');
  const tax = [
    ['CGST', invoice.cgst],
    ['SGST', invoice.sgst],
    ['IGST', invoice.igst],
  ]
    .filter(([, amount]) => Number(amount) > 0)
    .map(([label, amount]) => `<p>${String(label)}: ${rupees(Number(amount))}</p>`)
    .join('');
  const rcm =
    invoice.rcmPaise > 0
      ? `<p>Tax payable by the recipient on reverse charge: ${rupees(invoice.rcmPaise)}</p>`
      : '';
  const title = invoice.number ? `Invoice ${escapeHtml(invoice.number)}` : 'Invoice (draft)';
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>@page{size:A4}body{font-family:sans-serif}td,th{padding:2px 8px;text-align:left}</style>` +
    `</head><body><h1>${title}</h1>` +
    `<p>${escapeHtml(invoice.supplier.name)}${
      invoice.supplier.gstin ? ` GSTIN ${escapeHtml(invoice.supplier.gstin)}` : ''
    }</p>` +
    (invoice.issueDate ? `<p>Date: ${escapeHtml(invoice.issueDate)}</p>` : '') +
    `<p>Place of supply: ${escapeHtml(invoice.placeOfSupplyStateCode)}</p>` +
    `<table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<p>Taxable value: ${rupees(invoice.taxablePaise)}</p>${tax}${rcm}` +
    `<p><strong>Total: ${rupees(invoice.totalPaise)}</strong></p></body></html>`
  );
}
