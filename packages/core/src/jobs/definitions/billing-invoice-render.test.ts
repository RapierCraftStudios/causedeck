// Invoice on payment (#255, #29 part 4) on the Testcontainers database, as causedeck_app in a
// rolled-back transaction, with the memory object store, a test KEK and a recording transport:
// - `billing.invoice-render` stores the PDF as envelope ciphertext under the workspace DEK, records
//   a finalized blob, sets `pdf_blob_id` and enqueues the notice; a rerun stores nothing new;
// - `billing.invoice-notice` emails the billing email once, and skips a suppressed or missing one;
// - the chain: mock provider `subscription.charged` → stored webhook event → `billing.process-event`
//   (twice, and as a redelivery under a new event id) → render → notice yields one invoice, one
//   encrypted PDF and one email.
import { randomBytes, randomUUID } from 'node:crypto';

import { resolveSupplier } from '@causedeck/billing/config/supplier';
import {
  createMockBillingProvider,
  type MockBillingProvider,
  type RazorpayWebhookEvent,
} from '@causedeck/billing/provider';
import { hashWebhookBody, minimiseWebhookEvent } from '@causedeck/billing/webhook';
import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  recordSuppression,
  type EmailMessage,
  type EmailTransport,
} from '@causedeck/notifications/email';
import type { Logger } from '@causedeck/observability';
import {
  createMemoryObjectStore,
  decryptForWorkspace,
  EnvKeyProvider,
  type ObjectKey,
} from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { issueSaasInvoice } from '../../billing/invoices.ts';
import { recordBillingEvent } from '../../billing/webhook-events.ts';
import type { JobContext } from '../context.ts';
import { RetryableError } from '../errors.ts';
import { registry } from '../registry.ts';
import {
  billingInvoiceNotice,
  runBillingInvoiceNotice,
  type BillingInvoiceNoticePayload,
} from './billing-invoice-notice.ts';
import {
  billingInvoiceRender,
  invoicePdfFilename,
  runBillingInvoiceRender,
  type BillingInvoiceRenderPayload,
} from './billing-invoice-render.ts';
import { runBillingProcessEvent } from './billing-process-event.ts';

const { blob, saasInvoice } = schema;

const BILLING_EMAIL = 'accounts@sharma-chambers.example.in';
const APP_URL = 'https://app.causedeck.test';
const SUPPLIER = resolveSupplier(
  { legalName: 'CauseDeck Technologies Pvt Ltd', address: 'Bengaluru', gstin: '29AAGCB7383J1Z4' },
  { nodeEnv: 'production' },
);
const supplier = () => SUPPLIER;
const keys = new EnvKeyProvider([{ id: 'kek-1', key: new Secret(randomBytes(32)) }]);
const now = () => new Date('2026-04-02T06:00:00Z');

const logger = () =>
  ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

function transport() {
  const sent: EmailMessage[] = [];
  const state: { failWith: Error | null } = { failWith: null };
  const email: EmailTransport = {
    provider: 'console',
    send: (message) => {
      if (state.failWith) return Promise.reject(state.failWith);
      sent.push(message);
      return Promise.resolve({ messageId: `m-${String(sent.length)}` });
    },
  };
  return { sent, state, deps: { email, appUrl: APP_URL } };
}

async function seedWorkspace(
  tx: Transaction,
  provider: MockBillingProvider,
  billingEmail: string | null = BILLING_EMAIL,
) {
  const workspaceId = randomUUID();
  const customer = await provider.createCustomer({ email: BILLING_EMAIL });
  const created = await provider.createSubscription({
    customerId: customer.id,
    planId: 'chamber-seat-1',
    quantity: 3,
  });
  const subscriptionId = await inWorkspace(tx, workspaceId, async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Sharma Chambers', slug: `inv-${workspaceId}` });
    const [row] = await s
      .insert(schema.subscription)
      .values({
        workspaceId,
        planId: 'chamber-seat-1',
        status: 'trialing',
        seats: 3,
        provider: 'razorpay',
        providerSubscriptionId: created.id,
        providerCustomerId: customer.id,
        billingEmail,
        gstin: '29AAGCB7383J1Z4',
      })
      .returning({ id: schema.subscription.id });
    return row?.id ?? '';
  });
  return { workspaceId, subscriptionId, providerSubscriptionId: created.id };
}

