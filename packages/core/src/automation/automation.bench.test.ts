// Automation latency budget (#47): p95 acceptProposal < 150 ms and submitProposals for 50 drafts
// < 1 s on seeded data (a workspace with a few hundred proposals and activities already in it).
// Opt-in (`AUTOMATION_BENCH=1`): wall-clock budgets are not stable on the shared build host, so
// the default run leaves them to a quiet machine, as the audit writer bench does.
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { acceptProposal, submitProposals } from '../index.ts';

import { draft, world } from './__tests__/world.ts';

const SEEDED = 300;
const ACCEPTS = 40;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

const tasks = (prefix: string, count: number, dated: boolean) =>
  Array.from({ length: count }, (_, i) =>
    draft({
      kind: 'task',
      confidence: 0.9,
      payload: { title: `${prefix} ${String(i)}`, ...(dated ? { dueDate: '2030-01-05' } : {}) },
    }),
  );

describe('automation latency budget', () => {
  // eslint-disable-next-line no-process-env -- opt-in switch for a benchmark, not app configuration.
  const run = process.env.AUTOMATION_BENCH === '1' ? it : it.skip;
  run('accepts a proposal in < 150 ms p95 and submits 50 drafts in < 1 s', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await submitProposals(w.deps, w.owner, tasks('seed', SEEDED, true));
      const { items } = await submitProposals(w.deps, w.owner, tasks('open', ACCEPTS, true));

      const samples: number[] = [];
      for (const item of items) {
        const started = performance.now();
        await acceptProposal(w.deps, w.owner, { proposalId: item.proposalId ?? '' });
        samples.push(performance.now() - started);
      }
      expect(p95(samples)).toBeLessThan(150);

      const batch = [...tasks('fifty-dated', 25, true), ...tasks('fifty-undated', 25, false)];
      const started = performance.now();
      const result = await submitProposals(w.deps, w.owner, batch);
      const elapsed = performance.now() - started;
      expect(result.items).toHaveLength(50);
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
