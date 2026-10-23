// The inbound side of email intake (#530), against the real test database: `receiveInboundEmail`
// records a message once, `runEmailIntake` takes the synthetic AIMS email through the file
// provider, quarantines an unknown sender with a Needs-you item and no parsing, drops an
// auto-reply, and `sweepExpiredRawMime` deletes raw MIME past 30 days unless pinned. Every test
// runs in a rolled-back transaction.
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureConfigFromEnv, createFileProvider } from '@causedeck/capture';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMemoryObjectStore } from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { enableEmailChannel } from '../channel.ts';
import {
  addAllowlistEntry,
  createAddress,
  receiveInboundEmail,
  runEmailIntake,
  sweepExpiredRawMime,
  type EmailIntakeDeps,
  type EmailIntakeCtx,
} from '../index.ts';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../capture/fixtures/email',
);
const DAY_MS = 86_400_000;

const ctxFor = (tx: EmailIntakeCtx['db'], workspaceId: string, userId: string): EmailIntakeCtx => ({
  db: tx,
  workspaceId,
  userId,
  domain: 'intake.test',
  authorize: () => undefined,
});

async function setup(tx: Transaction) {
  const { a, b, uboth } = await seedTwoTenants(tx);
  await enableEmailChannel({
    db: tx,
    store: createMemoryObjectStore(),
    workspaceId: a.id,
    userId: uboth,
    authorize: () => undefined,
    config: captureConfigFromEnv({}),
    jobs: { scan: () => Promise.resolve(), process: () => Promise.resolve() },
  });
  const { address } = await createAddress(ctxFor(tx, a.id, uboth));
  await addAllowlistEntry(ctxFor(tx, a.id, uboth), {
    pattern: 'aims-registry@example.test',
    kind: 'court',
  });
  const process = vi.fn(() => Promise.resolve());
  const discard = vi.fn(() => Promise.resolve());
  const provider = createFileProvider({ dir: FIXTURES, secret: 'unused' });
  const deps: EmailIntakeDeps = {
    db: tx,
    store: createMemoryObjectStore(),
    provider,
    config: captureConfigFromEnv({}),
    jobs: { scan: () => Promise.resolve(), process },
  };
  const receive = async (file: string, messageId: string) => {
    const outcome = await receiveInboundEmail(tx, { address, messageId, rawMimeRef: file });
    if (outcome.status !== 'accepted') throw new Error(`not accepted: ${outcome.status}`);
    return { workspaceId: a.id, userId: uboth, intakeMessageId: outcome.intakeMessageId };
  };
  return { a, b, uboth, address, deps, receive, process, discard };
}

const messageOf = (tx: Transaction, workspaceId: string, id: string) =>
  inWorkspace(tx, workspaceId, async (s) => {
    const [row] = await s
      .select()
      .from(schema.intakeMessage)
      .where(eq(schema.intakeMessage.id, id));
    return row;
  });

const emailCaptures = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s
      .select()
      .from(schema.capture)
      .where(and(eq(schema.capture.workspaceId, workspaceId), eq(schema.capture.channel, 'email'))),
  );

describe('receiveInboundEmail', () => {
  it('stores a message once and runs the enqueue callback in the same transaction', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth, address } = await setup(tx);
      const queued = vi.fn(() => Promise.resolve());
      const input = { address, messageId: '<dup-1@mail.test>', rawMimeRef: 'aims-plain.eml' };
      const first = await receiveInboundEmail(tx, input, queued);
      expect(first).toMatchObject({ status: 'accepted', workspaceId: a.id, userId: uboth });
      expect(await receiveInboundEmail(tx, input, queued)).toEqual({ status: 'duplicate' });
      expect(queued).toHaveBeenCalledTimes(1);

      if (first.status !== 'accepted') throw new Error('expected accepted');
      const row = await messageOf(tx, a.id, first.intakeMessageId);
      expect(row?.status).toBe('received');
      expect((row?.rawExpiresAt.getTime() ?? 0) - (row?.receivedAt.getTime() ?? 0)).toBe(
        30 * DAY_MS,
      );
    });
  });

  it('drops an unknown address, and a workspace whose email channel is off', async () => {
    await withTestDb(async (tx) => {
      const { b, uboth } = await setup(tx);
      const unknown = await receiveInboundEmail(tx, {
        address: 'u-aaaaaaaaaa@intake.test',
        messageId: '<x@mail.test>',
        rawMimeRef: 'a.eml',
      });
      expect(unknown).toEqual({ status: 'dropped', reason: 'unknown_address' });

      // B has an address but its email channel is off (the seeder enables it, so turn it off).
      await tx
        .update(schema.workspaceCaptureChannel)
        .set({ enabled: false })
        .where(eq(schema.workspaceCaptureChannel.workspaceId, b.id));
      const { address } = await createAddress(ctxFor(tx, b.id, uboth));
      const off = await receiveInboundEmail(tx, {
        address,
        messageId: '<y@mail.test>',
        rawMimeRef: 'a.eml',
      });
      expect(off).toEqual({ status: 'dropped', reason: 'channel_disabled' });
    });
  });
});

