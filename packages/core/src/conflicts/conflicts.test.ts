// Conflict-of-interest check (#500): the phonetic key, and the check against stored parties.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { checkConflicts, nameKey, nameSimilarity, transliterate } from './index.ts';

describe('name keys', () => {
  it('reads Tamil and Kannada into Latin', () => {
    expect(transliterate('முருகன்')).toBe('murukan');
    expect(transliterate('ಲಕ್ಷ್ಮಿ')).toBe('lakshmi');
  });

  it('matches a name across scripts, spellings and word order', () => {
    expect(nameKey('முருகன் இளங்கோ')).toBe(nameKey('Ilango Murugan'));
    expect(nameKey('ಲಕ್ಷ್ಮಿ ಗೌಡ')).toBe(nameKey('Sri. Lakshmi Gowda'));
    expect(nameSimilarity('Subramaniam', 'Subramanian')).toBeGreaterThan(0);
  });

  it('ignores honorifics and company suffixes and expands organisation abbreviations', () => {
    expect(nameKey('M/s Acme Traders Pvt. Ltd.')).toBe(nameKey('Acme Traders'));
    expect(nameKey('Govt. of Karnataka')).toBe(nameKey('Government of Karnataka'));
  });

  it('does not match different names, and short near misses never match', () => {
    expect(nameSimilarity('Murugan', 'Lakshmi')).toBe(0);
    expect(nameSimilarity('Ravi', 'Rani')).toBe(0);
    expect(nameSimilarity('', 'Sri')).toBe(0);
  });
});

describe('checkConflicts', () => {
  it('finds a matter where the chamber appears for the adverse party, transliterated names too', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const { a, b } = seeded;
      const open = await inWorkspace(tx, a.id, async (s) => {
        const [m] = await s
          .insert(schema.matter)
          .values({ workspaceId: a.id, title: 'Ilango v State', practiceArea: 'civil' })
          .returning({ id: schema.matter.id });
        const [hidden] = await s
          .insert(schema.matter)
          .values({ workspaceId: a.id, title: 'Restricted matter', practiceArea: 'civil' })
          .returning({ id: schema.matter.id });
        const [client] = await s
          .insert(schema.person)
          .values({
            workspaceId: a.id,
            name: 'Murugan Ilango',
            aliases: ['M. Ilango'],
            kind: 'client',
          })
          .returning({ id: schema.person.id });
        const [other] = await s
          .insert(schema.person)
          .values({ workspaceId: a.id, name: 'Kumar Raja', kind: 'party' })
          .returning({ id: schema.person.id });
        const [secret] = await s
          .insert(schema.person)
          .values({ workspaceId: a.id, name: 'Secret Client', kind: 'client' })
          .returning({ id: schema.person.id });
        await s.insert(schema.roleEdge).values([
          {
            workspaceId: a.id,
            kind: 'represents',
            fromPersonId: client?.id ?? '',
            matterId: m?.id ?? '',
            sourceType: 'manual',
          },
          {
            workspaceId: a.id,
            kind: 'opposes',
            fromPersonId: other?.id ?? '',
            matterId: m?.id ?? '',
            sourceType: 'manual',
          },
          {
            workspaceId: a.id,
            kind: 'represents',
            fromPersonId: secret?.id ?? '',
            matterId: hidden?.id ?? '',
            sourceType: 'manual',
          },
        ]);
        await s.insert(schema.matterRestriction).values({
          workspaceId: a.id,
          matterId: hidden?.id ?? '',
          allowedUserIds: [seeded.uboth],
        });
        return m?.id ?? '';
      });
      const actor = { workspaceId: a.id, userId: seeded.ua };

      // The Tamil spelling of our own client, now adverse on a new matter, is a conflict.
      const adverse = await checkConflicts({ db: tx }, actor, {
        parties: [{ name: 'முருகன் இளங்கோ', side: 'adverse' }],
      });
      expect(adverse.hits).toHaveLength(1);
      expect(adverse.hits[0]).toMatchObject({
        matterId: open,
        existingRole: 'client',
        matchedName: 'Murugan Ilango',
        source: 'name',
        score: 1,
      });

      // An alias counts, and a new client who is adverse elsewhere is a conflict too.
      const alias = await checkConflicts({ db: tx }, actor, {
        parties: [
          { name: 'M Ilango', side: 'adverse' },
          { name: 'Kumar Raja', side: 'client' },
        ],
      });
      expect(alias.hits.map((h) => [h.checked, h.existingRole])).toEqual(
        expect.arrayContaining([
          ['M Ilango', 'client'],
          ['Kumar Raja', 'adverse'],
        ]),
      );

      // The same side is not a conflict; a restricted matter the actor cannot read is not shown.
      const same = await checkConflicts({ db: tx }, actor, {
        parties: [
          { name: 'Murugan Ilango', side: 'client' },
          { name: 'Secret Client', side: 'adverse' },
        ],
      });
      expect(same.hits).toEqual([]);

      // Workspace B finds nothing of A's.
      const asB = await checkConflicts(
        { db: tx },
        { workspaceId: b.id, userId: seeded.ub },
        {
          parties: [{ name: 'Murugan Ilango', side: 'adverse' }],
        },
      );
      expect(asB.hits).toEqual([]);

      // Every check is audited, with counts and no names.
      const events = await inWorkspace(tx, a.id, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, a.id),
              eq(schema.auditEvent.action, 'conflict.checked'),
            ),
          ),
      );
      expect(events).toHaveLength(3);
      expect(JSON.stringify(events.map((e) => e.metadata))).not.toContain('Ilango');
    });
  });

  it('refuses an empty or oversized request', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const actor = { workspaceId: a.id, userId: ua };
      await expect(checkConflicts({ db: tx }, actor, { parties: [] })).rejects.toThrow();
      await expect(
        checkConflicts({ db: tx }, actor, { parties: [{ name: 'x'.repeat(301), side: 'client' }] }),
      ).rejects.toThrow();
    });
  });
});
