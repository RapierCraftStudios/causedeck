// The memory jobs (#72): the hourly purge sweep and the monthly review prepare queue one job per
// workspace that needs it, by ids only, and are scheduled often enough for the 24 h purge limit.
import { describe, expect, it, vi } from 'vitest';

import { inWorld } from '../../__tests__/memory-world.ts';
import { createMemoryNote, deleteMemory, embedMemoryItem } from '../../memory/index.ts';

import { runMemoryPurgeSchedule, systemMemoryPurge } from './memory-purge.ts';
import { runMemoryReviewSchedule, systemMemoryReviewPrepare } from './memory-review-prepare.ts';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

describe('memory.purge (#72)', () => {
  it('queues the workspaces that hold embeddings of deleted items, and only them', async () => {
    await inWorld(async (w) => {
      const enqueue = vi.fn(() => Promise.resolve(null));
      expect(await runMemoryPurgeSchedule({ db: w.tx, log }, { enqueue })).not.toContain(w.a.id);

      const item = await createMemoryNote(w.deps, w.owner, {
        key: 'M3.synopsis',
        value: 'carry vakalat copy',
        scope: 'matter',
        matterId: w.m1,
      });
      await embedMemoryItem(w.deps, w.owner, item.id, w.m1);
      expect(await runMemoryPurgeSchedule({ db: w.tx, log }, { enqueue })).not.toContain(w.a.id);

      await deleteMemory(w.deps, w.owner, item.id, { matterId: w.m1 });
      expect(await runMemoryPurgeSchedule({ db: w.tx, log }, { enqueue })).toContain(w.a.id);
      expect(enqueue).toHaveBeenCalledWith(w.a.id);
    });
  });

  it('runs at least hourly, so a deleted item’s embeddings go well inside 24 h', () => {
    expect(systemMemoryPurge.schedule?.cron).toBe('0 * * * *');
  });
});

describe('memory.review-prepare (#72)', () => {
  it('queues the workspaces that hold memory, once a month', async () => {
    await inWorld(async (w) => {
      const enqueue = vi.fn(() => Promise.resolve(null));
      expect(await runMemoryReviewSchedule({ db: w.tx, log }, { enqueue })).not.toContain(w.a.id);
      await createMemoryNote(w.deps, w.owner, {
        key: 'M1.courts',
        value: ['Madras High Court'],
        scope: 'workspace',
      });
      expect(await runMemoryReviewSchedule({ db: w.tx, log }, { enqueue })).toContain(w.a.id);
      expect(enqueue).toHaveBeenCalledWith(w.a.id);
      expect(systemMemoryReviewPrepare.schedule?.cron).toBe('0 6 1 * *');
    });
  });
});
