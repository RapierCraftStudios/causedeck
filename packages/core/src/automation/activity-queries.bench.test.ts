// Activity feed latency budget (#49): p95 of the first page of the feed (50 activities, newest
// first, with the matter-access lookup) < 300 ms in a workspace with 5,000 activities.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { listActivities } from '../index.ts';

import { NOW, world } from './__tests__/world.ts';

const SEEDED = 5000;
const RUNS = 25;
const DAY = 24 * 60 * 60 * 1000;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

describe('activity feed latency budget', () => {
  it(
    'serves the first page in < 300 ms p95 with 5,000 activities',
    { timeout: 120_000 },
    async () => {
      await withTestDb(async (tx) => {
        const w = await world(tx);
        await inWorkspace(w.tx, w.workspaceId, async (s) => {
          for (let start = 0; start < SEEDED; start += 1000) {
            await s.insert(schema.activity).values(
              Array.from({ length: 1000 }, (_, i) => {
                const createdAt = new Date(NOW.getTime() - (start + i) * 60_000);
                return {
                  workspaceId: w.workspaceId,
                  kind: 'task',
                  level: 'L3' as const,
                  actor: 'system' as const,
                  summary: `Created a task ${String(start + i)}`,
                  entityRefs: { matterId: i % 2 === 0 ? w.matterId : w.otherMatterId },
                  createdAt,
                  undoExpiresAt: new Date(createdAt.getTime() + 7 * DAY),
                };
              }),
            );
          }
        });
        const samples: number[] = [];
        for (let run = 0; run < RUNS; run += 1) {
          const started = performance.now();
          const page = await listActivities(w.deps, w.owner);
          samples.push(performance.now() - started);
          expect(page.items).toHaveLength(50);
          expect(page.nextCursor).not.toBeNull();
        }
        expect(p95(samples)).toBeLessThan(300);
      });
    },
  );
});
