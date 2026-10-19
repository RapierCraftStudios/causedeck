// `system.retention.sweep` under FORCE row-level security (#19): the job has no workspace, yet it
// must expire old `job_effect` rows in every workspace (through `app_purge_job_effects`) and keep
// recent ones. Runs as causedeck_app in a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import { describe, expect, it, vi } from 'vitest';

import type { JobContext } from '../context.ts';
import { JOB_EFFECT_RETENTION_DAYS, retentionSweep } from './retention-sweep.ts';

const DAY = 86_400_000;

async function seedEffects(tx: Transaction, workspaceId: string): Promise<void> {
  await inWorkspace(tx, workspaceId, async (s) => {
    await s.insert(schema.organization).values({
      id: workspaceId,
      name: 'Sweep',
      slug: `sweep-${workspaceId}`,
    });
    await s.insert(schema.jobEffect).values([
      {
        jobName: 'test.sweep',
        idempotencyKey: 'old',
        workspaceId,
        completedAt: new Date(Date.now() - (JOB_EFFECT_RETENTION_DAYS + 1) * DAY),
      },
      { jobName: 'test.sweep', idempotencyKey: 'new', workspaceId, completedAt: new Date() },
    ]);
  });
}

function sweepContext(db: Transaction, info: (...args: unknown[]) => void): JobContext {
  return {
    log: { info } as unknown as Logger,
    db,
    workspaceId: null,
    jobName: retentionSweep.name,
    jobId: randomUUID(),
    attempt: 1,
    signal: new AbortController().signal,
    idempotencyKey: 'sweep',
  };
}

describe('system.retention.sweep', () => {
  it('expires old job_effect rows in every workspace and keeps recent ones', async () => {
    await withTestDb(async (tx) => {
      const [a, b] = [randomUUID(), randomUUID()];
      await seedEffects(tx, a);
      await seedEffects(tx, b);

      const info = vi.fn();
      // No workspace pinned, as the worker runs system jobs.
      await retentionSweep.handler(sweepContext(tx, info), {});

      for (const workspaceId of [a, b]) {
        const keys = await inWorkspace(tx, workspaceId, (s) =>
          s.select({ key: schema.jobEffect.idempotencyKey }).from(schema.jobEffect),
        );
        expect(keys.map((k) => k.key)).toEqual(['new']);
      }
      expect(info).toHaveBeenCalledWith(
        { deleted: expect.any(Number) as number },
        'expired job_effect rows',
      );
      const [[fields]] = info.mock.calls as [[{ deleted: number }]];
      expect(fields.deleted).toBeGreaterThanOrEqual(2);
    });
  });
});
