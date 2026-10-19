// `billing.process-event` (#204) on the Testcontainers database, as causedeck_app in a rolled-back
// transaction: the mock provider raises the events, `recordBillingEvent` stores them as the webhook
// route does, and the job applies each one exactly once under the workspace scope. A captured
// `subscription.charged` also issues one SaaS invoice and enqueues its render (#255); the pg-boss
// producer is replaced by a recorder.
import { randomUUID } from 'node:crypto';

import {
  createMockBillingProvider,
  type MockBillingProvider,
  type RazorpayWebhookEvent,
} from '@causedeck/billing/provider';
import { hashWebhookBody, minimiseWebhookEvent } from '@causedeck/billing/webhook';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as { name: string; data: object; options: unknown }[]);
vi.mock('../producer.ts', () => ({
  getProducer: () =>
    Promise.resolve({
      send: (name: string, data: object, options: unknown) => {
        sent.push({ name, data, options });
        return Promise.resolve('job-id');
      },
    }),
}));

import { recordBillingEvent, resolveBillingWorkspace } from '../../billing/webhook-events.ts';
import { RetryableError } from '../errors.ts';
import { registry } from '../registry.ts';
import { billingProcessEvent, runBillingProcessEvent } from './billing-process-event.ts';

const log = () => ({ info: vi.fn(), warn: vi.fn() });
const ctx = (db: Transaction, logger = log()) => ({
  db,
  log: logger as unknown as Logger,
});

async function seedWorkspace(tx: Transaction, provider: MockBillingProvider) {
  const workspaceId = randomUUID();
  const customer = await provider.createCustomer({ email: 'accounts@example.in' });
  const created = await provider.createSubscription({
    customerId: customer.id,
    planId: 'chamber-seat-1',
    quantity: 3,
  });
  await inWorkspace(tx, workspaceId, async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Process', slug: `process-${workspaceId}` });
    await s.insert(schema.subscription).values({
      workspaceId,
      planId: 'chamber-seat-1',
      status: 'trialing',
      seats: 3,
      provider: 'razorpay',
      providerSubscriptionId: created.id,
      providerCustomerId: customer.id,
    });
  });
  return { workspaceId, providerSubscriptionId: created.id };
}

let eventCounter = 0;

async function store(tx: Transaction, workspaceId: string, body: RazorpayWebhookEvent) {
  eventCounter += 1;
  const providerEventId = `evt_test_${String(eventCounter)}_${randomUUID().slice(0, 8)}`;
  const raw = JSON.stringify(body);
  const result = await recordBillingEvent(tx, {
    workspaceId,
    providerEventId,
    type: body.event,
    payloadHash: hashWebhookBody(raw),
    payload: minimiseWebhookEvent(body),
  });
  expect(result.inserted).toBe(true);
  return providerEventId;
}

const subscriptionOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, async (s) => {
    const [row] = await s
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.workspaceId, workspaceId));
    return row;
  });

const eventOf = (tx: Transaction, workspaceId: string, providerEventId: string) =>
  inWorkspace(tx, workspaceId, async (s) => {
    const [row] = await s
      .select()
      .from(schema.billingEvent)
      .where(eq(schema.billingEvent.providerEventId, providerEventId));
    return row;
  });

