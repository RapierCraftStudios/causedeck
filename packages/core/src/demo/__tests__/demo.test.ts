// Demo mode (#93) on the Testcontainers database, as causedeck_app in a rolled-back transaction:
// entering a demo workspace (ephemeral visitor, 4-hour session), a visitor seeing nothing outside
// it, the `is_demo` guard on every outward channel (email, push, WhatsApp, webhook, invitation,
// AI), and the reset that restores a workspace and audits it.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { createAiPorts } from '../../ai/index.ts';
import { schema, withUser, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { DEMO_WORKSPACES, seedDemo } from '@causedeck/db/seed/demo';
import type { EmailMessage } from '@causedeck/notifications/email';
import { createLogger } from '@causedeck/observability';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  runDemoReset,
  runNotificationDeliver,
  runWebhookDeliver,
  type JobContext,
  type NotificationJobDeps,
} from '../../jobs/index.ts';
import { createWebhookEndpoint, emitWebhookEvent } from '../../webhooks/index.ts';
import { inviteMember } from '../../workspaces/index.ts';
import {
  assertNotDemoWorkspace,
  DEMO_BLOCKED_MESSAGE,
  DEMO_SESSION_TTL_MS,
  enterDemo,
  isDemoWorkspace,
  listDemoWorkspaces,
  resetDemo,
  sweepExpiredDemoVisitors,
} from '../index.ts';

const TODAY = '2026-10-21';
const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

const chennai = DEMO_WORKSPACES['chennai-solo'];
const bengaluru = DEMO_WORKSPACES['bengaluru-chamber'];

const ctxFor = (tx: Transaction, workspaceId: string, jobName: string): JobContext => ({
  log: logger,
  db: tx,
  workspaceId,
  jobName,
  jobId: randomUUID(),
  attempt: 1,
  signal: new AbortController().signal,
  idempotencyKey: randomUUID(),
});

/** Mark a workspace as a demo workspace (what the migration column and the seed do). */
function flagDemo(tx: Transaction, workspaceId: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .update(schema.organization)
      .set({ isDemo: true })
      .where(eq(schema.organization.id, workspaceId)),
  );
}

