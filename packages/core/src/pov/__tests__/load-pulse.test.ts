// The weekly pulse (#86): once per IST ISO week, Monday 06:00 IST, dismissal, opt-out, baseline.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  dismissLoadPulse,
  dueForPulse,
  isoWeekIst,
  pulseWindowOpen,
  recordLoadPulse,
  setPovPrefs,
} from '../index.ts';

import { povWorld } from './helpers.ts';

// Monday 2026-11-09 05:00 IST (23:30Z Sunday) and 07:00 IST (01:30Z Monday).
const EARLY = new Date('2026-11-08T23:30:00Z');
const OPEN = new Date('2026-11-09T01:30:00Z');

describe('pulse calendar', () => {
  it('names the IST ISO week and opens Monday 06:00 IST', () => {
    expect(isoWeekIst(OPEN)).toBe('2026-W46');
    expect(isoWeekIst(new Date('2026-12-31T20:00:00Z'))).toBe('2026-W53');
    expect(pulseWindowOpen(EARLY)).toBe(false);
    expect(pulseWindowOpen(OPEN)).toBe(true);
    expect(pulseWindowOpen(new Date('2026-11-12T10:00:00Z'))).toBe(true);
  });
});

describe('load pulse', () => {
  it('is due once a week, not before Monday morning, and not for a viewer', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      const at = (d: Date) => ({ db: tx, now: () => d });
      expect(await dueForPulse(at(EARLY), w.owner)).toBe(false);
      expect(await dueForPulse(at(OPEN), w.owner)).toBe(true);
      expect(await dueForPulse(at(OPEN), w.viewer)).toBe(false);
      await recordLoadPulse(at(OPEN), w.owner, { demand: 3, worry: 2, effort: 4 });
      expect(await dueForPulse(at(OPEN), w.owner)).toBe(false);
      const nextWeek = new Date(OPEN.getTime() + 7 * 86400000);
      expect(await dueForPulse(at(nextWeek), w.owner)).toBe(true);
      const rows = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.loadPulse));
      expect(rows[0]).toMatchObject({
        demand: 3,
        worry: 2,
        effort: 4,
        baseline: true,
        isoWeek: '2026-W46',
      });
    });
  });

  it('a dismissal stores no answers and holds the week; opt-out stops the card', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      const deps = { db: tx, now: () => OPEN };
      await dismissLoadPulse(deps, w.owner);
      expect(await dueForPulse(deps, w.owner)).toBe(false);
      const [row] = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.loadPulse));
      expect(row).toMatchObject({ demand: null, worry: null, effort: null });
      expect(row?.dismissedAt).not.toBeNull();
      await setPovPrefs(deps, w.advocate, { promptsEnabled: false });
      expect(await dueForPulse(deps, w.advocate)).toBe(false);
    });
  });
});
