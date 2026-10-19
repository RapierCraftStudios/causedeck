// Render an issued SaaS invoice to PDF bytes (#254, #29). Consumed by the render job (#255) and
// the download route (#258).
//
// Server-only: @react-pdf/renderer pulls in pdfkit and Node APIs. Import it as
// `@causedeck/billing/invoice/render-pdf` and never re-export it from the package barrel, which
// apps/web loads in client code.
import { renderToBuffer } from '@react-pdf/renderer';

import type { SaasInvoice } from './generate';
import { InvoiceDocument } from './template';

/** The invoice as a one-page A4 PDF. */
export async function renderInvoicePdf(
  invoice: SaasInvoice & { isTestSupplier?: boolean },
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<InvoiceDocument invoice={invoice} />);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