async function storeEvent(tx: Transaction, workspaceId: string, body: RazorpayWebhookEvent) {
  const providerEventId = `evt_inv_${randomUUID().slice(0, 12)}`;
  const raw = JSON.stringify(body);
  await recordBillingEvent(tx, {
    workspaceId,
    providerEventId,
    type: body.event,
    payloadHash: hashWebhookBody(raw),
    payload: minimiseWebhookEvent(body),
  });
  return providerEventId;
}

/** A directly issued invoice (no payment) for the render and notice tests. */
async function issued(tx: Transaction, workspaceId: string, subscriptionId: string) {
  const invoice = await issueSaasInvoice(
    { db: tx, workspaceId, supplier, now },
    {
      subscriptionId,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      lines: [{ description: 'Chamber 1, seats, April 2026', quantity: 3, unitPricePaise: 49_900 }],
    },
  );
  return invoice;
}

const invoicesOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s.select().from(saasInvoice).where(eq(saasInvoice.workspaceId, workspaceId)),
  );

const blobsOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s.select().from(blob).where(eq(blob.workspaceId, workspaceId)),
  );

function noticeCtx(s: Transaction, payload: BillingInvoiceNoticePayload): JobContext {
  return {
    log: logger(),
    db: s,
    workspaceId: payload.workspaceId,
    jobName: 'billing.invoice-notice',
    jobId: randomUUID(),
    attempt: 1,
    signal: new AbortController().signal,
    idempotencyKey: payload.invoiceId,
  };
}

const notice = (
  tx: Transaction,
  payload: BillingInvoiceNoticePayload,
  deps: ReturnType<typeof transport>['deps'],
) =>
  inWorkspace(tx, payload.workspaceId, (s) =>
    runBillingInvoiceNotice(noticeCtx(s, payload), payload, deps),
  );

async function decrypted(
  tx: Transaction,
  store: ReturnType<typeof createMemoryObjectStore>,
  workspaceId: string,
  key: string,
) {
  const body = Buffer.from((await store.get(key as ObjectKey)).body);
  const parts: Buffer[] = [];
  for await (const part of decryptForWorkspace(tx, keys, workspaceId, [body])) {
    parts.push(Buffer.from(part));
  }
  return { body, plain: Buffer.concat(parts) };
}

