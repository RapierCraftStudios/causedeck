import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { addMember } from '../../__tests__/fixtures.ts';
import { assembleBrief, type MemoryProvider } from '../assemble.ts';
import { markPrepared } from '../state.ts';

import { seedBrief } from './helpers.ts';

const line = (text: string) => ({
  text,
  label: null,
  source_type: 'manual' as const,
  source_ref: null,
  anchor_id: null,
  confidence: null,
  confirmation_state: 'confirmed' as const,
});

const memory: MemoryProvider = {
  alwaysCarry: async () => [{ id: 'r1', label: 'Always carry the vakalatnama' }],
  synopsis: async () => ({ line: line('Synopsis'), strategy: line('Strategy: press for early hearing') }),
  lastHearing: async () => line('Last hearing: adjourned'),
  courtNotes: async () => [line('x')].map((l) => ({ authorUserId: 'someone', shared: true, line: l })),
};

describe('role gating (R5)', () => {
  it('gives an advocate synopsis, strategy and court notes, and the M2 carry rule (R4)', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const brief = await assembleBrief({ db: tx, memory }, actor, fixture.listingId);
      expect(brief.synopsis?.strategy?.text).toMatch(/Strategy/);
      expect(brief.court_notes).toHaveLength(1);
      expect(brief.carry.some((c) => c.kind === 'rule')).toBe(true);
    });
  });

  it('omits strategy and court notes for a clerk, server-side', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, fixture } = await seedBrief(tx);
      const clerk = await addMember(tx, workspaceId, 'clerk');
      const brief = await assembleBrief(
        { db: tx, memory },
        { userId: clerk, workspaceId },
        fixture.listingId,
      );
      expect(JSON.stringify(brief)).not.toMatch(/Strategy:/);
      expect(brief.synopsis?.strategy ?? null).toBeNull();
      expect(brief.court_notes).toBeNull();
    });
  });

  it('refuses a write to a viewer', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, fixture } = await seedBrief(tx);
      const viewer = await addMember(tx, workspaceId, 'viewer');
      await expect(
        markPrepared({ db: tx }, { userId: viewer, workspaceId }, { listingId: fixture.listingId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});

describe('no outward action (R13)', () => {
  it('exports no send, export or file function', async () => {
    const names = Object.keys(await import('../index.ts'));
    expect(names.filter((n) => /^(send|export|file|share|email|post)/i.test(n))).toEqual([]);
  });
});
