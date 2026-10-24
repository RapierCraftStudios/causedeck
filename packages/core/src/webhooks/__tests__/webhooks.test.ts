// Change webhooks (#626) on the Testcontainers database: a change on a watched item creates a signed
// delivery for a matching endpoint (not for another workspace, a sensitive matter or an endpoint that
// did not subscribe), the payload is content-free, and `webhook.deliver` retries then succeeds or
// stops on a permanent failure.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { WebhookDeliveryError } from '@causedeck/fetch';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createLogger } from '@causedeck/observability';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { JobContext } from '../../jobs/context.ts';
import { RetryableError } from '../../jobs/errors.ts';
import { runWebhookDeliver, WEBHOOK_RETRY_LIMIT } from '../../jobs/definitions/webhook-deliver.ts';
import { createWebhookEndpoint, emitWebhookEvent, verifyWebhookSignature } from '../index.ts';
import { WEBHOOK_HEADERS } from '../sign.ts';

const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

async function setup(tx: Transaction) {
  const { a, b, ua, ub } = await seedTwoTenants(tx);
  const ep = (workspaceId: string, actorUserId: string, events?: string[]) =>
    createWebhookEndpoint(tx, {
      workspaceId,
      actorUserId,
      url: 'https://hooks.example.com/in',
      ...(events === undefined ? {} : { events }),
    });
  const matterRow = (workspaceId: string, sensitive: boolean) =>
    inWorkspace(tx, workspaceId, async (s) => {
      const [row] = await s
        .insert(schema.matter)
        .values({ workspaceId, title: 'Party X v Party Y', practiceArea: 'civil', sensitive })
        .returning({ id: schema.matter.id });
      if (!row) throw new Error('matter insert failed');
      return row.id;
    });
  const deliveries = (workspaceId: string) =>
    inWorkspace(tx, workspaceId, (s) => s.select().from(schema.webhookDelivery));
  const event = (workspaceId: string, matterId: string, eventKey = 'status:snap-1') => ({
    workspaceId,
    type: 'status.changed' as const,
    eventKey,
    sourceId: 'ecourts-hc-ka',
    changes: ['next_date'],
    matterId,
  });
  const ctx = (workspaceId: string, deliveryId: string, attempt: number): JobContext => ({
    log: logger,
    db: tx,
    workspaceId,
    jobName: 'webhook.deliver',
    jobId: randomUUID(),
    attempt,
    signal: new AbortController().signal,
    idempotencyKey: `${deliveryId}:${String(attempt)}`,
  });
  return { a, b, ua, ub, ep, matterRow, deliveries, event, ctx };
}

describe('emitWebhookEvent', () => {
  it('creates one delivery per matching endpoint of the workspace only, once per event key', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      await f.ep(f.a.id, f.ua);
      await f.ep(f.a.id, f.ua, ['causelist.matched']);
      await f.ep(f.b.id, f.ub);
      const m = await f.matterRow(f.a.id, false);

      expect(await emitWebhookEvent({ db: tx }, f.event(f.a.id, m))).toBe(1);
      expect(await emitWebhookEvent({ db: tx }, f.event(f.a.id, m))).toBe(0);
      expect(await f.deliveries(f.a.id)).toHaveLength(1);
      expect(await f.deliveries(f.b.id)).toHaveLength(0);
    });
  });

  it('emits nothing for a sensitive matter', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      await f.ep(f.a.id, f.ua);
      const m = await f.matterRow(f.a.id, true);
      expect(await emitWebhookEvent({ db: tx }, f.event(f.a.id, m))).toBe(0);
      expect(await f.deliveries(f.a.id)).toHaveLength(0);
    });
  });

  it('stores a payload of ids and provenance, with no party names or judge data', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      await f.ep(f.a.id, f.ua);
      const m = await f.matterRow(f.a.id, false);
      await emitWebhookEvent({ db: tx }, f.event(f.a.id, m));
      const [row] = await f.deliveries(f.a.id);
      const text = JSON.stringify(row?.payload);
      expect(row?.payload).toMatchObject({
        type: 'status.changed',
        matterId: m,
        changes: ['next_date'],
        provenance: { sourceId: 'ecourts-hc-ka' },
      });
      expect(text).not.toMatch(/Party|judge|rating|rank|predict|order_text/i);
    });
  });
});

