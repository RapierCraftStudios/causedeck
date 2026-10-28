// `POST /v1/inbound/whatsapp` (#680) on the real app and the #6 Testcontainers database. The
// provider is a stub that verifies a shared secret; a stub sender captures the `whatsapp.intake`
// jobs. No network.
import { randomInt, randomUUID } from 'node:crypto';

import { CAPTURE_DISCLOSURE_VERSION } from '@causedeck/core/capture';
import type { JobSender } from '@causedeck/core/jobs';
import type { WhatsAppInboundProvider } from '@causedeck/core/whatsapp-link';

type WhatsAppInboundMessage = Extract<
  Awaited<ReturnType<WhatsAppInboundProvider['verify']>>,
  { ok: true }
>['messages'][number];
import { schema, testAppDb, withWorkspace } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { call, createWorkspace, makeApp, memoryLogger, problemOf, signIn } from './helpers.ts';

const PATH = '/v1/inbound/whatsapp';
const SECRET = 'wa-test-secret';

interface Sent {
  name: string;
  data: { workspaceId: string; userId: string; inboundMessageId: string };
}

const provider: WhatsAppInboundProvider = {
  id: 'meta',
  verify: (request) => {
    if (request.headers['x-test-secret'] !== SECRET) {
      return Promise.resolve({ ok: false as const, reason: 'bad_signature' });
    }
    return Promise.resolve({
      ok: true as const,
      messages: JSON.parse(request.body) as WhatsAppInboundMessage[],
    });
  },
  challenge: (query) =>
    query.mode === 'subscribe' && query.verifyToken === 'verify-me'
      ? (query.challenge ?? null)
      : null,
  fetchMedia: () => Promise.resolve(new Uint8Array()),
};

function harness(withProvider = true) {
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
    inboundWhatsapp: { provider: withProvider ? provider : null, sender },
  });
  return { app, sent, lines };
}

const post = (app: ReturnType<typeof makeApp>, messages: object[], secret = SECRET) =>
  call(app, PATH, { method: 'POST', body: messages, headers: { 'x-test-secret': secret } });

const message = (from: string, over: object = {}) => ({
  providerMessageId: `wamid.${randomUUID()}`,
  from,
  mediaId: 'm1',
  mime: 'application/pdf',
  filename: 'order.pdf',
  ...over,
});

/** A workspace whose owner verified a number; the `whatsapp` channel is on when `enabled`. */
async function linkedWorkspace(enabled: boolean) {
  const owner = await signIn();
  const workspace = await createWorkspace(owner.id);
  const e164 = `+9198${String(randomInt(10_000_000, 99_999_999))}`;
  const now = new Date();
  await withWorkspace(testAppDb(), { workspaceId: workspace.id }, async (tx) => {
    await tx.insert(schema.whatsappLink).values({
      workspaceId: workspace.id,
      userId: owner.id,
      e164,
      verifiedAt: now,
      consentAt: now,
    });
    if (enabled) {
      await tx.insert(schema.workspaceCaptureChannel).values({
        workspaceId: workspace.id,
        channel: 'whatsapp',
        enabled: true,
        disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
      });
    }
  });
  return { owner, workspace, e164 };
}

const rowsOf = (workspaceId: string) =>
  withWorkspace(testAppDb(), { workspaceId }, (tx) =>
    tx
      .select()
      .from(schema.whatsappInboundMessage)
      .where(eq(schema.whatsappInboundMessage.workspaceId, workspaceId)),
  );

describe('POST /v1/inbound/whatsapp', () => {
  it('rejects an unverified call, and every call without a provider', async () => {
    const { app, sent } = harness();
    const response = await post(app, [], 'wrong');
    expect(response.status).toBe(400);
    expect((await problemOf(response)).code).toBe('VALIDATION');
    expect((await post(harness(false).app, [])).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('stores a message once and queues whatsapp.intake with ids only', async () => {
    const { app, sent } = harness();
    const { owner, workspace, e164 } = await linkedWorkspace(true);
    const pdf = message(e164);
    const voice = message(e164, { mime: 'audio/ogg; codecs=opus', filename: '' });

    expect((await post(app, [pdf, voice])).status).toBe(200);
    expect((await post(app, [pdf])).status).toBe(200);

    const rows = await rowsOf(workspace.id);
    expect(rows.map((r) => r.providerMessageId).sort()).toEqual(
      [pdf.providerMessageId, voice.providerMessageId].sort(),
    );
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      name: 'whatsapp.intake',
      data: {
        workspaceId: workspace.id,
        userId: owner.id,
        inboundMessageId: expect.any(String) as string,
      },
    });
  });

  it('acknowledges unknown senders, a disallowed type and a disabled channel without storing', async () => {
    const { app, sent, lines } = harness();
    const on = await linkedWorkspace(true);
    const off = await linkedWorkspace(false);
    const stranger = `+9198${String(randomInt(10_000_000, 99_999_999))}`;
    const response = await post(app, [
      message(stranger),
      message(on.e164, { mime: 'video/mp4', filename: 'c.mp4' }),
      message(off.e164),
    ]);
    expect(response.status).toBe(200);
    expect(await rowsOf(on.workspace.id)).toEqual([]);
    expect(await rowsOf(off.workspace.id)).toEqual([]);
    expect(sent).toEqual([]);
    const reasons = lines
      .filter((l) => l['msg'] === 'inbound whatsapp dropped')
      .map((l) => l['reason']);
    expect(reasons).toEqual(['unknown_sender', 'unsupported_type', 'channel_disabled']);
    expect(JSON.stringify(lines)).not.toContain(on.e164);
  });

  it('answers the handshake only for the verify token', async () => {
    const { app } = harness();
    const q = (token: string) =>
      call(app, `${PATH}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=777`);
    const ok = await q('verify-me');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('777');
    expect((await q('nope')).status).toBe(400);
  });
});