describe('billing.invoice-render and billing.invoice-notice', () => {
  it('are registered workspace jobs with ids-only payloads keyed by invoice', () => {
    expect(registry.get('billing.invoice-render')).toBe(billingInvoiceRender);
    expect(registry.get('billing.invoice-notice')).toBe(billingInvoiceNotice);
    const payload = { workspaceId: randomUUID(), invoiceId: randomUUID() };
    expect(billingInvoiceRender.schema.parse(payload)).toEqual(payload);
    expect(billingInvoiceRender.singleton?.key(payload)).toBe(payload.invoiceId);
    expect(billingInvoiceNotice.singleton?.key(payload)).toBe(payload.invoiceId);
    expect(() => billingInvoiceRender.schema.parse({ invoiceId: payload.invoiceId })).toThrow();
    expect(() => billingInvoiceRender.schema.parse({ ...payload, invoiceId: 'inv-1' })).toThrow();
    expect(invoicePdfFilename('CD/26-27/000001')).toBe('CD-26-27-000001.pdf');
  });

  it('renders the PDF, stores it encrypted, links it and enqueues the notice once', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { workspaceId, subscriptionId } = await seedWorkspace(tx, createMockBillingProvider());
      const invoice = await issued(tx, workspaceId, subscriptionId);
      const store = createMemoryObjectStore();
      const notices: BillingInvoiceNoticePayload[] = [];
      const deps = {
        store,
        keys,
        now,
        enqueueNotice: (job: BillingInvoiceNoticePayload) => {
          notices.push(job);
          return Promise.resolve(null);
        },
      };
      const payload: BillingInvoiceRenderPayload = { workspaceId, invoiceId: invoice.id };

      expect(await runBillingInvoiceRender({ db: tx, log: logger() }, payload, deps)).toBe(
        'rendered',
      );

      const [row] = await invoicesOf(tx, workspaceId);
      const blobs = await blobsOf(tx, workspaceId);
      expect(blobs).toHaveLength(1);
      const [stored] = blobs;
      expect(row?.pdfBlobId).toBe(stored?.id);
      expect(stored).toMatchObject({
        kind: 'document',
        mime: 'application/pdf',
        filename: invoicePdfFilename(invoice.number),
        scanStatus: 'skipped',
        createdBy: null,
      });
      expect(stored?.encHeader).not.toBeNull();
      const { body, plain } = await decrypted(tx, store, workspaceId, stored?.key ?? '');
      expect(body.subarray(0, 4).toString('ascii')).toBe('CDE1');
      expect(body.includes(Buffer.from('%PDF'))).toBe(false);
      expect(plain.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(stored?.size).toBe(plain.byteLength);
      expect(notices).toEqual([payload]);

      // A rerun (redelivered job) stores nothing new and keeps the link.
      expect(await runBillingInvoiceRender({ db: tx, log: logger() }, payload, deps)).toBe(
        'already_rendered',
      );
      expect(await blobsOf(tx, workspaceId)).toHaveLength(1);
      expect((await invoicesOf(tx, workspaceId))[0]?.pdfBlobId).toBe(stored?.id);
      expect(await store.list(workspaceId)).toHaveLength(1);
    });
  });

  it('retries an invoice it cannot see yet, and never renders another workspace’s invoice', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const a = await seedWorkspace(tx, provider);
      const b = await seedWorkspace(tx, provider);
      const invoice = await issued(tx, a.workspaceId, a.subscriptionId);
      const deps = { store: createMemoryObjectStore(), keys, enqueueNotice: vi.fn() };
      const ctx = { db: tx, log: logger() };
      await expect(
        runBillingInvoiceRender(ctx, { workspaceId: a.workspaceId, invoiceId: randomUUID() }, deps),
      ).rejects.toBeInstanceOf(RetryableError);
      await expect(
        runBillingInvoiceRender(ctx, { workspaceId: b.workspaceId, invoiceId: invoice.id }, deps),
      ).rejects.toBeInstanceOf(RetryableError);
      expect(await blobsOf(tx, b.workspaceId)).toEqual([]);
      expect(deps.enqueueNotice).not.toHaveBeenCalled();
    });
  });

  it('emails the billing email once, with the invoice number and a billing link', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { workspaceId, subscriptionId } = await seedWorkspace(tx, createMockBillingProvider());
      const invoice = await issued(tx, workspaceId, subscriptionId);
      const { sent, deps } = transport();
      const payload = { workspaceId, invoiceId: invoice.id };

      expect(await notice(tx, payload, deps)).toBe('sent');
      expect(sent).toHaveLength(1);
      const [message] = sent;
      expect(message?.to).toBe(BILLING_EMAIL);
      expect(message?.text).toContain(invoice.number);
      expect(message?.text).toContain(`${APP_URL}/w/inv-${workspaceId}/billing`);

      // A redelivered job does not send again.
      expect(await notice(tx, payload, deps)).toBe('already_sent');
      expect(sent).toHaveLength(1);
    });
  });

  it('skips a suppressed billing email, and retries a transient transport failure', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { workspaceId, subscriptionId } = await seedWorkspace(tx, createMockBillingProvider());
      const invoice = await issued(tx, workspaceId, subscriptionId);
      const payload = { workspaceId, invoiceId: invoice.id };

      const failing = transport();
      failing.state.failWith = new Error('connection reset');
      await expect(notice(tx, payload, failing.deps)).rejects.toBeInstanceOf(RetryableError);

      await recordSuppression(tx, { email: BILLING_EMAIL.toUpperCase(), reason: 'bounce' });
      const { sent, state, deps } = transport();
      state.failWith = new Error('transport must not be called');
      expect(await notice(tx, payload, deps)).toBe('suppressed');
      expect(sent).toHaveLength(0);
    });
  });

  it('skips a subscription without a billing email', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { workspaceId, subscriptionId } = await seedWorkspace(
        tx,
        createMockBillingProvider(),
        null,
      );
      const invoice = await issued(tx, workspaceId, subscriptionId);
      const { sent, deps } = transport();
      expect(await notice(tx, { workspaceId, invoiceId: invoice.id }, deps)).toBe(
        'no_billing_email',
      );
      expect(sent).toHaveLength(0);
    });
  });
});

