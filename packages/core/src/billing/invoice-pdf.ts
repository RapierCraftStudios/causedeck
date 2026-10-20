// SaaS invoice PDF download (#258, #29 part 7). The render job (#255) stores each invoice PDF
// encrypted under the workspace DEK (`storeSystemBlob`); `openSaasInvoicePdf` reads it back for the
// owner-only download route (`/w/[slug]/billing/invoices/[id]/pdf`). Authorization
// (`invoices.read`) is the caller's job.
//
// One `withWorkspace` transaction loads the invoice and its finalized blob by id AND workspace (RLS
// keeps another workspace's rows out as well), fetches the object, decrypts its first chunk (the
// envelope header and the DEK, so a destroyed key or a tampered object fails here, before any byte
// is served) and records `billing.invoice_downloaded` (security, fail-closed: an unauditable
// download is refused). Another workspace's invoice, a draft, an invoice whose PDF is not rendered
// yet and a malformed id all read as `null` (404), with nothing audited. The rest of the plaintext
// streams after the commit; the DEK is already resolved.
import { isUuid, schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import {
  decryptForWorkspace,
  type KeyProvider,
  type ObjectKey,
  type ObjectStore,
} from '@causedeck/storage';
import { and, eq, isNotNull, ne } from 'drizzle-orm';

import { record } from '../audit/index.ts';

const { blob, saasInvoice } = schema;

export interface InvoicePdfContext {
  db: Database | Transaction;
  store: ObjectStore;
  keys: KeyProvider;
  workspaceId: string;
  /** The downloading user (the audit actor). */
  userId: string;
  requestId?: string;
  /** Raw user agent; only its hash is stored. */
  userAgent?: string;
  ip?: string;
}

export interface SaasInvoicePdf {
  /** The invoice number, e.g. `CD/26-27/000001`. */
  number: string;
  /** The stored display name (`CD-26-27-000001.pdf`). */
  filename: string;
  mime: string;
  /** The decrypted PDF. */
  stream: ReadableStream<Uint8Array>;
}

/**
 * The decrypted PDF of invoice `invoiceId` in the context workspace, audited; `null` when there is
 * no such rendered invoice in this workspace.
 */
export async function openSaasInvoicePdf(
  ctx: InvoicePdfContext,
  invoiceId: string,
): Promise<SaasInvoicePdf | null> {
  if (!isUuid(invoiceId)) return null;
  const { workspaceId, userId } = ctx;
  return withWorkspace(ctx.db, { workspaceId, userId }, async (tx) => {
    const [invoice] = await tx
      .select({ id: saasInvoice.id, number: saasInvoice.number, pdfBlobId: saasInvoice.pdfBlobId })
      .from(saasInvoice)
      .where(
        and(
          eq(saasInvoice.id, invoiceId),
          eq(saasInvoice.workspaceId, workspaceId),
          ne(saasInvoice.status, 'draft'),
        ),
      );
    // `pdf_blob_id` is a text column (no foreign key to `blob`), so the blob is a second lookup.
    if (!invoice?.number || !invoice.pdfBlobId || !isUuid(invoice.pdfBlobId)) return null;
    const [file] = await tx
      .select({ key: blob.key, filename: blob.filename, mime: blob.mime })
      .from(blob)
      .where(
        and(
          eq(blob.id, invoice.pdfBlobId),
          eq(blob.workspaceId, workspaceId),
          isNotNull(blob.finalizedAt),
        ),
      );
    if (!file) return null;

    const object = await ctx.store.get(file.key as ObjectKey);
    const plain = decryptForWorkspace(tx, ctx.keys, workspaceId, [Buffer.from(object.body)]);
    const first = await plain.next();

    await record(
      {
        db: tx,
        workspaceId,
        actor: { userId, kind: 'user' },
        ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
        ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
        ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
      },
      {
        action: 'billing.invoice_downloaded',
        target: { kind: 'saas_invoice', id: invoice.id },
        metadata: { number: invoice.number },
      },
    );

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (first.done) controller.close();
        else controller.enqueue(new Uint8Array(first.value));
      },
      async pull(controller) {
        const next = await plain.next();
        if (next.done) controller.close();
        else controller.enqueue(new Uint8Array(next.value));
      },
      async cancel() {
        await plain.return(undefined);
      },
    });
    return { number: invoice.number, filename: file.filename, mime: file.mime, stream };
  });
}
