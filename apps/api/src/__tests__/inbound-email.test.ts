// `POST /v1/inbound/email` (#530) on the real app and the #6 Testcontainers database. The provider
// is a stub that verifies a shared secret; a stub sender captures the `email.intake` jobs. No
// network, no mail transport.
import { randomUUID } from 'node:crypto';

import { createAddress, type InboundEmailProvider } from '@causedeck/core/email-intake';
import type { JobSender } from '@causedeck/core/jobs';
import { schema, testAppDb, withWorkspace } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { call, createWorkspace, makeApp, memoryLogger, problemOf, signIn } from './helpers.ts';

const PATH = '/v1/inbound/email';
const SECRET = 'inbound-test-secret';

interface Sent {
  name: string;
  data: { workspaceId: string; userId: string; intakeMessageId: string };
}

const provider: InboundEmailProvider = {
  id: 'file',
  verify: (request) => {
    if (request.headers['x-test-secret'] !== SECRET) {
      return Promise.resolve({ ok: false as const, reason: 'bad_secret' });
    }
    const n = JSON.parse(request.body) as { messageId: string; recipients: string[] };
    return Promise.resolve({
      ok: true as const,
      notifications: [{ messageId: n.messageId, recipients: n.recipients, rawRef: 'a.eml' }],
    });
  },
  fetchRaw: () => Promise.resolve(new Uint8Array()),
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
    inboundEmail: { provider: withProvider ? provider : null, sender },
  });
  return { app, sent, lines };
}

const post = (app: ReturnType<typeof makeApp>, body: object, secret = SECRET) =>
  call(app, PATH, { method: 'POST', body, headers: { 'x-test-secret': secret } });

/** A workspace whose owner has an intake address; the `email` channel is on when `enabled`. */
async function intakeWorkspace(enabled: boolean) {
  const owner = await signIn();
  const workspace = await createWorkspace(owner.id);
  const view = await createAddress({
    db: testAppDb(),
    workspaceId: workspace.id,
    userId: owner.id,
    domain: 'intake.test',
    authorize: () => undefined,
  });
  if (enabled) {
    await withWorkspace(testAppDb(), { workspaceId: workspace.id }, (tx) =>
      tx
        .insert(schema.workspaceCaptureChannel)
        .values({ workspaceId: workspace.id, channel: 'email', enabled: true }),
    );
  }
  return { owner, workspace, address: view.address };
}

const messagesOf = (workspaceId: string) =>
  withWorkspace(testAppDb(), { workspaceId }, (tx) =>
    tx.select().from(schema.intakeMessage).where(eq(schema.intakeMessage.workspaceId, workspaceId)),
  );

describe('POST /v1/inbound/email', () => {
  it('rejects a call the provider does not verify, and every call without a provider', async () => {
    const { app, sent } = harness();
    const response = await post(app, { messageId: 'm1', recipients: ['u@x.test'] }, 'wrong');
    expect(response.status).toBe(400);
    expect((await problemOf(response)).code).toBe('VALIDATION');
    const none = harness(false);
    expect((await post(none.app, { messageId: 'm1', recipients: ['u@x.test'] })).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('stores a message once per workspace and queues email.intake with ids only', async () => {
    const { app, sent } = harness();
    const { owner, workspace, address } = await intakeWorkspace(true);
    const messageId = `<${randomUUID()}@mail.test>`;
    const body = { messageId, recipients: [address] };

    const first = await post(app, body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    const replay = await post(app, body);
    expect(replay.status).toBe(200);

    const rows = await messagesOf(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ messageId, status: 'received', rawMimeRef: 'a.eml' });
    expect((rows[0]?.rawExpiresAt.getTime() ?? 0) - (rows[0]?.receivedAt.getTime() ?? 0)).toBe(
      30 * 86_400_000,
    );
    expect(sent).toEqual([
      {
        name: 'email.intake',
        data: { workspaceId: workspace.id, userId: owner.id, intakeMessageId: rows[0]?.id },
      },
    ]);
  });

  it('acknowledges unknown addresses and a disabled channel without processing', async () => {
    const { app, sent, lines } = harness();
    const off = await intakeWorkspace(false);
    const unknown = 'u-aaaaaaaaaa@intake.test';
    for (const address of [off.address, unknown]) {
      const response = await post(app, {
        messageId: `<${randomUUID()}@m.test>`,
        recipients: [address],
      });
      expect(response.status).toBe(200);
    }
    expect(await messagesOf(off.workspace.id)).toEqual([]);
    expect(sent).toEqual([]);
    const reasons = lines
      .filter((l) => l['msg'] === 'inbound email dropped')
      .map((l) => l['reason']);
    expect(reasons).toEqual(['channel_disabled', 'unknown_address']);
    expect(JSON.stringify(lines)).not.toContain(off.address);
  });
});
