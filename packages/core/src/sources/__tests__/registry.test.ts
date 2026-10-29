// The source registry (#478, D-048): policy fails closed, court and notice sources never get the
// captcha tier, and every staff change records old and new values in the same transaction.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withUser, type Database } from '@causedeck/db';
import { closeTestDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asSourceStaff,
  createSource,
  decideSourceClearance,
  exposableThroughApi,
  isCleared,
  policyFor,
  setSourceKillSwitch,
  SourceAdminError,
  SourceNotCleared,
  updateSource,
  validateSourceTier,
  type SourceInput,
} from '../index.ts';

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

const input: SourceInput = {
  kind: 'news',
  baseUrl: 'https://news.example.test',
  owner: 'Example',
  accessMode: 'A1',
  termsStatus: 'cleared',
  counselStatus: 'cleared',
  rateLimitPerMinute: 5,
  retentionDays: 30,
  residency: 'in',
  maxTier: 'headless',
  maxCostDollars: 2,
  killSwitch: false,
  notes: null,
};

describe('decideSourceClearance', () => {
  const ok = {
    termsStatus: 'cleared',
    counselStatus: 'cleared',
    clearedAt: new Date(),
    killSwitch: false,
  } as const;
  it('fails closed for unknown, uncleared and killed sources', () => {
    expect(decideSourceClearance(undefined)).toBe('unknown');
    expect(decideSourceClearance({ ...ok, counselStatus: 'pending' })).toBe('uncleared');
    expect(decideSourceClearance({ ...ok, clearedAt: null })).toBe('uncleared');
    expect(decideSourceClearance({ ...ok, killSwitch: true })).toBe('killed');
    expect(decideSourceClearance(ok)).toBeNull();
  });
});

describe('data class (#486)', () => {
  it('exposes only non-personal sources through the API', () => {
    expect(exposableThroughApi('non-personal')).toBe(true);
    expect(exposableThroughApi('personal')).toBe(false);
    expect(exposableThroughApi('mixed')).toBe(false);
  });

  it('defaults to personal, reaches the policy and can be changed by staff', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const actor = await staffTx();
      const created = await createSource(db, actor, 'test.dataclass', input);
      expect(created.dataClass).toBe('personal');
      expect(await policyFor('test.dataclass', { db })).toMatchObject({ dataClass: 'personal' });
      const updated = await updateSource(db, actor, 'test.dataclass', {
        dataClass: 'non-personal',
      });
      expect(updated.dataClass).toBe('non-personal');
      await expect(
        updateSource(db, actor, 'test.dataclass', { dataClass: 'secret' as never }),
      ).rejects.toMatchObject({ code: 'INVALID' });
    });
  });
});

describe('validateSourceTier', () => {
  it.each(['court', 'notice'] as const)('refuses captcha for a %s source', (kind) => {
    expect(() => {
      validateSourceTier(kind, 'captcha');
    }).toThrow(SourceAdminError);
  });
  it('allows captcha for a news source and lesser tiers for courts', () => {
    expect(() => {
      validateSourceTier('news', 'captcha');
    }).not.toThrow();
    expect(() => {
      validateSourceTier('court', 'proxy');
    }).not.toThrow();
  });
});

function staffTx() {
  return Promise.resolve(asSourceStaff(staffId));
}

describe('policyFor and staff changes', () => {
  it('throws SourceNotCleared for unknown, uncleared and killed sources', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const actor = await staffTx();
      await expect(policyFor('nope.unknown', { db })).rejects.toBeInstanceOf(SourceNotCleared);
      await createSource(db, actor, 'test.pending', { ...input, counselStatus: 'pending' });
      await expect(policyFor('test.pending', { db })).rejects.toMatchObject({
        reason: 'uncleared',
      });
      await createSource(db, actor, 'test.live', input);
      expect(await policyFor('test.live', { db })).toMatchObject({
        sourceId: 'test.live',
        maxTier: 'headless',
        maxCostDollars: 2,
      });
      await setSourceKillSwitch(db, actor, 'test.live', true);
      await expect(policyFor('test.live', { db })).rejects.toMatchObject({ reason: 'killed' });
      expect(await isCleared('test.live', { db })).toBe(false);
    });
  });

  it('refuses a captcha court source and records old and new values on change', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const actor = await staffTx();
      await expect(
        createSource(db, actor, 'test.court', { ...input, kind: 'court', maxTier: 'captcha' }),
      ).rejects.toMatchObject({ code: 'INVALID' });
      await createSource(db, actor, 'test.court', { ...input, kind: 'court' });
      await expect(
        updateSource(db, actor, 'test.court', { maxTier: 'captcha' }),
      ).rejects.toMatchObject({ code: 'INVALID' });
      await updateSource(db, actor, 'test.court', { rateLimitPerMinute: 9 });
      // Account-level events are visible only to their actor (RLS `account_self`).
      const events = await withUser(tx, { userId: actor.userId }, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'source.changed')),
      );
      // Every row in this transaction shares created_at (now() is the transaction start) and the
      // select is unordered, so pick the update's event instead of relying on row order.
      const last = events.find((event) => event.metadata['change'] === 'updated');
      expect(last?.actorUserId).toBe(actor.userId);
      expect(last?.metadata).toMatchObject({
        change: 'updated',
        fields: 'rateLimitPerMinute',
        old_rateLimitPerMinute: 5,
        new_rateLimitPerMinute: 9,
      });
    });
  });

  it('refuses non-staff writers', async () => {
    await withTestDb(async (tx) => {
      const userId = randomUUID();
      await tx
        .insert(schema.user)
        .values({ id: userId, name: 'x', email: `x-${userId}@causedeck.test` });
      await expect(
        createSource(tx as never, asSourceStaff(userId), 'test.nope', input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