describe('billing.process-event', () => {
  it('is a registered workspace job with an ids-only payload', () => {
    expect(registry.get('billing.process-event')).toBe(billingProcessEvent);
    const workspaceId = randomUUID();
    expect(billingProcessEvent.schema.parse({ workspaceId, providerEventId: 'evt_1' })).toEqual({
      workspaceId,
      providerEventId: 'evt_1',
    });
    expect(() => billingProcessEvent.schema.parse({ providerEventId: 'evt_1' })).toThrow();
    expect(billingProcessEvent.singleton?.key({ workspaceId, providerEventId: 'evt_1' })).toBe(
      'evt_1',
    );
  });

  it('drives the mock flow end to end and applies each event exactly once', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const now = () => new Date('2026-01-01T00:00:00Z');

      const steps: [() => Promise<RazorpayWebhookEvent>, string, boolean][] = [
        [() => provider.authorizeMandate(providerSubscriptionId), 'active', false],
        [() => provider.simulate(providerSubscriptionId, 'subscription.charged'), 'active', false],
        [() => provider.simulate(providerSubscriptionId, 'payment.failed'), 'past_due', false],
        [() => provider.simulate(providerSubscriptionId, 'subscription.halted'), 'past_due', true],
        [
          () => provider.simulate(providerSubscriptionId, 'subscription.cancelled'),
          'cancelled',
          false,
        ],
      ];
      for (const [raise, status, grace] of steps) {
        const body = await raise();
        const providerEventId = await store(tx, workspaceId, body);
        const payload = { workspaceId, providerEventId };
        expect(await runBillingProcessEvent(ctx(tx), payload, { now })).toBe('applied');
        const row = await subscriptionOf(tx, workspaceId);
        expect(row?.status).toBe(status);
        expect(row?.graceUntil !== null).toBe(grace);
        expect((await eventOf(tx, workspaceId, providerEventId))?.processedAt).toEqual(now());

        // A redelivered or retried job changes nothing.
        expect(await runBillingProcessEvent(ctx(tx), payload, { now })).toBe('already_processed');
        expect(await subscriptionOf(tx, workspaceId)).toEqual(row);
      }
    });
  });

  it('applies the period and quantity from subscription.charged', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const activated = await provider.authorizeMandate(providerSubscriptionId);
      await runBillingProcessEvent(ctx(tx), {
        workspaceId,
        providerEventId: await store(tx, workspaceId, activated),
      });
      const charged = await provider.simulate(providerSubscriptionId, 'subscription.charged');
      await runBillingProcessEvent(ctx(tx), {
        workspaceId,
        providerEventId: await store(tx, workspaceId, charged),
      });
      const entity = charged.payload.subscription?.entity;
      const row = await subscriptionOf(tx, workspaceId);
      expect(row?.currentPeriodStart?.getTime()).toBe((entity?.current_start ?? 0) * 1000);
      expect(row?.currentPeriodEnd?.getTime()).toBe((entity?.current_end ?? 0) * 1000);
      expect(row?.seats).toBe(3);
    });
  });

  it('marks an illegal transition processed without retrying or changing the row', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      await provider.authorizeMandate(providerSubscriptionId);
      // `halted` is illegal from the stored `created` (trialing) state.
      const halted = await provider.simulate(providerSubscriptionId, 'subscription.halted');
      const providerEventId = await store(tx, workspaceId, halted);
      const logger = log();
      expect(await runBillingProcessEvent(ctx(tx, logger), { workspaceId, providerEventId })).toBe(
        'illegal_transition',
      );
      expect((await subscriptionOf(tx, workspaceId))?.status).toBe('trialing');
      expect((await eventOf(tx, workspaceId, providerEventId))?.processedAt).not.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId, providerEventId, from: 'created', event: 'halted' }),
        'billing event rejected by the state machine',
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('accounts@example.in');
    });
  });

  it('starts a dunning episode on the first failure, keeps it, and clears it on a charge (#205)', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const apply = async (body: RazorpayWebhookEvent, at: string) =>
        runBillingProcessEvent(
          ctx(tx),
          { workspaceId, providerEventId: await store(tx, workspaceId, body) },
          { now: () => new Date(at) },
        );

      await apply(await provider.authorizeMandate(providerSubscriptionId), '2026-01-01T00:00:00Z');
      let row = await subscriptionOf(tx, workspaceId);
      expect(row?.dunningStartedAt).toBeNull();
      expect(row?.dunningAttempts).toBe(0);

      const firstFailure = '2026-02-01T00:00:00Z';
      await apply(await provider.simulate(providerSubscriptionId, 'payment.failed'), firstFailure);
      row = await subscriptionOf(tx, workspaceId);
      expect(row?.status).toBe('past_due');
      expect(row?.dunningStartedAt).toEqual(new Date(firstFailure));
      expect(row?.dunningAttempts).toBe(0);

      // Retries already made in the episode survive a later failure and the halt.
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.subscription)
          .set({ dunningAttempts: 2 })
          .where(eq(schema.subscription.workspaceId, workspaceId)),
      );
      await apply(
        await provider.simulate(providerSubscriptionId, 'payment.failed'),
        '2026-02-03T00:00:00Z',
      );
      await apply(
        await provider.simulate(providerSubscriptionId, 'subscription.halted'),
        '2026-02-09T00:00:00Z',
      );
      row = await subscriptionOf(tx, workspaceId);
      expect(row?.graceUntil).not.toBeNull();
      expect(row?.dunningStartedAt).toEqual(new Date(firstFailure));
      expect(row?.dunningAttempts).toBe(2);

      await apply(
        await provider.simulate(providerSubscriptionId, 'subscription.charged'),
        '2026-02-10T00:00:00Z',
      );
      row = await subscriptionOf(tx, workspaceId);
      expect(row?.status).toBe('active');
      expect(row?.dunningStartedAt).toBeNull();
      expect(row?.dunningAttempts).toBe(0);
    });
  });

  it('retries while the stored event is not visible yet', async () => {
    await withTestDb(async (tx) => {
      const run = runBillingProcessEvent(ctx(tx), {
        workspaceId: randomUUID(),
        providerEventId: 'evt_not_committed',
      });
      await expect(run).rejects.toBeInstanceOf(RetryableError);
    });
  });
});

