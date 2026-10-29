import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildMatter, buildPerson } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { seedChamber } from './helpers.ts';
import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  archiveContact,
  createContact,
  linkToMatter,
  listContacts,
  undoContactChange,
  updateContact,
  type PeopleDeps,
} from '../contacts.ts';
import type { PeopleEvent } from '../events.ts';

function deps(tx: Parameters<Parameters<typeof withTestDb>[0]>[0], now?: () => Date) {
  const events: PeopleEvent[] = [];
  const d: PeopleDeps = {
    db: tx,
    events: { emit: (e) => events.push(e) },
    graphEvents: { emit: () => undefined },
    ...(now === undefined ? {} : { now }),
  };
  return { d, events };
}

async function client(tx: Parameters<Parameters<typeof withTestDb>[0]>[0], ws: string) {
  return inWorkspace(tx, ws, (s) => buildPerson(s, ws, { kind: 'client' }));
}

describe('client contacts (#82)', () => {
  it('creates, links, lists with linked count and clears the unlinked flag', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const p = await client(tx, c.workspaceId);
      const { matterId } = await c.listed();
      const t0 = new Date('2026-11-01T00:00:00Z');
      const { d } = deps(tx, () => t0);
      const row = await createContact(d, owner, { personId: p.id, phone: '+919876543210' });
      const later = deps(tx, () => new Date(t0.getTime() + 25 * 3600_000)).d;
      expect((await listContacts(later, owner))[0]).toMatchObject({
        linkedCount: 0,
        unlinked: true,
      });
      await linkToMatter(later, owner, { contactId: row.id, matterId });
      expect((await listContacts(later, owner))[0]).toMatchObject({
        linkedCount: 1,
        unlinked: false,
      });
      await expect(
        createContact(d, owner, { personId: p.id, phone: '+919876543211' }),
      ).rejects.toThrow(/already has a contact/);
    });
  });

  it('rejects a non-E.164 phone and a non-client person', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const p = await client(tx, c.workspaceId);
      const party = await inWorkspace(tx, c.workspaceId, (s) => buildPerson(s, c.workspaceId));
      const { d } = deps(tx);
      await expect(createContact(d, owner, { personId: p.id, phone: '98765' })).rejects.toThrow();
      await expect(
        createContact(d, owner, { personId: party.id, phone: '+919876543210' }),
      ).rejects.toThrow(/only for clients/);
    });
  });

  it('records an L3 activity for a phone change, undoes it, and emits language_changed', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const p = await client(tx, c.workspaceId);
      const { d, events } = deps(tx);
      const row = await createContact(d, owner, { personId: p.id, phone: '+919876543210' });
      const upd = await updateContact(d, owner, {
        contactId: row.id,
        phone: '+919876500000',
        languagePref: 'hi',
      });
      expect(upd.phone).toBe('+919876500000');
      expect(events).toMatchObject([{ type: 'contact.language_changed', from: 'en', to: 'hi' }]);
      const acts = await inWorkspace(tx, c.workspaceId, (s) => s.select().from(schema.activity));
      expect(acts).toHaveLength(1);
      const actId = acts[0]?.id ?? '';
      expect(acts[0]).toMatchObject({ level: 'L3', kind: 'contact_detail' });
      const undone = await undoContactChange(d, owner, { activityId: actId });
      expect(undone.phone).toBe('+919876543210');
      await expect(undoContactChange(d, owner, { activityId: actId })).rejects.toThrow(
        /already undone/,
      );
    });
  });

  it('archives with a purge flag', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const p = await client(tx, c.workspaceId);
      const { d } = deps(tx);
      const row = await createContact(d, owner, { personId: p.id, email: 'a@example.com' });
      const out = await archiveContact(d, owner, { contactId: row.id, purge: true });
      expect(out.archivedAt).not.toBeNull();
      expect(out.purgeRequested).toBe(true);
      expect(await listContacts(d, owner)).toHaveLength(0);
      expect(await listContacts(d, owner, { includeArchived: true })).toHaveLength(1);
    });
  });

  it("purge anonymises that person's ledger text only, in workspace A (#959)", async () => {
    await withTestDb(async (tx) => {
      const a = await seedChamber(tx);
      const b = await newWorkspace(tx);
      const owner = { userId: a.users.owner, workspaceId: a.workspaceId };
      const x = await client(tx, a.workspaceId);
      const y = await client(tx, a.workspaceId);
      const z = await client(tx, b.workspaceId);
      const { d } = deps(tx);
      const cx = await createContact(d, owner, { personId: x.id, email: 'x@example.com' });
      await createContact(d, owner, { personId: y.id, kind: 'family', email: 'y@example.com' });
      const entry = (workspaceId: string, personId: string, description: string) => ({
        workspaceId,
        personId,
        kind: 'disbursement',
        direction: 'debit',
        amountPaise: 7_000,
        description,
        occurredOn: '2026-11-02',
      });
      await inWorkspace(tx, a.workspaceId, (s) =>
        s
          .insert(schema.clientLedgerEntry)
          .values([
            entry(a.workspaceId, x.id, 'Travel for X'),
            entry(a.workspaceId, y.id, 'Travel for Y'),
          ]),
      );
      await inWorkspace(tx, b.workspaceId, (s) =>
        s.insert(schema.clientLedgerEntry).values(entry(b.workspaceId, z.id, 'Travel for Z')),
      );

      // Archiving without a purge leaves the ledger alone.
      await archiveContact(d, owner, { contactId: cx.id });
      const read = async (workspaceId: string) =>
        inWorkspace(tx, workspaceId, (s) =>
          s
            .select()
            .from(schema.clientLedgerEntry)
            .where(eq(schema.clientLedgerEntry.workspaceId, workspaceId)),
        );
      expect((await read(a.workspaceId)).every((r) => r.anonymisedAt === null)).toBe(true);

      await archiveContact(d, owner, { contactId: cx.id, purge: true });
      const rowsA = await read(a.workspaceId);
      const rx = rowsA.find((r) => r.personId === x.id);
      const ry = rowsA.find((r) => r.personId === y.id);
      expect(rx).toMatchObject({ description: null, amountPaise: 7_000 });
      expect(rx?.anonymisedAt).toBeInstanceOf(Date);
      expect(ry).toMatchObject({ description: 'Travel for Y', anonymisedAt: null });
      expect(await read(b.workspaceId)).toMatchObject([
        { description: 'Travel for Z', anonymisedAt: null },
      ]);
    });
  });

  it('applies the role matrix: clerk redacted and read-only, viewer-less junior needs an assigned matter', async () => {
    await withTestDb(async (tx) => {
      const c = await seedChamber(tx);
      const owner = { userId: c.users.owner, workspaceId: c.workspaceId };
      const p = await client(tx, c.workspaceId);
      const { d } = deps(tx);
      const row = await createContact(d, owner, {
        personId: p.id,
        phone: '+919876543210',
        email: 'a@example.com',
      });
      const clerk = { userId: c.users.clerk, workspaceId: c.workspaceId };
      const seen = await listContacts(d, clerk);
      expect(seen[0]).toMatchObject({ phone: null, email: null, redacted: true });
      await expect(
        updateContact(d, clerk, { contactId: row.id, languagePref: 'ta' }),
      ).rejects.toThrow();

      const junior = { userId: c.users.junior, workspaceId: c.workspaceId };
      expect(await listContacts(d, junior)).toHaveLength(0);
      await expect(
        createContact(d, junior, { personId: p.id, kind: 'family', phone: '+919876543212' }),
      ).rejects.toThrow();
      await expect(
        updateContact(d, junior, { contactId: row.id, languagePref: 'ta' }),
      ).rejects.toThrow();
    });
  });

  it("cross-tenant: B cannot read, change or link A's contact", async () => {
    await withTestDb(async (tx) => {
      const a = await seedChamber(tx);
      const b = await newWorkspace(tx);
      const ownerA = { userId: a.users.owner, workspaceId: a.workspaceId };
      const ownerB = { userId: b.ownerId, workspaceId: b.workspaceId };
      const p = await client(tx, a.workspaceId);
      const { d } = deps(tx);
      const row = await createContact(d, ownerA, { personId: p.id, phone: '+919876543210' });
      const mB = await inWorkspace(tx, b.workspaceId, (s) => buildMatter(s, b.workspaceId));

      expect(await listContacts(d, ownerB)).toEqual([]);
      await expect(
        updateContact(d, ownerB, { contactId: row.id, languagePref: 'ta' }),
      ).rejects.toThrow();
      await expect(
        linkToMatter(d, ownerB, { contactId: row.id, matterId: mB.id }),
      ).rejects.toThrow();
      await expect(archiveContact(d, ownerB, { contactId: row.id })).rejects.toThrow();
      // B acting as a user of A's workspace is denied.
      await expect(
        listContacts(d, { userId: b.ownerId, workspaceId: a.workspaceId }),
      ).rejects.toThrow();
      expect((await listContacts(d, ownerA))[0]).toMatchObject({ phone: '+919876543210' });
    });
  });
});
