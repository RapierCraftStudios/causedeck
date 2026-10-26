import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildPerson } from '@causedeck/db/testing/matter-graph-fixtures';
import { describe, expect, it } from 'vitest';

import { seedChamber } from './helpers.ts';
import { newWorkspace } from '../../__tests__/fixtures.ts';
import { createContact, linkToMatter, updateContact, type PeopleDeps } from '../contacts.ts';
import { getContactDetail } from '../detail.ts';

function deps(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]): PeopleDeps {
  return {
    db: tx,
    events: { emit: () => undefined },
    graphEvents: { emit: () => undefined },
  };
}

describe('getContactDetail (#82)', () => {
  it('returns the linked matters and the change log; a clerk gets no log or details', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const p = await inWorkspace(tx, c.workspaceId, (s) =>
        buildPerson(s, c.workspaceId, { kind: 'client' }),
      );
      const { matterId } = await c.listed();
      const d = deps(tx);
      const row = await createContact(d, owner, { personId: p.id, phone: '+919876543210' });
      await linkToMatter(d, owner, { contactId: row.id, matterId });
      await updateContact(d, owner, { contactId: row.id, phone: '+919876543211' });

      const detail = await getContactDetail(d, owner, { contactId: row.id });
      expect(detail.contact.phone).toBe('+919876543211');
      expect(detail.matters.map((m) => m.matterId)).toEqual([matterId]);
      expect(detail.matters[0]?.relation).toBe('represents');
      expect(detail.log).toHaveLength(1);
      expect(detail.log[0]?.summary).toMatch(/phone/);

      const clerk = { userId: c.users.clerk, workspaceId: c.workspaceId };
      const seen = await getContactDetail(d, clerk, { contactId: row.id });
      expect(seen.contact).toMatchObject({ phone: null, redacted: true });
      expect(seen.log).toEqual([]);
    });
  });

  it("cross-tenant: B cannot read A's contact detail", async () => {
    await withTestDb(async (tx) => {
      const a = await seedChamber(tx);
      const b = await newWorkspace(tx);
      const p = await inWorkspace(tx, a.workspaceId, (s) =>
        buildPerson(s, a.workspaceId, { kind: 'client' }),
      );
      const d = deps(tx);
      const row = await createContact(
        d,
        { userId: a.users.owner, workspaceId: a.workspaceId },
        { personId: p.id, phone: '+919876543210' },
      );
      await expect(
        getContactDetail(
          d,
          { userId: b.ownerId, workspaceId: b.workspaceId },
          { contactId: row.id },
        ),
      ).rejects.toThrow();
      await expect(
        getContactDetail(
          d,
          { userId: b.ownerId, workspaceId: a.workspaceId },
          { contactId: row.id },
        ),
      ).rejects.toThrow();
    });
  });
});