describe('demo mode: entering', () => {
  it('lists only the demo workspaces that exist', async () => {
    await withTestDb(async (tx) => {
      expect(await listDemoWorkspaces(tx)).toEqual([]);
      await seedDemo(tx, { today: TODAY });
      const listed = await listDemoWorkspaces(tx);
      expect(listed.map((w) => w.key)).toEqual(['chennai-solo', 'bengaluru-chamber']);
      expect(listed.every((w) => w.demoVersion !== null)).toBe(true);
    });
  });

  it('creates a visitor with a membership and a session end 4 hours out', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY });
      const now = new Date('2026-10-21T04:00:00Z');
      const entered = await enterDemo({ db: tx, now: () => now }, { workspace: 'chennai-solo' });
      expect(entered).toMatchObject({ workspaceId: chennai.id, slug: chennai.slug });
      expect(entered.expiresAt.getTime() - now.getTime()).toBe(DEMO_SESSION_TTL_MS);
      expect(DEMO_SESSION_TTL_MS).toBe(4 * 60 * 60 * 1000);
      const [u] = await tx
        .select({ email: schema.user.email, name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, entered.userId));
      expect(u?.email).toMatch(/^visitor\.chennai-solo\.[0-9a-f]{32}@demo\.causedeck\.test$/);
      expect(u?.name.endsWith('(fictional)')).toBe(true);
      const members = await inWorkspace(tx, chennai.id, (s) =>
        s
          .select({ role: schema.member.role })
          .from(schema.member)
          .where(eq(schema.member.userId, entered.userId)),
      );
      expect(members).toEqual([{ role: 'advocate' }]);
    });
  });

  it('refuses an unknown workspace and a demo that is not seeded', async () => {
    await withTestDb(async (tx) => {
      await expect(enterDemo({ db: tx }, { workspace: 'not-a-demo' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(enterDemo({ db: tx }, { workspace: 'chennai-solo' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  it('lets a visitor see their demo workspace and no other workspace', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      await seedDemo(tx, { today: TODAY });
      const entered = await enterDemo({ db: tx }, { workspace: 'bengaluru-chamber' });
      const visible = await withUser(tx, { userId: entered.userId }, (s) =>
        s.select({ id: schema.organization.id }).from(schema.organization),
      );
      expect(visible).toEqual([{ id: bengaluru.id }]);
      expect(visible.map((v) => v.id)).not.toContain(a.id);
      expect(visible.map((v) => v.id)).not.toContain(chennai.id);
      // Inside the demo workspace the visitor reads only its rows, never another workspace's.
      const matters = await inWorkspace(
        tx,
        bengaluru.id,
        (s) => s.select({ ws: schema.matter.workspaceId }).from(schema.matter),
        entered.userId,
      );
      expect(matters.length).toBe(40);
      expect(new Set(matters.map((m) => m.ws))).toEqual(new Set([bengaluru.id]));
    });
  });
});

describe('demo mode: the is_demo guard', () => {
  it('knows demo workspaces from ordinary ones and refuses outward actions', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      await seedDemo(tx, { today: TODAY });
      expect(await inWorkspace(tx, a.id, (s) => isDemoWorkspace(s, a.id))).toBe(false);
      expect(await inWorkspace(tx, chennai.id, (s) => isDemoWorkspace(s, chennai.id))).toBe(true);
      await inWorkspace(tx, a.id, (s) => assertNotDemoWorkspace(s, a.id));
      await expect(
        inWorkspace(tx, chennai.id, (s) => assertNotDemoWorkspace(s, chennai.id)),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: DEMO_BLOCKED_MESSAGE });
    });
  });

  it('skips email, push and WhatsApp delivery in a demo workspace', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const notificationFor = (channel: 'email' | 'push' | 'whatsapp') =>
        inWorkspace(tx, a.id, async (s) => {
          const [row] = await s
            .insert(schema.notification)
            .values({
              workspaceId: a.id,
              userId: ua,
              category: 'reminder.hearing',
              title: 'Hearing tomorrow',
              href: '/w/x/m/1',
            })
            .returning({ id: schema.notification.id });
          if (!row) throw new Error('notification insert failed');
          return { notificationId: row.id, channel, workspaceId: a.id };
        });
      const sent: EmailMessage[] = [];
      const push = { send: vi.fn(() => Promise.resolve({ delivered: 1, revoked: 0, failed: 0 })) };
      const whatsapp = { send: vi.fn(() => Promise.resolve()) };
      const deps: NotificationJobDeps = {
        appUrl: 'https://app.causedeck.test',
        email: {
          provider: 'console',
          send: (message: EmailMessage) => {
            sent.push(message);
            return Promise.resolve({ messageId: 'm' });
          },
        },
        push,
        whatsapp,
      } as unknown as NotificationJobDeps;
      const deliver = async (channel: 'email' | 'push' | 'whatsapp') => {
        const payload = await notificationFor(channel);
        return inWorkspace(tx, a.id, (s) =>
          runNotificationDeliver(ctxFor(s, a.id, 'notification.deliver'), payload, deps),
        );
      };

      await flagDemo(tx, a.id);
      for (const channel of ['email', 'push', 'whatsapp'] as const) {
        expect(await deliver(channel), channel).toBe('skipped');
      }
      expect(sent).toHaveLength(0);
      expect(push.send).not.toHaveBeenCalled();
      expect(whatsapp.send).not.toHaveBeenCalled();
      const rows = await inWorkspace(tx, a.id, (s) =>
        s.select({ data: schema.notification.data }).from(schema.notification),
      );
      const delivered = rows
        .map((row) => (row.data as { delivery?: Record<string, { reason: string }> }).delivery)
        .filter((d) => d !== undefined);
      expect(delivered).toHaveLength(3);
      for (const delivery of delivered) {
        expect(Object.values(delivery)[0]?.reason).toBe('demo_workspace');
      }
    });
  });

  it('creates and sends no webhook delivery for a demo workspace', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      await inWorkspace(tx, a.id, async (s) => {
        await s.delete(schema.webhookDelivery);
        await s.delete(schema.webhookEndpoint);
      });
      await createWebhookEndpoint(tx, {
        workspaceId: a.id,
        actorUserId: ua,
        url: 'https://hooks.example.com/in',
      });
      const matterId = await inWorkspace(tx, a.id, async (s) => {
        const [row] = await s
          .insert(schema.matter)
          .values({ workspaceId: a.id, title: 'X v. Y', practiceArea: 'civil', sensitive: false })
          .returning({ id: schema.matter.id });
        if (!row) throw new Error('matter insert failed');
        return row.id;
      });
      const event = (eventKey: string) => ({
        workspaceId: a.id,
        type: 'status.changed' as const,
        eventKey,
        sourceId: 'ecourts-hc-ka',
        changes: ['next_date'],
        matterId,
      });
      // Queued while ordinary; the workspace becomes a demo workspace before the job runs.
      expect(await emitWebhookEvent({ db: tx }, event('status:1'))).toBe(1);
      await flagDemo(tx, a.id);
      expect(await emitWebhookEvent({ db: tx }, event('status:2'))).toBe(0);

      const [delivery] = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.webhookDelivery),
      );
      const deliver = vi.fn(() => Promise.resolve({ status: 200 }));
      const outcome = await inWorkspace(tx, a.id, (s) =>
        runWebhookDeliver(
          ctxFor(s, a.id, 'webhook.deliver'),
          { workspaceId: a.id, deliveryId: delivery?.id ?? '' },
          { deliver },
        ),
      );
      expect(outcome).toBe('failed');
      expect(deliver).not.toHaveBeenCalled();
      const [after] = await inWorkspace(tx, a.id, (s) =>
        s
          .select({
            status: schema.webhookDelivery.status,
            error: schema.webhookDelivery.lastError,
          })
          .from(schema.webhookDelivery)
          .where(eq(schema.webhookDelivery.id, delivery?.id ?? '')),
      );
      expect(after).toEqual({ status: 'failed', error: 'demo_workspace' });
      const [endpoint] = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.webhookEndpoint),
      );
      expect(endpoint?.consecutiveFailures).toBe(0);
    });
  });

  it('refuses invitations in a demo workspace before any email is built', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      await flagDemo(tx, a.id);
      const send = vi.fn(() => Promise.resolve());
      await expect(
        inWorkspace(tx, a.id, (s) =>
          inviteMember(s, {
            workspaceId: a.id,
            actorUserId: ua,
            input: { email: 'someone@example.test', role: 'junior' },
            mailer: { send },
            appUrl: 'https://app.causedeck.test',
          }),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: DEMO_BLOCKED_MESSAGE });
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('refuses an AI call for a demo workspace and never reserves budget', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const ports = createAiPorts(tx);
      const before = await inWorkspace(tx, a.id, (s) => s.select().from(schema.usageReservation));
      await flagDemo(tx, a.id);
      await expect(ports.budget.reserve(a.id, 100, 'brief')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const after = await inWorkspace(tx, a.id, (s) => s.select().from(schema.usageReservation));
      expect(after).toHaveLength(before.length);
    });
  });
});

