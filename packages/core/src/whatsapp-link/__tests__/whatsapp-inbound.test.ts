// Inbound WhatsApp forward-in (#680) against the real test database: `receiveInboundWhatsApp`
// resolves the sender without an oracle and records a message once per workspace, and
// `runWhatsAppIntake` stores the media as a `whatsapp` capture of the linked member. Every test
// runs in a rolled-back transaction.
import { randomInt } from 'node:crypto';

import { captureConfigFromEnv, type WhatsAppInboundMessage } from '@causedeck/capture';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMemoryObjectStore } from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_DISCLOSURE_VERSION } from '../../capture/index.ts';
import { receiveInboundWhatsApp, runWhatsAppIntake } from '../index.ts';

const PDF = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'));
// An Ogg page header (27 bytes + one segment byte) followed by an Opus head packet.
const OGG = new Uint8Array(
  Buffer.concat([
    Buffer.from('OggS'),
    Buffer.from([0, 2]),
    Buffer.alloc(20),
    Buffer.from([1, 19]),
    Buffer.from('OpusHead'),
    Buffer.from([1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]),
  ]),
);

const number = () => `+9198${String(randomInt(10_000_000, 99_999_999))}`;

async function setup(tx: Transaction, channelOn = true) {
  const { a, b, ua, ub } = await seedTwoTenants(tx);
  const e164 = number();
  const now = new Date();
  for (const [workspaceId, userId] of [
    [a.id, ua],
    [b.id, ub],
  ] as const) {
    await inWorkspace(tx, workspaceId, async (s) => {
      await s.delete(schema.whatsappLink);
    });
    if (workspaceId === a.id) {
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .insert(schema.whatsappLink)
          .values({ workspaceId, userId, e164, verifiedAt: now, consentAt: now }),
      );
    }
  }
  if (channelOn) {
    await inWorkspace(tx, a.id, (s) =>
      s
        .insert(schema.workspaceCaptureChannel)
        .values({
          workspaceId: a.id,
          channel: 'whatsapp',
          enabled: true,
          disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
        })
        .onConflictDoUpdate({
          target: [
            schema.workspaceCaptureChannel.workspaceId,
            schema.workspaceCaptureChannel.channel,
          ],
          set: { enabled: true, disclosureVersion: CAPTURE_DISCLOSURE_VERSION },
        }),
    );
  }
  const message = (over: Partial<WhatsAppInboundMessage> = {}): WhatsAppInboundMessage => ({
    providerMessageId: `wamid.${String(randomInt(1e9))}`,
    from: e164,
    mediaId: 'm1',
    mime: 'application/pdf',
    filename: 'order.pdf',
    ...over,
  });
  return { a, b, ua, e164, message };
}

const captures = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s
      .select()
      .from(schema.capture)
      .where(
        and(eq(schema.capture.workspaceId, workspaceId), eq(schema.capture.channel, 'whatsapp')),
      ),
  );

describe('receiveInboundWhatsApp', () => {
  it('accepts a PDF and a voice note once, and runs the enqueue in the same transaction', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, message } = await setup(tx);
      const queued = vi.fn(() => Promise.resolve());
      const pdf = message();
      const first = await receiveInboundWhatsApp(tx, { message: pdf }, queued);
      expect(first).toMatchObject({ status: 'accepted', workspaceId: a.id, userId: ua });
      expect(await receiveInboundWhatsApp(tx, { message: pdf }, queued)).toEqual({
        status: 'duplicate',
      });
      const voice = message({ mime: 'audio/ogg; codecs=opus', filename: '' });
      expect((await receiveInboundWhatsApp(tx, { message: voice }, queued)).status).toBe(
        'accepted',
      );
      expect(queued).toHaveBeenCalledTimes(2);
    });
  });

  it('drops unknown numbers, a disallowed type and a disabled channel silently', async () => {
    await withTestDb(async (tx) => {
      const { message } = await setup(tx);
      expect(await receiveInboundWhatsApp(tx, { message: message({ from: number() }) })).toEqual({
        status: 'dropped',
        reason: 'unknown_sender',
      });
      expect(await receiveInboundWhatsApp(tx, { message: message({ from: 'x' }) })).toEqual({
        status: 'dropped',
        reason: 'unknown_sender',
      });
      expect(
        await receiveInboundWhatsApp(tx, {
          message: message({ mime: 'video/mp4', filename: 'c.mp4' }),
        }),
      ).toEqual({ status: 'dropped', reason: 'unsupported_type' });
    });
    await withTestDb(async (tx) => {
      const { message } = await setup(tx, false);
      expect(await receiveInboundWhatsApp(tx, { message: message() })).toEqual({
        status: 'dropped',
        reason: 'channel_disabled',
      });
    });
  });
});

describe('runWhatsAppIntake', () => {
  it('stores the media as a whatsapp capture in the linked workspace only, and queues it', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, message } = await setup(tx);
      const received = await receiveInboundWhatsApp(tx, { message: message() });
      if (received.status !== 'accepted') throw new Error('expected accepted');
      const process = vi.fn(() => Promise.resolve());
      const deps = {
        db: tx,
        store: createMemoryObjectStore(),
        provider: { fetchMedia: () => Promise.resolve(PDF) },
        config: captureConfigFromEnv({}),
        jobs: { scan: () => Promise.resolve(), process },
      };
      const payload = {
        workspaceId: a.id,
        userId: ua,
        inboundMessageId: received.inboundMessageId,
      };
      const outcome = await runWhatsAppIntake(deps, payload);
      expect(outcome.outcome).toBe('stored');
      const rows = await captures(tx, a.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        channel: 'whatsapp',
        createdBy: ua,
        mime: 'application/pdf',
      });
      expect(['queued', 'scanning']).toContain(rows[0]?.status);
      expect(await captures(tx, b.id)).toEqual([]);
      // Idempotent: a retry of the same job does nothing.
      expect(await runWhatsAppIntake(deps, payload)).toEqual({ outcome: 'skipped' });
      expect(await captures(tx, a.id)).toHaveLength(1);

      const voice = await receiveInboundWhatsApp(tx, {
        message: message({ mime: 'audio/ogg', filename: '' }),
      });
      if (voice.status !== 'accepted') throw new Error('expected accepted');
      const voiced = await runWhatsAppIntake(
        { ...deps, provider: { fetchMedia: () => Promise.resolve(OGG) } },
        { ...payload, inboundMessageId: voice.inboundMessageId },
      );
      expect(voiced).toMatchObject({ outcome: 'stored' });
    });
  });

  it('drops bytes that are not the declared type', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, message } = await setup(tx);
      const received = await receiveInboundWhatsApp(tx, { message: message() });
      if (received.status !== 'accepted') throw new Error('expected accepted');
      const outcome = await runWhatsAppIntake(
        {
          db: tx,
          store: createMemoryObjectStore(),
          provider: { fetchMedia: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])) },
          config: captureConfigFromEnv({}),
          jobs: { scan: () => Promise.resolve(), process: () => Promise.resolve() },
        },
        { workspaceId: a.id, userId: ua, inboundMessageId: received.inboundMessageId },
      );
      expect(outcome).toEqual({ outcome: 'dropped', reason: 'content_mismatch' });
      expect(await captures(tx, a.id)).toEqual([]);
    });
  });
});