describe('webhook.deliver', () => {
  async function pending(f: Awaited<ReturnType<typeof setup>>) {
    const { secret } = await f.ep(f.a.id, f.ua);
    const m = await f.matterRow(f.a.id, false);
    await emitWebhookEvent({ db: f.ctx(f.a.id, 'x', 1).db }, f.event(f.a.id, m));
    const [row] = await f.deliveries(f.a.id);
    if (!row) throw new Error('no delivery');
    return { secret, id: row.id };
  }
  const tx_of = (f: Awaited<ReturnType<typeof setup>>) => f.ctx(f.a.id, 'x', 1).db;
  const state = (f: Awaited<ReturnType<typeof setup>>, id: string) =>
    inWorkspace(tx_of(f) as Transaction, f.a.id, async (s) => {
      const [d] = await s
        .select()
        .from(schema.webhookDelivery)
        .where(eq(schema.webhookDelivery.id, id));
      return d;
    });

  it('signs the body so the receiver can verify it, and marks the delivery delivered', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      const { secret, id } = await pending(f);
      const deliver = vi.fn().mockResolvedValue({ status: 204 });
      expect(
        await runWebhookDeliver(
          f.ctx(f.a.id, id, 1),
          { workspaceId: f.a.id, deliveryId: id },
          { deliver },
        ),
      ).toBe('delivered');
      const [url, request] = deliver.mock.calls[0] as [
        string,
        { body: string; headers: Record<string, string> },
      ];
      expect(url).toBe('https://hooks.example.com/in');
      const ts = Number(request.headers[WEBHOOK_HEADERS.timestamp]);
      expect(
        verifyWebhookSignature(
          secret,
          ts,
          request.body,
          request.headers[WEBHOOK_HEADERS.signature] ?? '',
        ),
      ).toBe(true);
      expect((await state(f, id))?.status).toBe('delivered');
    });
  });

  it('retries a 503 then succeeds on the next attempt', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      const { id } = await pending(f);
      const payload = { workspaceId: f.a.id, deliveryId: id };
      const deliver = vi
        .fn()
        .mockResolvedValueOnce({ status: 503 })
        .mockResolvedValueOnce({ status: 200 });
      await expect(
        runWebhookDeliver(f.ctx(f.a.id, id, 1), payload, { deliver }),
      ).rejects.toBeInstanceOf(RetryableError);
      expect((await state(f, id))?.status).toBe('pending');
      expect(await runWebhookDeliver(f.ctx(f.a.id, id, 2), payload, { deliver })).toBe('delivered');
    });
  });

  it('records a permanent failure at once and does not retry it', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      const { id } = await pending(f);
      const deliver = vi.fn().mockResolvedValue({ status: 400 });
      expect(
        await runWebhookDeliver(
          f.ctx(f.a.id, id, 1),
          { workspaceId: f.a.id, deliveryId: id },
          { deliver },
        ),
      ).toBe('failed');
      const row = await state(f, id);
      expect(row).toMatchObject({ status: 'failed', lastStatus: 400 });
      expect(deliver).toHaveBeenCalledTimes(1);
    });
  });

  it('fails a refused address without retrying, and a retryable error on the last attempt', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      const { id } = await pending(f);
      const payload = { workspaceId: f.a.id, deliveryId: id };
      const blocked = vi.fn().mockRejectedValue(new WebhookDeliveryError('blocked_address'));
      expect(await runWebhookDeliver(f.ctx(f.a.id, id, 1), payload, { deliver: blocked })).toBe(
        'failed',
      );
    });
  });

  it('records a retryable failure as failed on the last attempt', async () => {
    await withTestDb(async (tx) => {
      const f = await setup(tx);
      const { id } = await pending(f);
      const deliver = vi.fn().mockResolvedValue({ status: 503 });
      const last = WEBHOOK_RETRY_LIMIT + 1;
      expect(
        await runWebhookDeliver(
          f.ctx(f.a.id, id, last),
          { workspaceId: f.a.id, deliveryId: id },
          { deliver },
        ),
      ).toBe('failed');
      expect((await state(f, id))?.status).toBe('failed');
    });
  });
});
