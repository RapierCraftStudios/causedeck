import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildMatter,
  buildPerson,
  buildRoleEdge,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { describe, expect, it } from 'vitest';

import type { ConflictHit } from '../../conflicts/index.ts';
import { rankHits, runConflictCheck } from '../conflict.ts';
import { logEnquiry } from '../enquiry.ts';
import { chamber, deps, ENQUIRY } from './helpers.ts';

const hit = (over: Partial<ConflictHit>): ConflictHit => ({
  checked: 'X',
  side: 'adverse',
  matterId: 'm1',
  matterTitle: 'B',
  matchedName: 'X',
  source: 'name',
  existingRole: 'client',
  score: 1,
  ...over,
});

describe('runConflictCheck (#87)', () => {
  it('ranks deterministically whatever the input order', () => {
    const hits = [
      hit({ matterId: 'm3', matterTitle: 'B', score: 0.8 }),
      hit({ matterId: 'm2', matterTitle: 'B' }),
      hit({ matterId: 'm1', matterTitle: 'A' }),
      hit({ matterId: 'm4', matterTitle: 'B' }),
    ];
    const order = rankHits(hits).map((h) => h.matterId);
    expect(order).toEqual(['m1', 'm2', 'm4', 'm3']);
    expect(rankHits([...hits].reverse()).map((h) => h.matterId)).toEqual(order);
  });

  it('returns hits with matter, role and reason, stores the run, and never a verdict', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await inWorkspace(tx, c.workspaceId, async (s) => {
        const m = await buildMatter(s, c.workspaceId, {
          title: 'Meena v. State',
        });
        const p = await buildPerson(s, c.workspaceId, { name: 'Meena Traders', kind: 'client' });
        await buildRoleEdge(s, c.workspaceId, {
          fromPersonId: p.id,
          matterId: m.id,
          kind: 'represents',
        });
      });
      const d = deps(tx);
      const { id } = await logEnquiry(d, c.advocate, ENQUIRY);
      const result = await runConflictCheck(d, c.advocate, { enquiryId: id });
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]).toMatchObject({
        matterTitle: 'Meena v. State',
        existingRole: 'client',
        side: 'adverse',
        score: 1,
      });
      expect(result.hits[0]?.reason).toContain('Meena v. State');
      expect(Object.keys(result).sort()).toEqual(['checkedAt', 'hits', 'partyCount', 'resultId']);
      const stored = await inWorkspace(tx, c.workspaceId, (s) =>
        s.select().from(schema.conflictCheckResult),
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ partyCount: 2, hitCount: 1 });
      const audits = await inWorkspace(tx, c.workspaceId, (s) =>
        s.select().from(schema.auditEvent),
      );
      expect(audits.filter((e) => e.action === 'conflict.checked')).toHaveLength(1);
    });
  });

  it('needs parties to check', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const { id } = await logEnquiry(d, c.advocate, { enquirerName: 'A', summary: 's' });
      await expect(runConflictCheck(d, c.advocate, { enquiryId: id })).rejects.toThrow(/parties/);
    });
  });
});
