// The saved chamber column mapping (#778): round trip, replace, validation, tenant isolation.
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { failure, newWorkspace } from '../../__tests__/fixtures.ts';
import { getChamberMapping, saveChamberMapping } from '../index.ts';

describe('chamber column mapping', () => {
  it('is empty until saved, round-trips and is replaced by the next save', async () => {
    await withTestDb(async (tx) => {
      const w = await newWorkspace(tx);
      const scope = { workspaceId: w.workspaceId, userId: w.ownerId };
      expect(await getChamberMapping(tx, scope)).toEqual({});
      await saveChamberMapping(tx, scope, { caseNumber: ' Suit No ', court: 'Bench' });
      expect(await getChamberMapping(tx, scope)).toEqual({ caseNumber: 'Suit No', court: 'Bench' });
      await saveChamberMapping(tx, scope, { stage: 'Status', party: '  ' });
      expect(await getChamberMapping(tx, scope)).toEqual({ stage: 'Status' });
    });
  });

  it('rejects an unknown field', async () => {
    await withTestDb(async (tx) => {
      const w = await newWorkspace(tx);
      const scope = { workspaceId: w.workspaceId, userId: w.ownerId };
      const error = await failure(saveChamberMapping(tx, scope, { bogus: 'X' } as never));
      expect((error as Error).message).toContain('Unknown import field');
    });
  });

  it("never shows or changes another workspace's mapping", async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const scopeA = { workspaceId: a.workspaceId, userId: a.ownerId };
      const scopeB = { workspaceId: b.workspaceId, userId: b.ownerId };
      await saveChamberMapping(tx, scopeA, { caseNumber: 'A-Number' });
      expect(await getChamberMapping(tx, scopeB)).toEqual({});
      await saveChamberMapping(tx, scopeB, { caseNumber: 'B-Number' });
      expect(await getChamberMapping(tx, scopeA)).toEqual({ caseNumber: 'A-Number' });
    });
  });
});
