// Invoice PDF download against a real Postgres (#258): the render job stores the PDF encrypted,
// `openSaasInvoicePdf` decrypts it for its own workspace and records one
// `billing.invoice_downloaded`, while another workspace (with the same invoice id), an unrendered
// invoice and a malformed id get `null` and nothing is audited. Every test runs in a rolled-back
// transaction.
import { randomBytes, randomUUID } from 'node:crypto';

import { resolveSupplier } from '@causedeck/billing/config/supplier';
import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import {
  createMemoryObjectStore,
  decryptForWorkspace,
  EnvKeyProvider,
  type ObjectKey,
} from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  invoicePdfFilename,
  runBillingInvoiceRender,
} from '../../jobs/definitions/billing-invoice-render.ts';
import { issueSaasInvoice, openSaasInvoicePdf } from '../index.ts';

const { auditEvent, blob, saasInvoice } = schema;

const SUPPLIER = resolveSupplier(
  { legalName: 'CauseDeck Technologies Pvt Ltd', address: 'Bengaluru', gstin: '29AAGCB7383J1Z4' },
  { nodeEnv: 'production' },
);
const keys = new EnvKeyProvider([{ id: 'kek-1', key: new Secret(randomBytes(32)) }]);
const now = () => new Date('2026-04-02T06:00:00Z');
const logger = () =>
  ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

async function seedWorkspace(tx: Transaction) {
  const [user] = await tx
    .insert(schema.user)
    .values({ name: 'Owner', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!user) throw new Error('user insert failed');
  const workspaceId = randomUUID();
  const subscriptionId = await inWorkspace(tx, workspaceId, async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Sharma Chambers', slug: `pdf-${workspaceId}` });
    const [row] = await s
      .insert(schema.subscription)
      .values({
        workspaceId,
        planId: 'chamber-seat-1',
        status: 'active',
        seats: 3,
        provider: 'razorpay',
        providerSubscriptionId: `sub_${randomUUID().slice(0, 8)}`,
        providerCustomerId: 'cust_test',
      })
      .returning({ id: schema.subscription.id });
    return row?.id ?? '';
  });
  return { workspaceId, userId: user.id, subscriptionId };
}

const issue = (tx: Transaction, workspaceId: string, subscriptionId: string) =>
  issueSaasInvoice(
    { db: tx, workspaceId, supplier: () => SUPPLIER, now },
    {
      subscriptionId,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      lines: [{ description: 'Chamber 1, seats, April 2026', quantity: 3, unitPricePaise: 49_900 }],
    },
  );

const downloads = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.workspaceId, workspaceId),
          eq(auditEvent.action, 'billing.invoice_downloaded'),
        ),
      ),
  );

/** The stored PDF, decrypted directly (what the render job wrote). */
async function storedPlaintext(
  tx: Transaction,
  store: ReturnType<typeof createMemoryObjectStore>,
  workspaceId: string,
  invoiceId: string,
) {
  const [row] = await inWorkspace(tx, workspaceId, async (s) => {
    const [invoice] = await s
      .select({ pdfBlobId: saasInvoice.pdfBlobId })
      .from(saasInvoice)
      .where(eq(saasInvoice.id, invoiceId));
    return s
      .select({ key: blob.key })
      .from(blob)
      .where(eq(blob.id, invoice?.pdfBlobId ?? randomUUID()));
  });
  if (!row) throw new Error('no stored PDF');
  const body = Buffer.from((await store.get(row.key as ObjectKey)).body);
  const parts: Buffer[] = [];
  for await (const part of decryptForWorkspace(tx, keys, workspaceId, [body])) parts.push(part);
  return Buffer.concat(parts);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

describe('openSaasInvoicePdf', () => {
  it('decrypts the stored PDF for its own workspace and audits the download', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const a = await seedWorkspace(tx);
      const invoice = await issue(tx, a.workspaceId, a.subscriptionId);
      const store = createMemoryObjectStore();
      await runBillingInvoiceRender(
        { db: tx, log: logger() },
        { workspaceId: a.workspaceId, invoiceId: invoice.id },
        { store, keys, enqueueNotice: vi.fn(), now },
      );

      const pdf = await openSaasInvoicePdf(
        { db: tx, store, keys, workspaceId: a.workspaceId, userId: a.userId, requestId: 'req-1' },
        invoice.id,
      );
      expect(pdf).not.toBeNull();
      expect(pdf?.number).toBe(invoice.number);
      expect(pdf?.filename).toBe(invoicePdfFilename(invoice.number));
      expect(pdf?.mime).toBe('application/pdf');
      const bytes = await readAll(pdf?.stream ?? new ReadableStream());
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(bytes.equals(await storedPlaintext(tx, store, a.workspaceId, invoice.id))).toBe(true);

      const events = await downloads(tx, a.workspaceId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorUserId: a.userId,
        targetKind: 'saas_invoice',
        targetId: invoice.id,
        metadata: { number: invoice.number },
      });
    });
  });

  it("returns null for another workspace's invoice and audits nothing (cross-tenant)", async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const a = await seedWorkspace(tx);
      const b = await seedWorkspace(tx);
      const invoice = await issue(tx, a.workspaceId, a.subscriptionId);
      const store = createMemoryObjectStore();
      await runBillingInvoiceRender(
        { db: tx, log: logger() },
        { workspaceId: a.workspaceId, invoiceId: invoice.id },
        { store, keys, enqueueNotice: vi.fn(), now },
      );

      const pdf = await openSaasInvoicePdf(
        { db: tx, store, keys, workspaceId: b.workspaceId, userId: b.userId },
        invoice.id,
      );
      expect(pdf).toBeNull();
      expect(await downloads(tx, b.workspaceId)).toHaveLength(0);
      expect(await downloads(tx, a.workspaceId)).toHaveLength(0);
    });
  });

  it('returns null for an unrendered invoice and a malformed id', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const a = await seedWorkspace(tx);
      const invoice = await issue(tx, a.workspaceId, a.subscriptionId);
      const store = createMemoryObjectStore();
      const ctx = { db: tx, store, keys, workspaceId: a.workspaceId, userId: a.userId };

      expect(await openSaasInvoicePdf(ctx, invoice.id)).toBeNull();
      expect(await openSaasInvoicePdf(ctx, 'not-a-uuid')).toBeNull();
      expect(await openSaasInvoicePdf(ctx, randomUUID())).toBeNull();
      expect(await downloads(tx, a.workspaceId)).toHaveLength(0);
    });
  });
});
