// DPDP controls for global court data (#486, D-048) against a real Postgres: copies past their
// source's retention are blanked (also when the registry shortens the window afterwards), and an
// erasure request masks one person's name with an audit trail that never holds the name.
import { createHash, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withUser, type Database, type Transaction } from '@causedeck/db';
import { closeTestDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as audit from '../../audit/index.ts';

import { CourtDataErasureError, eraseCourtDataSubject, expireCourtData } from '../index.ts';

// System-actor events are invisible to the app role (RLS), so the expiry event is observed at the writer.
vi.mock('../../audit/index.ts', async () => {
  const actual = await vi.importActual<typeof audit>('../../audit/index.ts');
  return { ...actual, record: vi.fn(actual.record) };
});

// The app role cannot write `staff_user`, so the staff member is committed through the owner role.
let owner: Database;
let staffId: string;

beforeAll(async () => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  staffId = randomUUID();
  await owner
    .insert(schema.user)
    .values({ id: staffId, name: 'ops', email: `ops-${staffId}@causedeck.test` });
  await owner.insert(schema.staffUser).values({ userId: staffId, role: 'ops' });
});

afterAll(async () => {
  await owner.delete(schema.user).where(eq(schema.user.id, staffId));
  await owner.$client.end();
  await closeTestDb();
});

const DAY = 86_400_000;

async function source(tx: Transaction, retentionDays: number): Promise<string> {
  const id = `cd.${randomUUID().replaceAll('-', '')}`;
  await tx.insert(schema.source).values({
    id,
    kind: 'court',
    baseUrl: `urn:cd:${id}`,
    owner: 'cd',
    termsStatus: 'cleared',
    counselStatus: 'cleared',
    clearedAt: new Date(),
    retentionDays,
  });
  return id;
}

async function doc(
  tx: Transaction,
  sourceId: string,
  opts: { ageDays: number; retentionDays: number; content?: string },
): Promise<string> {
  const content = opts.content ?? `Cause list ${randomUUID()}`;
  const contributedAt = new Date(Date.now() - opts.ageDays * DAY);
  const [row] = await tx
    .insert(schema.contributedDocument)
    .values({
      sourceId,
      kind: 'cause_list',
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      contributedAt,
      retentionUntil: new Date(contributedAt.getTime() + opts.retentionDays * DAY),
    })
    .returning({ id: schema.contributedDocument.id });
  if (!row) throw new Error('doc insert failed');
  return row.id;
}

async function get(tx: Transaction, id: string) {
  const [row] = await tx
    .select()
    .from(schema.contributedDocument)
    .where(eq(schema.contributedDocument.id, id));
  if (!row) throw new Error('missing document');
  return row;
}

describe('expireCourtData', () => {
  it('blanks copies past retention, keeps live ones, and audits the count', async () => {
    await withTestDb(async (tx) => {
      const src = await source(tx, 30);
      const old = await doc(tx, src, { ageDays: 40, retentionDays: 30 });
      const fresh = await doc(tx, src, { ageDays: 1, retentionDays: 30 });

      const report = await expireCourtData(tx);

      expect(report.bySource[src]).toBe(1);
      const expired = await get(tx, old);
      expect(expired.content).toBeNull();
      expect(expired.withdrawnAt).not.toBeNull();
      const live = await get(tx, fresh);
      expect(live.content).not.toBeNull();
      expect(live.withdrawnAt).toBeNull();
      expect(vi.mocked(audit.record)).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: null }),
        expect.objectContaining({
          action: 'court_data.expired',
          metadata: { expired: 1, sources: src },
        }),
      );
    });
  });

  it('applies a retention window shortened in the registry to stored copies', async () => {
    await withTestDb(async (tx) => {
      const src = await source(tx, 365);
      const id = await doc(tx, src, { ageDays: 10, retentionDays: 365 });
      expect((await get(tx, id)).content).not.toBeNull();

      await tx.update(schema.source).set({ retentionDays: 5 }).where(eq(schema.source.id, src));
      await expireCourtData(tx);

      expect((await get(tx, id)).content).toBeNull();
    });
  });

  it('does nothing and writes no event when nothing is past retention', async () => {
    await withTestDb(async (tx) => {
      const src = await source(tx, 30);
      const id = await doc(tx, src, { ageDays: 1, retentionDays: 30 });
      const report = await expireCourtData(tx);
      expect(report.bySource[src]).toBeUndefined();
      expect((await get(tx, id)).content).not.toBeNull();
    });
  });
});

describe('eraseCourtDataSubject', () => {
  it('masks the name in live copies, keeps the rest, and audits without the name', async () => {
    await withTestDb(async (tx) => {
      const src = await source(tx, 30);
      const hit = await doc(tx, src, {
        ageDays: 1,
        retentionDays: 30,
        content: 'Item 4: Ramesh  Kumar v. State; counsel for ramesh kumar present',
      });
      const other = await doc(tx, src, {
        ageDays: 1,
        retentionDays: 30,
        content: 'Item 9: Sita Devi v. State',
      });
      const before = await get(tx, hit);

      const report = await eraseCourtDataSubject(tx, {
        staffUserId: staffId,
        subject: 'Ramesh Kumar',
        reason: 'ticket-486',
      });

      expect(report.documents).toBeGreaterThanOrEqual(1);
      const masked = await get(tx, hit);
      expect(masked.content).toBe('Item 4: [erased] v. State; counsel for [erased] present');
      expect(masked.sha256).toBe(before.sha256);
      expect((await get(tx, other)).content).toBe('Item 9: Sita Devi v. State');

      const [event] = await withUser(tx, { userId: staffId }, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.action, 'court_data.erased'),
              eq(schema.auditEvent.actorUserId, staffId),
            ),
          ),
      );
      expect(event).toBeDefined();
      const text = JSON.stringify(event);
      expect(text).toContain(report.subjectHash);
      expect(text.toLowerCase()).not.toContain('ramesh');
    });
  });

  it('refuses non-staff, a short subject and a missing reason', async () => {
    await withTestDb(async (tx) => {
      const userId = randomUUID();
      await tx
        .insert(schema.user)
        .values({ id: userId, name: 'x', email: `x-${userId}@causedeck.test` });
      await expect(
        eraseCourtDataSubject(tx as never, {
          staffUserId: userId,
          subject: 'Ramesh Kumar',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        eraseCourtDataSubject(tx as never, { staffUserId: staffId, subject: 'Al', reason: 'r' }),
      ).rejects.toBeInstanceOf(CourtDataErasureError);
      await expect(
        eraseCourtDataSubject(tx as never, {
          staffUserId: staffId,
          subject: 'Ramesh Kumar',
          reason: ' ',
        }),
      ).rejects.toMatchObject({ code: 'INVALID' });
    });
  });
});