describe('webhook event persistence', () => {
  it('resolves the workspace only from the stored provider subscription id', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const a = await seedWorkspace(tx, provider);
      const b = await seedWorkspace(tx, provider);
      expect(await resolveBillingWorkspace(tx, 'razorpay', a.providerSubscriptionId)).toBe(
        a.workspaceId,
      );
      expect(await resolveBillingWorkspace(tx, 'razorpay', b.providerSubscriptionId)).toBe(
        b.workspaceId,
      );
      expect(await resolveBillingWorkspace(tx, 'mock', a.providerSubscriptionId)).toBeNull();
      expect(await resolveBillingWorkspace(tx, 'razorpay', 'sub_unknown')).toBeNull();
    });
  });

  it('stores each provider event id once and runs afterInsert only for the first', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const body = await provider.authorizeMandate(providerSubscriptionId);
      const input = {
        workspaceId,
        providerEventId: 'evt_once',
        type: body.event,
        payloadHash: hashWebhookBody(JSON.stringify(body)),
        payload: minimiseWebhookEvent(body),
      };
      const afterInsert = vi.fn(() => Promise.resolve());
      expect(await recordBillingEvent(tx, input, afterInsert)).toEqual({ inserted: true });
      expect(await recordBillingEvent(tx, input, afterInsert)).toEqual({ inserted: false });
      expect(afterInsert).toHaveBeenCalledTimes(1);
    });
  });

  it('rolls the row back when afterInsert fails, so the retry is not a duplicate', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const body = await provider.authorizeMandate(providerSubscriptionId);
      const input = {
        workspaceId,
        providerEventId: 'evt_enqueue_fails',
        type: body.event,
        payloadHash: 'x',
        payload: minimiseWebhookEvent(body),
      };
      await expect(
        recordBillingEvent(tx, input, () => Promise.reject(new Error('queue down'))),
      ).rejects.toThrow('queue down');
      expect(await eventOf(tx, workspaceId, 'evt_enqueue_fails')).toBeUndefined();
      expect(await recordBillingEvent(tx, input)).toEqual({ inserted: true });
    });
  });
});

