// The WhatsApp import (#526), against the real test database: the intake stores selected, rule-clean
// messages only; the job body sends internal chats to `structure_chat` and never a client chat.
import { captureConfigFromEnv } from '@causedeck/capture';
import { createMemoryObjectStore } from '@causedeck/storage';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { AiGateway } from '@causedeck/ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  CAPTURE_DISCLOSURE_VERSION,
  enableChannel,
  runCaptureProcess,
  type CaptureCtx,
} from '../../capture/index.ts';
import { receiveWhatsAppImport, runWhatsAppImport } from '../index.ts';

const NOW = new Date('2026-10-19T10:00:00Z');

type Tx = Parameters<typeof newWorkspace>[0];

function harness(tx: Tx, workspaceId: string, userId: string) {
  const store = createMemoryObjectStore();
  const processes: unknown[] = [];
  const ctx: CaptureCtx = {
    db: tx,
    store,
    workspaceId,
    userId,
    authorize: () => undefined,
    config: captureConfigFromEnv({}),
    jobs: {
      scan: () => Promise.resolve(undefined),
      process: (payload) => Promise.resolve(processes.push(payload)),
    },
    now: () => NOW,
  };
  return { ctx, store, processes };
}

async function readCapture(tx: Tx, workspaceId: string, captureId: string) {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.capture).where(eq(schema.capture.id, captureId)),
  );
  if (row === undefined) throw new Error('capture not found');
  return row;
}

const base = {
  chatTitleHash: 'b'.repeat(64),
  chatType: 'internal' as const,
  dateOrder: 'dmy' as const,
  messages: [
    {
      id: 'm1',
      ts: '2026-10-12T10:01:00',
      sender: 'Asha',
      text: 'Please file the reply by 15/10/2026',
    },
    {
      id: 'm2',
      ts: '2026-10-12T10:02:00',
      sender: 'Ravi',
      text: 'Client Aadhaar is 2345 6789 0123',
    },
    {
      id: 'm3',
      ts: '2026-10-12T10:03:00',
      sender: 'Ravi',
      text: 'Call the registry about the order',
    },
  ],
};

function gatewayReturning(items: unknown[]) {
  const run = vi.fn(() =>
    Promise.resolve({ output: { items, confidence: 0.9 }, callId: crypto.randomUUID() }),
  );
  return { gateway: { run } as unknown as AiGateway, run };
}

async function enabled(tx: Tx) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const h = harness(tx, workspaceId, ownerId);
  await enableChannel(h.ctx, {
    channel: 'whatsapp_export',
    disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
  });
  return { workspaceId, ownerId, h };
}

describe('receiveWhatsAppImport', () => {
  it('stores only the messages that pass the rules and queues capture.process', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, h } = await enabled(tx);
      const done = await receiveWhatsAppImport(h.ctx, base);
      expect(done).toMatchObject({ status: 'queued', stored: 2, excluded: 1 });
      expect(h.processes).toHaveLength(1);
      const row = await readCapture(tx, workspaceId, done.captureId);
      expect(row).toMatchObject({ channel: 'whatsapp_export', status: 'queued' });
      const stored = JSON.parse(
        Buffer.from((await h.store.get(row.rawStorageKey as never)).body).toString('utf8'),
      ) as { messages: { id: string }[] };
      expect(stored.messages.map((m) => m.id)).toEqual(['m1', 'm3']);
      expect(JSON.stringify(stored)).not.toContain('2345');
    });
  });

  it('refuses a chat type that differs from the one the import was opened for', async () => {
    await withTestDb(async (tx) => {
      const { h } = await enabled(tx);
      await expect(
        receiveWhatsAppImport(h.ctx, { ...base, chatType: 'client' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });
  });

  it('is refused while the channel is off', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const h = harness(tx, workspaceId, ownerId);
      await expect(receiveWhatsAppImport(h.ctx, base)).rejects.toMatchObject({
        code: 'CHANNEL_DISABLED',
      });
    });
  });
});

async function processing(tx: Tx, input: Record<string, unknown>) {
  const { workspaceId, h } = await enabled(tx);
  const done = await receiveWhatsAppImport(h.ctx, input);
  await runCaptureProcess(
    { db: tx, now: () => NOW },
    { workspaceId, captureId: done.captureId, pipelineVersion: 'l1' },
  );
  return { workspaceId, captureId: done.captureId, h };
}

describe('runWhatsAppImport', () => {
  it('structures an internal chat, stages anchored-by-ref proposals and starts the 30-day clock', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, captureId, h } = await processing(tx, base);
      const { gateway, run } = gatewayReturning([
        {
          title: 'File the reply',
          dueDate: '2026-10-15',
          ref: 'm1',
          ts: 'x',
          sender: 'x',
          quote: 'file the reply',
          clientInstruction: false,
          confidence: 0.9,
        },
        // Cites text that is not in the message: dropped.
        {
          title: 'Invented',
          dueDate: null,
          ref: 'm3',
          ts: 'x',
          sender: 'x',
          quote: 'something never said',
          clientInstruction: false,
          confidence: 0.99,
        },
      ]);
      const outcome = await runWhatsAppImport(
        { db: tx, store: h.store, gateway, now: () => NOW },
        { workspaceId, captureId },
      );
      expect(outcome).toMatchObject({ outcome: 'imported', structured: true, items: 1 });
      expect(run).toHaveBeenCalledTimes(1);
      const [taskId, input] = run.mock.calls[0] as unknown as [
        string,
        { chatType: string; messages: { ref: string }[] },
      ];
      expect(taskId).toBe('structure_chat');
      expect(input.chatType).toBe('internal');
      expect(input.messages.map((m) => m.ref)).toEqual(['m1', 'm3']);
      const row = await readCapture(tx, workspaceId, captureId);
      expect(row.ttlAt?.getTime()).toBe(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    });
  });

  it('never sends a client chat to structure_chat', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, captureId, h } = await processing(tx, {
        ...base,
        chatType: 'client',
        openedFor: 'client',
      });
      const { gateway, run } = gatewayReturning([]);
      const outcome = await runWhatsAppImport(
        { db: tx, store: h.store, gateway, now: () => NOW },
        { workspaceId, captureId },
      );
      expect(outcome).toMatchObject({ outcome: 'imported', structured: false });
      expect(run).not.toHaveBeenCalled();
    });
  });

  it('never sends an ai_blocked capture to the gateway', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, captureId, h } = await processing(tx, base);
      await inWorkspace(tx, workspaceId, (s) =>
        s.update(schema.capture).set({ aiBlocked: true }).where(eq(schema.capture.id, captureId)),
      );
      const { gateway, run } = gatewayReturning([]);
      await runWhatsAppImport(
        { db: tx, store: h.store, gateway, now: () => NOW },
        { workspaceId, captureId },
      );
      expect(run).not.toHaveBeenCalled();
    });
  });
});

describe('cross-tenant whatsapp import', () => {
  it('another workspace cannot run, read or change a workspace’s chat capture', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, captureId, h } = await processing(tx, base);
      const other = await newWorkspace(tx);
      const { gateway, run } = gatewayReturning([]);
      const outcome = await runWhatsAppImport(
        { db: tx, store: h.store, gateway, now: () => NOW },
        { workspaceId: other.workspaceId, captureId },
      );
      expect(outcome).toEqual({ outcome: 'missing' });
      expect(run).not.toHaveBeenCalled();
      expect((await readCapture(tx, workspaceId, captureId)).status).toBe('processing');
    });
  });
});
