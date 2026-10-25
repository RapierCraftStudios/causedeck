// `memory.erase` and `account.delete` (#303): payloads carry ids only, and a memory erasure is sent
// ahead of the default-priority queue so the 24 h deadline holds.
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { MEMORY_ERASE_PRIORITY } from '../../lifecycle/index.ts';
import type { JobSender } from '../producer.ts';
import { registry } from '../registry.ts';

const sent: { name: string; data: unknown; options: unknown }[] = [];
const sender = {
  send: (name: string, data: unknown, options: unknown) => {
    sent.push({ name, data, options });
    return Promise.resolve('job-id');
  },
} as unknown as JobSender;

vi.mock('../producer.ts', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getProducer: () => Promise.resolve(sender),
}));

const { enqueueMemoryErase } = await import('./memory-erase.ts');
const { enqueueAccountDelete } = await import('./account-delete.ts');

describe('memory.erase and account.delete', () => {
  it('sends memory.erase at MEMORY_ERASE_PRIORITY, singleton per job, grouped by workspace', async () => {
    sent.length = 0;
    const workspaceId = randomUUID();
    const jobId = randomUUID();
    await enqueueMemoryErase({ workspaceId, jobId });
    expect(MEMORY_ERASE_PRIORITY).toBeGreaterThan(0);
    expect(sent).toEqual([
      {
        name: 'memory.erase',
        data: { workspaceId, jobId },
        options: {
          singletonKey: jobId,
          group: { id: workspaceId },
          priority: MEMORY_ERASE_PRIORITY,
        },
      },
    ]);
  });

  it('the registry enqueue passes the priority through', async () => {
    sent.length = 0;
    const workspaceId = randomUUID();
    const jobId = randomUUID();
    await registry.enqueue(
      sender,
      'memory.erase',
      { workspaceId, jobId },
      { priority: MEMORY_ERASE_PRIORITY },
    );
    expect(sent[0]?.options).toMatchObject({
      priority: MEMORY_ERASE_PRIORITY,
      singletonKey: jobId,
    });
  });

  it('sends account.delete with no workspace, grouped by the user', async () => {
    sent.length = 0;
    const userId = randomUUID();
    const jobId = randomUUID();
    await enqueueAccountDelete({ userId, jobId });
    expect(sent).toEqual([
      {
        name: 'account.delete',
        data: { workspaceId: null, userId, jobId, fairnessKey: userId },
        options: { singletonKey: jobId, group: { id: userId } },
      },
    ]);
    await registry.enqueue(sender, 'account.delete', {
      workspaceId: null,
      userId,
      jobId,
      fairnessKey: userId,
    });
    expect(sent[1]?.options).toEqual({ singletonKey: jobId, group: { id: userId } });
  });
});