describe('demo mode: reset', () => {
  it('restores the workspace, removes its visitors and writes an audit event', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY });
      const entered = await enterDemo({ db: tx }, { workspace: 'chennai-solo' });
      await inWorkspace(tx, chennai.id, (s) => s.delete(schema.task));
      const tasksBefore = await inWorkspace(tx, chennai.id, (s) => s.select().from(schema.task));
      expect(tasksBefore).toHaveLength(0);

      const started = Date.now();
      const summaries = await resetDemo({ db: tx }, { workspace: 'chennai-solo', today: TODAY });
      expect(Date.now() - started).toBeLessThan(30_000);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        key: 'chennai-solo',
        workspaceId: chennai.id,
        visitors: 1,
      });

      expect(
        (await inWorkspace(tx, chennai.id, (s) => s.select().from(schema.task))).length,
      ).toBeGreaterThan(0);
      expect(await tx.select().from(schema.user).where(eq(schema.user.id, entered.userId))).toEqual(
        [],
      );
      const [settings] = await inWorkspace(tx, chennai.id, (s) =>
        s.select({ v: schema.workspaceSettings.demoVersion }).from(schema.workspaceSettings),
      );
      expect(settings?.v).toMatch(/^\d{4}\.\d{2}\.\d+$/);
      const audits = await inWorkspace(tx, chennai.id, (s) =>
        s
          .select({ actorKind: schema.auditEvent.actorKind, metadata: schema.auditEvent.metadata })
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, chennai.id),
              eq(schema.auditEvent.action, 'demo.reset'),
            ),
          ),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actorKind).toBe('system');
      expect(audits[0]?.metadata).toMatchObject({ visitors: 1 });
      // The other demo workspace is untouched.
      expect(
        (await inWorkspace(tx, bengaluru.id, (s) => s.select().from(schema.matter))).length,
      ).toBe(40);
    });
  });

  it('the nightly job resets every demo workspace and sweeps expired visitors', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY });
      const longAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const old = await enterDemo(
        { db: tx, now: () => longAgo },
        { workspace: 'bengaluru-chamber' },
      );
      const report = await runDemoReset(ctxFor(tx, '', 'system.demo.reset'), { today: TODAY });
      expect(report.workspaces.map((w) => w.key).sort()).toEqual([
        'bengaluru-chamber',
        'chennai-solo',
      ]);
      expect(report.workspaces.every((w) => w.ms < 30_000)).toBe(true);
      expect(await tx.select().from(schema.user).where(eq(schema.user.id, old.userId))).toEqual([]);
    });
  });

  it('sweeps only visitors older than the session lifetime', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY });
      const now = new Date('2026-10-21T12:00:00Z');
      const fresh = await enterDemo({ db: tx, now: () => now }, { workspace: 'chennai-solo' });
      const stale = await enterDemo(
        { db: tx, now: () => new Date(now.getTime() - DEMO_SESSION_TTL_MS - 60_000) },
        { workspace: 'chennai-solo' },
      );
      expect(await sweepExpiredDemoVisitors({ db: tx, now: () => now })).toBe(1);
      const left = await tx.select({ id: schema.user.id }).from(schema.user);
      expect(left.map((u) => u.id)).toContain(fresh.userId);
      expect(left.map((u) => u.id)).not.toContain(stale.userId);
    });
  });
});