describe('invoice on subscription.charged (mock provider), end to end', () => {
  it('issues, renders, stores encrypted and emails one invoice however often the charge is processed', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const renders: BillingInvoiceRenderPayload[] = [];
      const notices: BillingInvoiceNoticePayload[] = [];
      const processDeps = {
        now,
        supplier,
        enqueueRender: (job: BillingInvoiceRenderPayload) => {
          renders.push(job);
          return Promise.resolve(null);
        },
      };
      const process = async (providerEventId: string) =>
        runBillingProcessEvent(
          { db: tx, log: logger() },
          { workspaceId, providerEventId },
          processDeps,
        );

      // Activation is not a charge: no invoice.
      await process(
        await storeEvent(tx, workspaceId, await provider.authorizeMandate(providerSubscriptionId)),
      );
      expect(await invoicesOf(tx, workspaceId)).toEqual([]);

      const charged = await provider.simulate(providerSubscriptionId, 'subscription.charged');
      const paymentId = charged.payload.payment?.entity.id;
      const eventId = await storeEvent(tx, workspaceId, charged);
      expect(await process(eventId)).toBe('applied');
      // The same event again (retried job), and the same payment redelivered under a new event id.
      expect(await process(eventId)).toBe('already_processed');
      await process(await storeEvent(tx, workspaceId, charged));

      const invoices = await invoicesOf(tx, workspaceId);
      expect(invoices).toHaveLength(1);
      const [invoice] = invoices;
      expect(invoice).toMatchObject({ status: 'issued', providerPaymentId: paymentId });
      expect(invoice?.number).toMatch(/^CD\/26-27\/\d{6}$/);
      // 3 seats × ₹499 ex-GST; intra-state CGST + SGST.
      expect(invoice?.taxablePaise).toBe(149_700);
      expect(invoice?.totalPaise).toBe(176_646);
      expect(renders).toEqual([{ workspaceId, invoiceId: invoice?.id }]);

      const store = createMemoryObjectStore();
      const renderDeps = {
        store,
        keys,
        now,
        enqueueNotice: (job: BillingInvoiceNoticePayload) => {
          notices.push(job);
          return Promise.resolve(null);
        },
      };
      for (const job of [...renders, ...renders]) {
        await runBillingInvoiceRender({ db: tx, log: logger() }, job, renderDeps);
      }
      const blobs = await blobsOf(tx, workspaceId);
      expect(blobs).toHaveLength(1);
      expect((await invoicesOf(tx, workspaceId))[0]?.pdfBlobId).toBe(blobs[0]?.id);
      const { plain } = await decrypted(tx, store, workspaceId, blobs[0]?.key ?? '');
      expect(plain.subarray(0, 5).toString('ascii')).toBe('%PDF-');

      const { sent, deps } = transport();
      for (const job of notices) await notice(tx, job, deps);
      expect(sent.map((m) => m.to)).toEqual([BILLING_EMAIL]);
    });
  });
});
