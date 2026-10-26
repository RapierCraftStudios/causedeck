// `billing.invoice-render` (#255, #29 part 4): renders one issued SaaS invoice to PDF, stores it
// encrypted under the workspace DEK through `@causedeck/storage` (`storeSystemBlob`: envelope
// ciphertext plus a finalized `blob` row), sets `saas_invoice.pdf_blob_id` and then enqueues
// `billing.invoice-notice`. `billing.process-event` enqueues it, with ids only, after the charge
// that issued the invoice commits.
//
// Idempotent per invoice: a set `pdf_blob_id` skips the render (the notice is still enqueued; its
// own singleton key and `once()` keep it to one email). `pdf_blob_id` is only written while null,
// so a racing render that loses removes its own blob and keeps the first. The producer enqueues
// from inside its own job transaction, so a render that runs before that commit cannot see the
// invoice yet: it throws `RetryableError` and pg-boss retries it with backoff. Logs carry ids only.
import { TEST_SUPPLIER_LEGAL_NAME } from '@causedeck/billing/config/supplier';
import { renderInvoicePdf } from '@causedeck/billing/invoice/render-pdf';
import { serverEnv } from '@causedeck/config/env';
import { schema, withWorkspace } from '@causedeck/db';
import {
  createObjectStoreFromEnv,
  EnvKeyProvider,
  storeSystemBlob,
  type KeyProvider,
  type ObjectStore,
} from '@causedeck/storage';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { loadSaasInvoiceForRender } from '../../billing/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';
import {
  enqueueInvoiceNotice,
  type BillingInvoiceNoticePayload,
} from './billing-invoice-notice.ts';

const { blob, saasInvoice } = schema;

export const billingInvoiceRenderSchema = z.object({
  workspaceId: workspaceIdSchema,
  invoiceId: z.uuid(),
});

export type BillingInvoiceRenderPayload = z.output<typeof billingInvoiceRenderSchema>;

export type InvoiceRenderOutcome = 'rendered' | 'already_rendered';

export interface InvoiceRenderDeps {
  store?: ObjectStore;
  keys?: KeyProvider;
  enqueueNotice?: (job: BillingInvoiceNoticePayload) => Promise<unknown>;
  now?: () => Date;
}

let defaultStore: ObjectStore | undefined;
let defaultKeys: KeyProvider | undefined;

/** The PDF's display name: the invoice number without path separators. */
export const invoicePdfFilename = (number: string) => `${number.replace(/[/\\]/g, '-')}.pdf`;

/** Render, store and link the PDF of one invoice. Exported for tests. */
export async function runBillingInvoiceRender(
  ctx: Pick<JobContext, 'db' | 'log'>,
  { workspaceId, invoiceId }: BillingInvoiceRenderPayload,
  deps: InvoiceRenderDeps = {},
): Promise<InvoiceRenderOutcome> {
  const fields = { workspaceId, invoiceId };
  const enqueueNotice = deps.enqueueNotice ?? enqueueInvoiceNotice;

  const loaded = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    loadSaasInvoiceForRender(tx, workspaceId, invoiceId),
  );
  if (loaded === null) {
    throw new RetryableError('INVOICE_NOT_FOUND', 'invoice not visible yet');
  }

  let outcome: InvoiceRenderOutcome = 'already_rendered';
  if (loaded.pdfBlobId === null) {
    const { invoice } = loaded;
    const pdf = await renderInvoicePdf({
      ...invoice,
      isTestSupplier: invoice.supplier.legalName === TEST_SUPPLIER_LEGAL_NAME,
    });
    const store = deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv()));
    const keys = deps.keys ?? (defaultKeys ??= EnvKeyProvider.fromEnv(serverEnv()));
    const stored = await storeSystemBlob(
      { db: ctx.db, store, keys, workspaceId, ...(deps.now ? { now: deps.now } : {}) },
      {
        kind: 'document',
        filename: invoicePdfFilename(invoice.number),
        mime: 'application/pdf',
        bytes: pdf,
      },
    );
    const linked = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
      const rows = await tx
        .update(saasInvoice)
        .set({ pdfBlobId: stored.blobId })
        .where(
          and(
            eq(saasInvoice.id, invoiceId),
            eq(saasInvoice.workspaceId, workspaceId),
            isNull(saasInvoice.pdfBlobId),
          ),
        )
        .returning({ id: saasInvoice.id });
      if (rows.length === 0) {
        await tx.delete(blob).where(eq(blob.id, stored.blobId));
      }
      return rows.length > 0;
    });
    if (linked) {
      outcome = 'rendered';
    } else {
      await store.delete(stored.key).catch(() => undefined);
    }
  }

  ctx.log.info({ ...fields, outcome }, 'billing invoice rendered');
  if (loaded.status !== 'void') await enqueueNotice({ workspaceId, invoiceId });
  return outcome;
}

/**
 * Send one `billing.invoice-render` job as the registry's `enqueue` does (schema, singleton key,
 * workspace fairness group). The registry imports `billing.process-event`, which calls this.
 */
export async function enqueueInvoiceRender(job: BillingInvoiceRenderPayload): Promise<unknown> {
  const data = billingInvoiceRenderSchema.parse(job);
  const sender = await getProducer();
  return sender.send('billing.invoice-render', data, {
    singletonKey: data.invoiceId,
    group: { id: data.workspaceId },
  });
}

export const billingInvoiceRender = defineJob({
  name: 'billing.invoice-render',
  schema: billingInvoiceRenderSchema,
  singleton: { key: (payload) => payload.invoiceId },
  idempotencyKey: (payload) => payload.invoiceId,
  handler: async (ctx, payload) => {
    await runBillingInvoiceRender(ctx, payload);
  },
});
