// `billing.process-event` (#204) on the Testcontainers database, as causedeck_app in a rolled-back
// transaction: the mock provider raises the events, `recordBillingEvent` stores them as the webhook
// route does, and the job applies each one exactly once under the workspace scope.
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
