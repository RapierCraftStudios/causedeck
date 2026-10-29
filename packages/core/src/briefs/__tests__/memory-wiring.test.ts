// The brief reads the lawyer's memory (#74): R1 always-carry rule, R2 format, R3 synopsis and court
// notes cited once per item per render, a clerk gets none, R8 pause-all, R11 time, R12 tenants.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { keys } from '../../__tests__/memory-world.ts';
import { createMemoryNote, setMemoryPauseAll } from '../../memory/index.ts';
import { assembleBrief } from '../assemble.ts';
import { createBriefMemoryProvider } from '../index.ts';

import { seedBrief } from './helpers.ts';

const now = () => new Date('2026-10-25T09:00:00Z');

async function world(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const s = await seedBrief(tx);
  const memory = { db: tx, keys };
  const deps = { db: tx, now, memory: createBriefMemoryProvider(memory) };
  const note = (key: string, value: unknown, extra: Record<string, unknown> = { scope: 'user' }) =>
    createMemoryNote(memory, s.actor, { key, value, ...extra });
  const matterScope = { scope: 'matter', matterId: s.fixture.matterId };
  const usage = () => inWorkspace(tx, s.workspaceId, (q) => q.select().from(schema.memoryUsage));
  return { ...s, memory, deps, note, matterScope, usage };
}

describe('brief memory wiring', () => {
  it('carries a confirmed always-carry rule as a suggested item (R1)', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.note('M2.always_carry', 'vakalat copy');
      const brief = await assembleBrief(w.deps, w.actor, w.fixture.listingId);
      expect(brief.carry.some((c) => c.kind === 'rule' && c.label === 'vakalat copy')).toBe(true);
    });
  });

  it('uses the M2 brief format and falls back to the default (R2)', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await assembleBrief(w.deps, w.actor, w.fixture.listingId, { compress: false });
      await w.note('M2.brief_format', { order: 'carry,obligations', verbosity: 'short' });
      const after = await assembleBrief(w.deps, w.actor, w.fixture.listingId, { compress: false });
      expect(Object.keys(after).slice(0, 2)).toEqual(['carry', 'obligations']);
      expect(after.last_order.length).toBeLessThanOrEqual(1);
      expect(before.last_order.length).toBeGreaterThan(1);
    });
  });

  it('cites a synopsis and a court note once per render (R3)', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.note('M3.synopsis', 'Boundary dispute over survey 12', w.matterScope);
      await w.note('M4.hall_note', 'Ask for a short date after lunch');
      const first = await assembleBrief(w.deps, w.actor, w.fixture.listingId);
      expect(first.synopsis?.line.text).toBe('Boundary dispute over survey 12');
      expect((first.court_notes ?? []).map((l) => l.text)).toContain(
        'Ask for a short date after lunch',
      );
      const used = (await w.usage()).filter((u) => u.usedIn === 'brief');
      expect(used).toHaveLength(2);
      expect(new Set(used.map((u) => u.itemId)).size).toBe(2);
    });
  });

  it('pause-all returns the default brief (R8)', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.note('M2.always_carry', 'vakalat copy');
      await setMemoryPauseAll(w.memory, w.actor, true);
      const brief = await assembleBrief(w.deps, w.actor, w.fixture.listingId);
      expect(brief.carry.some((c) => c.kind === 'rule')).toBe(false);
      expect(await w.usage()).toHaveLength(0);
    });
  });

  it('another workspace sees none of this memory (R12)', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      await a.note('M2.always_carry', 'vakalat copy');
      const b = await world(tx);
      const brief = await assembleBrief(b.deps, b.actor, b.fixture.listingId);
      expect(brief.carry.some((c) => c.label === 'vakalat copy')).toBe(false);
    });
  });

  it('assembles well inside the 5 s budget with memory on (R11)', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.note('M2.always_carry', 'vakalat copy');
      await w.note('M3.synopsis', 'Boundary dispute', w.matterScope);
      const t0 = performance.now();
      await assembleBrief(w.deps, w.actor, w.fixture.listingId);
      expect(performance.now() - t0).toBeLessThan(5000);
    });
  });
});
