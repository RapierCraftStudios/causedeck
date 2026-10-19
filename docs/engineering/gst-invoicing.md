# GST invoicing

How CauseDeck's SaaS invoices meet the GST tax-invoice rules (#29, #253, #254). This covers only the
invoices CauseDeck issues to its own customers for the subscription. Fee invoices that advocates issue
to their clients are separate (#83).

Every rule interpretation below is the engineering reading of the law, not advice. Items marked
`needs CA review` must be signed off by a chartered accountant (or counsel) before the first real
invoice is issued. The real supplier entity data is a separate needs-human step (#109).

## Where the code lives

| Piece | Path |
| --- | --- |
| Tax calculation | `packages/billing/src/gst/calc.ts` (`calcGst`) |
| State codes | `packages/billing/src/gst/state-codes.ts` |
| SAC | `packages/billing/src/gst/sac.ts` |
| Invoice numbering | `packages/billing/src/invoice/numbering.ts` |
| Issuing (snapshot, tax, number) | `packages/billing/src/invoice/generate.ts` (`issueInvoice`) |
| Supplier | `packages/billing/src/config/supplier.ts` (server-only) |
| Amount in words | `packages/billing/src/invoice/amount-in-words.ts` |
| PDF layout | `packages/billing/src/invoice/template.tsx` (server-only) |
| PDF rendering | `packages/billing/src/invoice/render-pdf.tsx` (`renderInvoicePdf`, server-only) |
| Golden test | `packages/billing/src/__tests__/invoice-pdf.test.ts` |

The PDF renders the stored `saas_invoice` snapshot. It never recomputes tax, so a reprint always
matches the issued invoice. Issued invoices are immutable (void and reissue only, see
[billing.md](billing.md)).

## Field-by-field mapping

Rule 46 of the CGST Rules 2017 lists what a tax invoice must contain. The golden test renders three
invoices (inter-state, intra-state, unregistered recipient with the TEST supplier), extracts the PDF
text and asserts each field below.

| Rule 46 | Requirement | Printed as | Source |
| --- | --- | --- | --- |
| (a) | Supplier name, address and GSTIN | "Supplier" block: legal name, address, `GSTIN: …` | `invoice.supplier` (from `BILLING_SUPPLIER_*`) |
| (b) | Consecutive serial number, at most 16 characters, unique for the financial year | `Invoice No.: CD/26-27/000001` | `invoice.number` (`numbering.ts`) |
| (c) | Date of issue | `Invoice Date: 01 May 2026` | `invoice.issueDate` (India-time date) |
| (d) | Recipient name, address and GSTIN, if registered | "Bill to" block; `GSTIN: …` only when the recipient has one | `invoice.recipient` |
| (e) | For an unregistered recipient and a taxable value over Rs. 50,000: name, address, and state name and code | Recipient name and address, and `Place of Supply: Maharashtra (27)` | `invoice.recipient`, `invoice.placeOfSupplyStateCode`. `needs CA review`: no billing address is captured for unregistered recipients yet, so the address is the workspace snapshot |
| (f) | HSN code or SAC | `SAC` column on each line | `invoice.sac` (`998314` default, `BILLING_SAC`). `needs CA review` |
| (g) | Description of the service | `Description` column | `line.description` |
| (h) | Quantity | `Qty` column | `line.quantity` |
| (i) | Total value | `Rate` and the line `Taxable Value` | `line.unitPricePaise`, `line.amountPaise` |
| (j) | Taxable value after discounts | `Taxable Value` total | `invoice.taxablePaise` (no discounts today) |
| (k), (l) | Rate and amount of tax | `CGST @ 9%` + `SGST @ 9%` (intra-state) or `IGST @ 18%` (inter-state), each with its amount | `invoice.cgstPaise`, `sgstPaise`, `igstPaise` |
| (m) | Place of supply with state name, for inter-state supplies | `Place of Supply: Delhi (07)`, printed on every invoice | `GST_STATE_CODES` |
| (n) | Delivery address, if different from the place of supply | Not applicable: an online service, nothing is delivered | |
| (o) | Whether tax is payable on reverse charge | "Tax is not payable on reverse charge basis." | Fixed text. `needs CA review` |
| (p) | Signature or digital signature of the supplier | Omitted: "This is a computer-generated invoice." | `needs CA review`. Rule 46 requires a signature or digital signature unless the invoice is an e-invoice. Options are a DSC on the PDF or IRN e-invoicing |
| | Total in figures and words (convention, required by #29) | `Total (INR) Rs. 1,17,999.99` and `Amount in words: Rupees One Lakh …` | `invoice.totalPaise`, `amountInWords` |

## Numbering

- Format `SERIES/YY-YY/NNNNNN`, e.g. `CD/26-27/000001`: 15 characters, inside the 16 that rule 46(b)
  allows. The series (`BILLING_INVOICE_SERIES`, 1-3 capitals) defaults to `CD`.
- The financial year runs from 1 April to 31 March in India time, so numbering restarts at
  `000001` at 00:00 IST on 1 April.
- Numbers come from `invoice_counter(series, fy)` under a row lock in the same transaction that writes
  the invoice. Concurrent issuances queue on the lock, and a rollback releases the number, so the
  series is gapless.
- Voided invoices keep their number. A reissue gets a new number. `needs CA review`: whether voids
  need a credit note instead (credit notes are out of scope).

## Rounding

- All amounts are integer paise. Tax is computed once on the invoice's taxable value:
  `tax = round-half-up(taxable × 18%)` to the paisa.
- Intra-state: `cgst = floor(tax / 2)` and `sgst = tax − cgst`. SGST carries the odd paisa, so CGST +
  SGST always equals the rounded 18%. Inter-state: all of it is IGST.
- `total = taxable + cgst + sgst + igst`, printed to the paisa. There is no rounding to whole rupees.
- `needs CA review`: rounding per invoice rather than per line, the odd paisa going to SGST, and not
  rounding the total to the rupee.
- Amount in words: Indian grouping (crore, lakh, thousand), e.g. `Rupees One Thousand One Hundred
  Eighty and Fifty Paise Only`. It is spelled from the stored total.

## Place of supply

- The recipient's GSTIN state if they have one. Otherwise the supplier's state, because no billing
  address is captured yet. `needs CA review`: for unregistered recipients, the place of supply for
  online services should be the recipient's address on record.
- Same state as the supplier is intra-state (CGST + SGST). Different is inter-state (IGST).

## TEST supplier

Outside production, an unset supplier is the TEST supplier: legal name `TEST SUPPLIER - NOT A
VALID TAX INVOICE`, GSTIN `27AAAAA0000A1Z2`. Its PDFs carry a red `TEST - NOT A VALID TAX INVOICE`
banner. In production, issuing refuses with `SupplierNotConfiguredError` until the real supplier is
configured.

## PDF

- A4, one page, built-in Helvetica. Amounts print as `Rs.` because Helvetica has no rupee glyph.
- `@causedeck/billing/invoice/render-pdf` and `/invoice/template` are server-only subpath exports.
  They are never in the package barrel, which apps/web loads in client code. The web route that
  imports them (#258) must list `@react-pdf/renderer` in `serverExternalPackages`.

## Out of scope

- E-invoicing (IRN and signed QR code), required only above the turnover threshold. `needs CA review`
  once turnover is known.
- Credit and debit notes, discounts, multi-currency, export of services (LUT, zero-rated).
- Reverse charge supplies: SaaS sold by CauseDeck is forward charge.