describe('runEmailIntake', () => {
  it('takes the synthetic AIMS email through the file provider, once', async () => {
    await withTestDb(async (tx) => {
      const { a, deps, receive } = await setup(tx);
      const payload = await receive('aims-plain.eml', '<email-01@example.test>');
      const done = await runEmailIntake(deps, payload);
      expect(done).toMatchObject({ outcome: 'processed', parserId: 'aims-cause-list' });
      expect((await messageOf(tx, a.id, payload.intakeMessageId))?.status).toBe('processed');

      const captures = await emailCaptures(tx, a.id);
      expect(captures.length).toBeGreaterThan(0);
      expect(captures[0]).toMatchObject({ mime: 'text/plain', status: 'ready', aiBlocked: false });
      expect(captures[0]?.ttlAt).not.toBeNull();

      // A second delivery of the job does nothing.
      expect(await runEmailIntake(deps, payload)).toEqual({ outcome: 'skipped' });
      expect(await emailCaptures(tx, a.id)).toHaveLength(captures.length);
    });
  });

  it('quarantines an unknown sender with a Needs-you item and parses nothing', async () => {
    await withTestDb(async (tx) => {
      const { a, deps, receive, process } = await setup(tx);
      const payload = await receive('spoofed-sender.eml', '<spoof-1@example.test>');
      const done = await runEmailIntake(deps, payload);
      expect(done).toMatchObject({ outcome: 'quarantined', reason: 'sender_not_allowed' });
      expect((await messageOf(tx, a.id, payload.intakeMessageId))?.status).toBe('quarantined');

      const captures = await emailCaptures(tx, a.id);
      expect(captures).toHaveLength(1);
      expect(captures[0]).toMatchObject({
        status: 'needs_you',
        aiBlocked: true,
        rawStorageKey: null,
      });
      expect(captures[0]?.sourceMeta).toMatchObject({
        needsYouReason: 'unrecognised_sender',
        intakeMessageId: payload.intakeMessageId,
      });
      expect(process).not.toHaveBeenCalled();
    });
  });

  it('drops an out-of-office reply', async () => {
    await withTestDb(async (tx) => {
      const { a, deps, receive } = await setup(tx);
      const payload = await receive('out-of-office.eml', '<ooo-1@example.test>');
      expect(await runEmailIntake(deps, payload)).toMatchObject({
        outcome: 'dropped',
        reason: 'auto_reply',
      });
      expect((await messageOf(tx, a.id, payload.intakeMessageId))?.status).toBe('dropped');
      expect(await emailCaptures(tx, a.id)).toEqual([]);
    });
  });

  it('leaves a message that does not exist, and a message of another workspace, alone', async () => {
    await withTestDb(async (tx) => {
      const { b, uboth, deps, receive } = await setup(tx);
      const payload = await receive('aims-plain.eml', '<email-02@example.test>');
      expect(await runEmailIntake(deps, { ...payload, intakeMessageId: randomUUID() })).toEqual({
        outcome: 'missing',
      });
      // B's scope cannot see A's message.
      expect(await runEmailIntake(deps, { ...payload, workspaceId: b.id, userId: uboth })).toEqual({
        outcome: 'missing',
      });
    });
  });
});

describe('sweepExpiredRawMime', () => {
  it('deletes raw MIME past 30 days, keeps a pinned one, and is idempotent', async () => {
    await withTestDb(async (tx) => {
      const { a, receive, discard } = await setup(tx);
      const old = await receive('aims-plain.eml', '<old@example.test>');
      const pinned = await receive('aims-html.eml', '<pinned@example.test>');
      await inWorkspace(tx, a.id, (s) =>
        s
          .update(schema.intakeMessage)
          .set({ pinned: true })
          .where(eq(schema.intakeMessage.id, pinned.intakeMessageId)),
      );
      const deps = { db: tx, provider: { discardRaw: discard } };

      const early = await sweepExpiredRawMime(
        { ...deps, now: () => new Date(Date.now() + 29 * DAY_MS) },
        a.id,
      );
      expect(early).toEqual({ deleted: 0 });

      const late = () => new Date(Date.now() + 31 * DAY_MS);
      expect(await sweepExpiredRawMime({ ...deps, now: late }, a.id)).toEqual({ deleted: 1 });
      expect(discard).toHaveBeenCalledWith('aims-plain.eml');
      expect((await messageOf(tx, a.id, old.intakeMessageId))?.rawMimeRef).toBeNull();
      expect((await messageOf(tx, a.id, pinned.intakeMessageId))?.rawMimeRef).toBe('aims-html.eml');
      expect(await sweepExpiredRawMime({ ...deps, now: late }, a.id)).toEqual({ deleted: 0 });
    });
  });
});