describe('billing.process-event: invoice on payment (#255)', () => {
  const invoicesOf = (tx: Transaction, workspaceId: string) =>
    inWorkspace(tx, workspaceId, (s) =>
      s.select().from(schema.saasInvoice).where(eq(schema.saasInvoice.workspaceId, workspaceId)),
    );
  const rendersFor = (workspaceId: string) =>
    sent.filter(
      (job) =>
        job.name === 'billing.invoice-render' &&
        (job.data as { workspaceId: string }).workspaceId === workspaceId,
    );

  it('issues one invoice for a captured charge and enqueues one render', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const apply = async (providerEventId: string) =>
        runBillingProcessEvent(ctx(tx), { workspaceId, providerEventId });

      await apply(
        await store(tx, workspaceId, await provider.authorizeMandate(providerSubscriptionId)),
      );
      expect(await invoicesOf(tx, workspaceId)).toEqual([]);

      const charged = await provider.simulate(providerSubscriptionId, 'subscription.charged');
      const providerEventId = await store(tx, workspaceId, charged);
      expect(await apply(providerEventId)).toBe('applied');
      const invoices = await invoicesOf(tx, workspaceId);
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({
        status: 'issued',
        providerPaymentId: charged.payload.payment?.entity.id,
        pdfBlobId: null,
      });
      const invoiceId = invoices[0]?.id ?? '';
      expect(rendersFor(workspaceId)).toEqual([
        {
          name: 'billing.invoice-render',
          data: { workspaceId, invoiceId },
          options: { singletonKey: invoiceId, group: { id: workspaceId } },
        },
      ]);

      // A retried job and a redelivery of the same payment under a new event id issue nothing.
      expect(await apply(providerEventId)).toBe('already_processed');
      await apply(await store(tx, workspaceId, charged));
      expect(await invoicesOf(tx, workspaceId)).toHaveLength(1);
      expect(rendersFor(workspaceId)).toHaveLength(1);

      // The next cycle's charge is a new payment and a new invoice.
      await apply(
        await store(
          tx,
          workspaceId,
          await provider.simulate(providerSubscriptionId, 'subscription.charged'),
        ),
      );
      expect(await invoicesOf(tx, workspaceId)).toHaveLength(2);
    });
  });

  it('issues nothing for a failed payment, an illegal transition or an unknown subscription', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      const apply = async (body: RazorpayWebhookEvent) =>
        runBillingProcessEvent(ctx(tx), {
          workspaceId,
          providerEventId: await store(tx, workspaceId, body),
        });

      await apply(await provider.authorizeMandate(providerSubscriptionId));
      expect(await apply(await provider.simulate(providerSubscriptionId, 'payment.failed'))).toBe(
        'applied',
      );

      // A charge the state machine rejects: the stored subscription is already cancelled.
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.subscription)
          .set({ status: 'cancelled' })
          .where(eq(schema.subscription.workspaceId, workspaceId)),
      );
      expect(
        await apply(await provider.simulate(providerSubscriptionId, 'subscription.charged')),
      ).toBe('illegal_transition');

      // A charge for a provider subscription this workspace does not have.
      const customer = await provider.createCustomer({ email: 'other@example.in' });
      const other = await provider.createSubscription({
        customerId: customer.id,
        planId: 'chamber-seat-1',
        quantity: 3,
      });
      await provider.authorizeMandate(other.id);
      expect(await apply(await provider.simulate(other.id, 'subscription.charged'))).toBe(
        'unknown_subscription',
      );

      expect(await invoicesOf(tx, workspaceId)).toEqual([]);
      expect(rendersFor(workspaceId)).toEqual([]);
    });
  });

  it('rolls the event back when the invoice cannot be issued, so the job retries', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const provider = createMockBillingProvider();
      const { workspaceId, providerSubscriptionId } = await seedWorkspace(tx, provider);
      await runBillingProcessEvent(ctx(tx), {
        workspaceId,
        providerEventId: await store(
          tx,
          workspaceId,
          await provider.authorizeMandate(providerSubscriptionId),
        ),
      });
      const before = await subscriptionOf(tx, workspaceId);
      const charged = await provider.simulate(providerSubscriptionId, 'subscription.charged');
      const providerEventId = await store(tx, workspaceId, charged);
      const refuse = () => {
        throw new Error('supplier not configured');
      };

      await expect(
        runBillingProcessEvent(ctx(tx), { workspaceId, providerEventId }, { supplier: refuse }),
      ).rejects.toThrow('supplier not configured');
      expect((await eventOf(tx, workspaceId, providerEventId))?.processedAt).toBeNull();
      expect(await subscriptionOf(tx, workspaceId)).toEqual(before);
      expect(await invoicesOf(tx, workspaceId)).toEqual([]);

      // The retry, once the supplier is configured, applies the charge and issues the invoice.
      expect(await runBillingProcessEvent(ctx(tx), { workspaceId, providerEventId })).toBe(
        'applied',
      );
      expect(await invoicesOf(tx, workspaceId)).toHaveLength(1);
    });
  });
});
