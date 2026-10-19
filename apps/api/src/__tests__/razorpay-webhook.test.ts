// Razorpay webhook and the billing read API (#204) on the real app and the #6 Testcontainers
// database. The mock provider raises the events and signs each delivery with the mock secret, as
// dev and CI do; a stub sender captures the `billing.process-event` jobs, which the test then runs
// with `runBillingProcessEvent`. No network and no credentials.
import { randomUUID } from 'node:crypto';

import {
  createMockBillingProvider,
  MOCK_EPOCH,
  type MockBillingProvider,
} from '@causedeck/billing/provider';
import { createBillingService } from '@causedeck/billing/service';
import {
  MOCK_WEBHOOK_SECRET,
  signRazorpayWebhook,
  type ReplayWindow,
} from '@causedeck/billing/webhook';
import { Secret } from '@causedeck/config/env';
import { runBillingProcessEvent, type JobSender } from '@causedeck/core/jobs';
import { schema, withWorkspace } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { testAppDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { call, createWorkspace, makeApp, memoryLogger, problemOf, signIn } from './helpers.ts';

const PATH = '/v1/webhooks/razorpay';
const now = () => MOCK_EPOCH;

interface Sent {
  name: string;
  data: { workspaceId: string; providerEventId: string };
}

function harness(options: { replayWindow?: ReplayWindow } = {}) {
  const sent: Sent[] = [];
  const sender: JobSender = {
    send: vi.fn((name: string, data: object) => {
      sent.push({ name, data: data as Sent['data'] });
      return Promise.resolve(randomUUID());
    }),
  };
  const { logger, lines } = memoryLogger();
  const app = makeApp({
    logger,
    now,
    billing: { webhookSecret: MOCK_WEBHOOK_SECRET, sender, ...options },
  });
  return { app, sent, lines };
}

/**
 * A workspace with a mock subscription stored the way the billing flow stores it. Every mock
 * instance counts ids from `sub_mock_0001` and this database is shared across tests, so the stored
 * provider id gets a unique suffix, and `deliverLatest` rewrites deliveries to it.
 */
async function subscribedWorkspace(provider: MockBillingProvider, notes?: Record<string, string>) {
  const owner = await signIn();
  const workspace = await createWorkspace(owner.id);
  const service = createBillingService({ provider, now });
  const started = await service.startSubscription({
    planId: 'chamber-seat-1',
    seats: 3,
    billingEmail: owner.email,
    ...(notes && { notes }),
  });
  const s = started.subscription;
  const storedId = `${started.provider.id}_${randomUUID()}`;
  await withWorkspace(testAppDb(), { workspaceId: workspace.id }, (tx) =>
    tx.insert(schema.subscription).values({
      workspaceId: workspace.id,
      planId: s.planId,
      status: 'trialing',
      seats: s.seats,
      clerkSeats: s.clerkSeats,
      provider: 'razorpay',
      providerSubscriptionId: storedId,
      providerCustomerId: s.providerCustomerId,
      billingEmail: owner.email,
      gstin: '27AAPFU0939F1ZV',
    }),
  );
  return { owner, workspace, started, storedId, providerSubscriptionId: started.provider.id };
}

/** The latest mock delivery for `storedId`, signed with the mock secret and posted. */
function latestDelivery(provider: MockBillingProvider, storedId: string) {
  const delivery = provider.deliveries().at(-1);
  const subscription = delivery?.body.payload.subscription;
  if (!delivery || !subscription) throw new Error('no delivery');
  subscription.entity.id = storedId;
  const rawBody = JSON.stringify(delivery.body);
  return {
    eventId: `${delivery.eventId}_${randomUUID()}`,
    rawBody,
    signature: signRazorpayWebhook(rawBody, MOCK_WEBHOOK_SECRET),
  };
}

async function deliverLatest(
  app: ReturnType<typeof makeApp>,
  provider: MockBillingProvider,
  storedId: string,
) {
  const signed = latestDelivery(provider, storedId);
  return { signed, response: await post(app, signed.rawBody, signed.signature, signed.eventId) };
}

function post(
  app: ReturnType<typeof makeApp>,
  rawBody: string,
  signature: string | undefined,
  /** `null` omits the header. */
  eventId: string | null = `evt_${randomUUID()}`,
) {
  const headers: Record<string, string> = {};
  if (signature !== undefined) headers['x-razorpay-signature'] = signature;
  if (eventId !== null) headers['x-razorpay-event-id'] = eventId;
  return call(app, PATH, { method: 'POST', rawBody, headers });
}

const eventsOf = (workspaceId: string) =>
  withWorkspace(testAppDb(), { workspaceId }, (tx) => tx.select().from(schema.billingEvent));

const subscriptionOf = async (workspaceId: string) => {
  const [row] = await withWorkspace(testAppDb(), { workspaceId }, (tx) =>
    tx.select().from(schema.subscription).where(eq(schema.subscription.workspaceId, workspaceId)),
  );
  return row;
};

const quiet = { info: () => undefined, warn: () => undefined };

beforeAll(async () => {
  await seedPlans(testAppDb());
});

describe('POST /v1/webhooks/razorpay', () => {
  it('rejects a missing or invalid signature with 400 and stores nothing', async () => {
    const { app, sent } = harness();
    const provider = createMockBillingProvider();
    const { workspace, storedId, providerSubscriptionId } = await subscribedWorkspace(provider);
    await provider.authorizeMandate(providerSubscriptionId);
    const { rawBody, signature, eventId } = latestDelivery(provider, storedId);

    for (const bad of [
      undefined,
      '',
      'deadbeef',
      signRazorpayWebhook(rawBody, new Secret('some-other-secret')),
      signRazorpayWebhook(`${rawBody} `, MOCK_WEBHOOK_SECRET),
    ]) {
      const response = await post(app, rawBody, bad, eventId);
      expect(response.status).toBe(400);
      const problem = await problemOf(response);
      expect(problem.code).toBe('VALIDATION');
      expect(JSON.stringify(problem)).not.toContain(signature);
    }
    expect(await eventsOf(workspace.id)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('rejects every call when the app has no webhook secret', async () => {
    const app = makeApp({ now });
    const body = JSON.stringify({ event: 'subscription.charged', payload: {}, created_at: 0 });
    const response = await post(app, body, signRazorpayWebhook(body, MOCK_WEBHOOK_SECRET));
    expect(response.status).toBe(400);
  });

  it('rejects a missing event id, a non-event body and a stale event with 400', async () => {
    const { app, sent } = harness();
    const fresh = JSON.stringify({
      entity: 'event',
      event: 'subscription.charged',
      payload: {},
      created_at: MOCK_EPOCH.getTime() / 1000,
    });
    const sign = (body: string) => signRazorpayWebhook(body, MOCK_WEBHOOK_SECRET);
    expect((await post(app, fresh, sign(fresh), null)).status).toBe(400);
    expect((await post(app, '[1,2]', sign('[1,2]'))).status).toBe(400);
    expect((await post(app, 'not json', sign('not json'))).status).toBe(400);
    const stale = JSON.stringify({
      entity: 'event',
      event: 'subscription.charged',
      payload: {},
      created_at: MOCK_EPOCH.getTime() / 1000 - 73 * 3600,
    });
    const response = await post(app, stale, sign(stale));
    expect(response.status).toBe(400);
    expect((await problemOf(response)).detail).toMatch(/replay window/);
    expect(sent).toEqual([]);
  });

  it('queues a valid delivery in under 500 ms and treats a replay as a no-op', async () => {
    const { app, sent, lines } = harness();
    const provider = createMockBillingProvider();
    const { workspace, storedId, providerSubscriptionId } = await subscribedWorkspace(provider);
    // Warm the connection pool and the route so the timing measures the handler.
    const warm = JSON.stringify({ event: 'payment.captured', payload: {}, created_at: 1767225600 });
    await post(app, warm, signRazorpayWebhook(warm, MOCK_WEBHOOK_SECRET));

    await provider.authorizeMandate(providerSubscriptionId);
    const started = performance.now();
    const { signed, response } = await deliverLatest(app, provider, storedId);
    const elapsed = performance.now() - started;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(elapsed).toBeLessThan(500);

    expect(sent).toEqual([
      {
        name: 'billing.process-event',
        data: { workspaceId: workspace.id, providerEventId: signed.eventId },
      },
    ]);
    const [stored] = await eventsOf(workspace.id);
    expect(stored).toMatchObject({
      providerEventId: signed.eventId,
      type: 'subscription.activated',
      processedAt: null,
    });
    expect(JSON.stringify(stored?.payload)).not.toContain('@example.in');

    // Replay: 200, no new row, no second job, and the subscription is untouched.
    const replay = await post(app, signed.rawBody, signed.signature, signed.eventId);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect(await eventsOf(workspace.id)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await subscriptionOf(workspace.id))?.status).toBe('trialing');

    const logged = JSON.stringify(lines);
    expect(logged).toContain('billing webhook queued');
    expect(logged).not.toContain(signed.signature);
    expect(logged).not.toContain(MOCK_WEBHOOK_SECRET.reveal());
  });

  it('resolves the workspace from the stored provider id, never from payload metadata', async () => {
    const { app, sent } = harness();
    const provider = createMockBillingProvider();
    const victim = await subscribedWorkspace(createMockBillingProvider());
    // The payer's notes name another workspace; they must not route the event there.
    const owner = await subscribedWorkspace(provider, {
      workspace_id: victim.workspace.id,
      workspaceId: victim.workspace.id,
    });
    await provider.authorizeMandate(owner.providerSubscriptionId);
    const { signed, response } = await deliverLatest(app, provider, owner.storedId);
    expect(response.status).toBe(200);
    expect(sent.at(-1)?.data).toEqual({
      workspaceId: owner.workspace.id,
      providerEventId: signed.eventId,
    });
    expect(await eventsOf(owner.workspace.id)).toHaveLength(1);
    expect(await eventsOf(victim.workspace.id)).toEqual([]);

    // A subscription nobody stored is acknowledged and dropped, even if notes name a workspace.
    const stranger = createMockBillingProvider();
    const customer = await stranger.createCustomer({ email: 'x@example.in' });
    const orphan = await stranger.createSubscription({
      customerId: customer.id,
      planId: 'chamber-seat-1',
      quantity: 3,
      notes: { workspace_id: victim.workspace.id },
    });
    await stranger.authorizeMandate(orphan.id);
    const before = sent.length;
    const { rawBody, signature, eventId } = latestDelivery(stranger, `sub_unknown_${randomUUID()}`);
    const unknown = await post(app, rawBody, signature, eventId);
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ received: true });
    expect(sent).toHaveLength(before);
    expect(await eventsOf(victim.workspace.id)).toEqual([]);
  });

  it('drives the mock flow end to end: activate, charge, fail, halt, cancel', async () => {
    const { app, sent } = harness();
    const provider = createMockBillingProvider();
    const { workspace, started, storedId, providerSubscriptionId } =
      await subscribedWorkspace(provider);
    expect(started.mandateUrl).toMatch(/^https:\/\/mock\.razorpay\.local\/mandate\//);

    const steps = [
      [() => provider.authorizeMandate(providerSubscriptionId), 'active', false],
      [() => provider.simulate(providerSubscriptionId, 'subscription.charged'), 'active', false],
      [() => provider.simulate(providerSubscriptionId, 'payment.failed'), 'past_due', false],
      [() => provider.simulate(providerSubscriptionId, 'subscription.halted'), 'past_due', true],
      [
        () => provider.simulate(providerSubscriptionId, 'subscription.cancelled'),
        'cancelled',
        false,
      ],
    ] as const;
    for (const [raise, status, grace] of steps) {
      await raise();
      const { response } = await deliverLatest(app, provider, storedId);
      expect(response.status).toBe(200);
      const job = sent.at(-1);
      if (!job) throw new Error('no job');
      expect(job.name).toBe('billing.process-event');
      const ctx = { db: testAppDb(), log: quiet as never };
      expect(await runBillingProcessEvent(ctx, job.data, { now })).toBe('applied');
      // The job runs once per event: a retry is a no-op.
      expect(await runBillingProcessEvent(ctx, job.data, { now })).toBe('already_processed');
      const row = await subscriptionOf(workspace.id);
      expect(row?.status).toBe(status);
      expect(row?.graceUntil !== null).toBe(grace);
    }
    expect(sent).toHaveLength(steps.length);
    const events = await eventsOf(workspace.id);
    expect(events.map((e) => e.type).sort()).toEqual(
      [
        'payment.failed',
        'subscription.activated',
        'subscription.cancelled',
        'subscription.charged',
        'subscription.halted',
      ].sort(),
    );
    expect(events.every((e) => e.processedAt !== null)).toBe(true);
  });
});

describe('GET /v1/billing', () => {
  it('lists the active plans to a signed-in caller', async () => {
    const app = makeApp();
    expect((await call(app, '/v1/billing/plans')).status).toBe(401);
    const user = await signIn();
    const response = await call(app, '/v1/billing/plans', { cookie: user.cookie });
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { id: string; pricePaise: number }[] };
    expect(data.map((p) => p.id)).toContain('chamber-seat-1');
    expect(data.find((p) => p.id === 'junior')?.pricePaise).toBe(0);
  });

  it("returns the workspace's subscription without provider ids or contact data", async () => {
    const app = makeApp();
    const provider = createMockBillingProvider();
    const { owner, workspace, storedId } = await subscribedWorkspace(provider);
    const response = await call(app, '/v1/billing/subscription', {
      cookie: owner.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { subscription: Record<string, unknown> | null };
    expect(body.subscription).toMatchObject({
      planId: 'chamber-seat-1',
      status: 'trialing',
      seats: 3,
      clerkSeats: 0,
      cancelAtPeriodEnd: false,
    });
    const json = JSON.stringify(body);
    expect(json).not.toContain(storedId);
    expect(json).not.toContain(owner.email);
    expect(json).not.toContain('27AAPFU0939F1ZV');
  });

  it('returns null on the free plan and 403 to a non-member', async () => {
    const app = makeApp();
    const owner = await signIn();
    const workspace = await createWorkspace(owner.id);
    const free = await call(app, '/v1/billing/subscription', {
      cookie: owner.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(await free.json()).toEqual({ subscription: null });

    const outsider = await signIn();
    const denied = await call(app, '/v1/billing/subscription', {
      cookie: outsider.cookie,
      headers: { 'x-workspace-id': workspace.id },
    });
    expect(denied.status).toBe(403);
  });
});
