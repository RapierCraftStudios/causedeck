// The staff incident write path (#770): rows, the in-transaction `incident.changed` audit event,
// the staff gate, and that the next snapshot build carries the incident (R2).
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withUser, type Database } from '@causedeck/db';
import { closeTestDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addIncidentUpdate,
  asIncidentStaff,
  createIncident,
  INCIDENT_TEMPLATES,
  listIncidents,
} from './incidents.ts';
import { buildSnapshot } from './publish.ts';

let owner: Database;
let opsId: string;
let supportId: string;

async function seedStaff(role: 'ops' | 'support'): Promise<string> {
  const id = randomUUID();
  await owner.insert(schema.user).values({ id, name: role, email: `${role}-${id}@causedeck.test` });
  await owner.insert(schema.staffUser).values({ userId: id, role });
  return id;
}

beforeAll(async () => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  opsId = await seedStaff('ops');
  supportId = await seedStaff('support');
});

afterAll(async () => {
  for (const id of [opsId, supportId]) {
    await owner.delete(schema.user).where(eq(schema.user.id, id));
  }
  await owner.$client.end();
  await closeTestDb();
});

const input = {
  title: 'Court lookups are slow',
  severity: 'degraded',
  component: 'court',
} as const;

describe('incident console writes', () => {
  it('creates, updates and resolves an incident with one audit event per change', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const actor = asIncidentStaff(opsId);
      const created = await createIncident(db, actor, { ...input, note: 'Since 10:00.' });
      expect(created).toMatchObject({ state: 'investigating', resolvedAt: null });
      expect(created.updates[0]?.body).toBe(
        `${INCIDENT_TEMPLATES.investigating.body} Since 10:00.`,
      );

      const updated = await addIncidentUpdate(db, actor, created.id, { template: 'identified' });
      expect(updated).toMatchObject({ state: 'identified', resolvedAt: null });

      const resolved = await addIncidentUpdate(db, actor, created.id, { template: 'resolved' });
      expect(resolved.state).toBe('resolved');
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
      expect(resolved.updates.map((u) => u.state)).toEqual([
        'investigating',
        'identified',
        'resolved',
      ]);

      const events = await withUser(tx, { userId: opsId }, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'incident.changed')),
      );
      const mine = events.filter((e) => e.targetId === created.id);
      expect(mine.map((e) => e.metadata.change)).toEqual(['created', 'updated', 'resolved']);
      expect(mine.every((e) => e.actorUserId === opsId && e.workspaceId === null)).toBe(true);
      expect(mine.at(-1)?.metadata).toMatchObject({
        old_state: 'identified',
        new_state: 'resolved',
      });
    });
  });

  it('rejects updates on a resolved incident', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const actor = asIncidentStaff(opsId);
      const { id } = await createIncident(db, actor, input);
      await addIncidentUpdate(db, actor, id, { template: 'resolved' });
      await expect(
        addIncidentUpdate(db, actor, id, { template: 'monitoring' }),
      ).rejects.toMatchObject({ code: 'RESOLVED' });
    });
  });

  it('rejects an empty title, a bad template and non-staff or support writers', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const actor = asIncidentStaff(opsId);
      await expect(createIncident(db, actor, { ...input, title: '  ' })).rejects.toMatchObject({
        code: 'INVALID',
      });
      await expect(
        createIncident(db, actor, { ...input, template: 'resolved' }),
      ).rejects.toMatchObject({ code: 'INVALID' });
      const { id } = await createIncident(db, actor, input);
      await expect(
        addIncidentUpdate(db, actor, id, { template: 'nope' as never }),
      ).rejects.toMatchObject({ code: 'INVALID' });
      await expect(createIncident(db, asIncidentStaff(supportId), input)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const stranger = randomUUID();
      await tx
        .insert(schema.user)
        .values({ id: stranger, name: 'x', email: `x-${stranger}@causedeck.test` });
      await expect(
        addIncidentUpdate(db, asIncidentStaff(stranger), id, { template: 'monitoring' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  it('shows up in the next snapshot build and in the console list', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const { id } = await createIncident(db, asIncidentStaff(opsId), input);
      const snapshot = await buildSnapshot({ db, checks: [] });
      const published = snapshot.incidents.find((i) => i.id === id);
      expect(published).toMatchObject({ title: input.title, state: 'investigating' });
      expect(published?.updates).toHaveLength(1);
      expect((await listIncidents(db)).some((i) => i.id === id)).toBe(true);
    });
  });
});
