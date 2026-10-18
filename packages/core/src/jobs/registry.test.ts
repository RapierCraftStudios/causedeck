import { randomUUID } from 'node:crypto';

import type { SendOptions } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineJob } from './define.ts';
import type { JobSender } from './producer.ts';
import { contentFieldViolations, createRegistry, enqueue, registry } from './registry.ts';

function spySender() {
  const sent: { name: string; data: object; options: SendOptions | undefined }[] = [];
  const sender: JobSender = {
    send: (name, data, options) => {
      sent.push({ name, data, options });
      return Promise.resolve(randomUUID());
    },
  };
  return { sender, sent };
}

describe('enqueue', () => {
  it('rejects an invalid payload before it reaches the queue', async () => {
    const { sender, sent } = spySender();
    await expect(
      enqueue('system.ping', { workspaceId: 'nope' }, { sender }),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      // @ts-expect-error: workspaceId is required.
      registry.enqueue(sender, 'system.ping', {}),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(sent).toEqual([]);
  });

  it('sends the parsed payload grouped by workspace (fairness)', async () => {
    const { sender, sent } = spySender();
    const workspaceId = randomUUID();
    await enqueue('system.ping', { workspaceId, nonce: 'a' }, { sender });
    expect(sent).toEqual([
      {
        name: 'system.ping',
        data: { workspaceId, nonce: 'a' },
        options: { group: { id: workspaceId } },
      },
    ]);
  });

  it('uses fairnessKey over workspaceId and maps singleton keys', async () => {
    const def = defineJob({
      name: 'document.ocr',
      schema: z.object({
        workspaceId: z.uuid(),
        fairnessKey: z.string().optional(),
        documentId: z.string(),
      }),
      singleton: { key: (p) => `doc:${p.documentId}` },
      handler: () => Promise.resolve(),
    });
    const jobs = createRegistry([def] as const);
    const { sender, sent } = spySender();
    await jobs.enqueue(sender, 'document.ocr', {
      workspaceId: randomUUID(),
      fairnessKey: 'tenant-a',
      documentId: 'd1',
    });
    expect(sent[0]?.options).toEqual({ singletonKey: 'doc:d1', group: { id: 'tenant-a' } });
  });

  it('rejects duplicate job names', () => {
    expect(() =>
      createRegistry([registry.definitions[0], registry.definitions[0]] as never),
    ).toThrow(/duplicate/);
  });
});

describe('payload rules', () => {
  it('every registered schema carries identifiers only', () => {
    expect(contentFieldViolations(registry.definitions)).toEqual([]);
  });

  it.each(['content', 'text', 'body', 'prompt', 'transcript'])('flags a `%s` field', (field) => {
    const def = defineJob({
      name: 'document.ocr',
      schema: z.object({ workspaceId: z.uuid(), [field]: z.string().nullable().optional() }),
      handler: () => Promise.resolve(),
    });
    expect(contentFieldViolations([def])).toEqual([`document.ocr: ${field}`]);
  });
});
