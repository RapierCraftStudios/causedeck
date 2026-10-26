import { withTestDb } from '@causedeck/db/testing';
import type { MemoryProvider } from '../../briefs/index.ts';
import { describe, expect, it } from 'vitest';

import { addMember } from '../../__tests__/fixtures.ts';
import { generateHandover, listHandovers, saveHandover, whatChangedSince } from '../index.ts';

import { memberIdOf, seedContinuity } from './helpers.ts';

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
  alwaysCarry: () => Promise.resolve([]),
  synopsis: () =>
    Promise.resolve({ line: line('SYNOPSIS-TEXT'), strategy: line('STRATEGY-TEXT') }),
  lastHearing: () => Promise.resolve(null),
  courtNotes: () =>
    Promise.resolve([{ authorUserId: 'someone', shared: true, line: line('COURT-NOTE-TEXT') }]),
};

describe('role filtering (R6)', () => {
  it('gives an advocate the synopsis, never strategy or court notes', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture } = await seedContinuity(tx);
      const body = await generateHandover({ ...deps, memory }, actor, fixture.matterId);
      expect(body.synopsis?.text).toBe('SYNOPSIS-TEXT');
      expect(JSON.stringify(body)).not.toMatch(/STRATEGY-TEXT|COURT-NOTE-TEXT/);
    });
  });

  it('leaves the synopsis out for a clerk on generation and on every read', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture, workspaceId, ownerMemberId } = await seedContinuity(tx);
      const withMemory = { ...deps, memory };
      const saved = await saveHandover(withMemory, actor, {
        matterId: fixture.matterId,
        recipientMemberId: ownerMemberId,
      });
      expect(saved.body.derived.synopsis).not.toBeNull();
      const clerkUser = await addMember(tx, workspaceId, 'clerk');
      const clerk = { userId: clerkUser, workspaceId };
      const body = await generateHandover(withMemory, clerk, fixture.matterId);
      expect(body.synopsis).toBeNull();
      expect(JSON.stringify(body)).not.toMatch(/SYNOPSIS-TEXT|STRATEGY-TEXT|COURT-NOTE-TEXT/);
      // A clerk who received the stored note reads it without the synopsis.
      const clerkMember = await memberIdOf(tx, workspaceId, clerkUser);
      await saveHandover(withMemory, actor, {
        matterId: fixture.matterId,
        recipientMemberId: clerkMember,
      });
      const notes = await listHandovers(withMemory, clerk, { matterId: fixture.matterId });
      expect(notes).toHaveLength(1);
      expect(JSON.stringify(notes)).not.toMatch(/SYNOPSIS-TEXT|STRATEGY-TEXT|COURT-NOTE-TEXT/);
    });
  });

  it('what-changed never carries memory or notes, for any role', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture, workspaceId } = await seedContinuity(tx);
      const clerk = { userId: await addMember(tx, workspaceId, 'clerk'), workspaceId };
      for (const who of [actor, clerk]) {
        const summary = await whatChangedSince({ ...deps, memory }, who, fixture.matterId, new Date(0));
        expect(JSON.stringify(summary)).not.toMatch(/SYNOPSIS-TEXT|STRATEGY-TEXT|COURT-NOTE-TEXT/);
      }
    });
  });
});

describe('internal only (R7)', () => {
  it('exports no share, email or export function', async () => {
    const barrel = await import('../index.ts');
    expect(Object.keys(barrel).filter((k) => /share|email|export|send|link/i.test(k))).toEqual([]);
  });
});
