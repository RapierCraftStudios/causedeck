// Brief AI gateway use (R12) and the deterministic-path time budget (R10), against a real database.
import { schema } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assembleBrief } from '../assemble.ts';

import { seedBrief } from './helpers.ts';

const now = () => new Date();

describe('brief assembly budget and AI', () => {
  it('stays inside the 1.5 s deterministic budget per listing (R10)', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const times: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = process.hrtime.bigint();
        await assembleBrief({ db: tx, now }, actor, fixture.listingId, { compress: false });
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? Infinity;
      expect(p95).toBeLessThan(1500);
    });
  });

  it('compresses through the gateway and logs an India-region ai_call row (R12)', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { actor, workspaceId, fixture } = await seedBrief(tx);
      await assembleBrief({ db: tx, now }, actor, fixture.listingId);
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.task === 'summarise')).toBe(true);
      expect(rows.every((r) => r.region === 'ap-south-1' || r.provider === 'mock')).toBe(true);
    });
  });

  it('makes no AI call on a sensitive matter (R9, R12)', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { actor, workspaceId, fixture } = await seedBrief(tx);
      await assembleBrief({ db: tx, now }, actor, fixture.sensitiveListingId);
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
      );
      expect(rows).toHaveLength(0);
    });
  });
});
