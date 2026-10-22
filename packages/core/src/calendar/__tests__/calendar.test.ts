// The calendar domain on the test database (#53; PRD CA-5): the ICS import (proposals, never
// confirmed dates; idempotent re-import; conflicts; nothing stored for events that are not
// hearings or look personal; no matter created), its review, and the private feed (token security,
// scopes, what is published, 304, rate limit, cross-tenant). Names, case numbers and places are
// fictional; every test runs in a rolled-back transaction as causedeck_app.
import { createHash, randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { createMemoryObjectStore, objectKey, type MemoryObjectStore } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember } from '../../__tests__/fixtures.ts';
import {
  confirmNextDate,
  createMatter,
  createProceeding,
  getCanonicalNextDate,
  proposeNextDate,
  setSensitive,
} from '../../index.ts';
import {
  CALENDAR_DISCLOSURE_VERSION,
  confirmImportEvent,
  createFeed,
  getFeedStatus,
  getImportReview,
  revokeFeed,
  rotateFeed,
  runIcsImport,
  serveFeed,
  setFeedIncludeParties,
  skipImportEvent,
  type ServeDeps,
} from '../index.ts';

import { world, type World } from './world.ts';

const { anchor, capture, icsFeed, icsFeedEvent, icsImportEvent, matter, proposal } = schema;

interface EventSpec {
  uid: string;
  summary: string;
  start?: string;
  sequence?: number;
  location?: string;
}

const ics = (events: EventSpec[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Diary//EN',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      'DTSTAMP:20261001T080000Z',
      `SEQUENCE:${String(e.sequence ?? 0)}`,
      `DTSTART;TZID=Asia/Kolkata:${e.start ?? '20261202T103000'}`,
      `SUMMARY:${e.summary}`,
      ...(e.location === undefined ? [] : [`LOCATION:${e.location}`]),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n');

/** A capture of an uploaded file, already claimed (`processing`) as `capture.process` leaves it. */
async function icsCapture(w: World, store: MemoryObjectStore, text: string): Promise<string> {
  const key = objectKey({ workspaceId: w.workspaceId, kind: 'document', id: randomUUID() });
  const body = Buffer.from(text, 'utf8');
  await store.put({ key, body, contentType: 'text/calendar' });
  return inWorkspace(w.tx, w.workspaceId, async (s) => {
    const [row] = await s
      .insert(capture)
      .values({
        workspaceId: w.workspaceId,
        channel: 'ics',
        status: 'processing',
        rawStorageKey: key,
        sha256: createHash('sha256').update(body).digest('hex'),
        mime: 'text/calendar',
        sizeBytes: body.byteLength,
        originalFilename: 'diary.ics',
        createdBy: w.ownerId,
      })
      .returning({ id: capture.id });
    if (!row) throw new Error('capture insert failed');
    return row.id;
  });
}

const importFile = async (w: World, store: MemoryObjectStore, text: string) =>
  runIcsImport(
    { db: w.tx, store, now: () => w.clock.now },
    { workspaceId: w.workspaceId, captureId: await icsCapture(w, store, text) },
  );

const proposals = (w: World) =>
  inWorkspace(w.tx, w.workspaceId, (s) =>
    s.select().from(proposal).orderBy(proposal.createdAt, proposal.id),
  );
const ledger = (w: World) =>
  inWorkspace(w.tx, w.workspaceId, (s) =>
    s.select().from(icsImportEvent).orderBy(icsImportEvent.uid),
  );

async function confirmDate(w: World, date: string): Promise<string> {
  const result = await proposeNextDate(w.deps, w.owner, {
    proceedingId: w.proceedingId,
    date,
    provenance: { sourceType: 'manual' },
  });
  // A second date next to a confirmed one comes back as a conflict that holds both sides.
  const listingId =
    result.kind === 'proposal'
      ? result.listingId
      : result.kind === 'conflict'
        ? result.proposed.listingId
        : null;
  if (listingId === null) throw new Error('expected a proposal');
  await confirmNextDate(w.deps, w.owner, { listingId });
  return listingId;
}

describe('runIcsImport', () => {
  it('turns a matched hearing into a next_date proposal with a calendar_event anchor, and confirms nothing', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const store = createMemoryObjectStore();
      const result = await importFile(
        w,
        store,
        ics([{ uid: 'hearing-1', summary: 'W.P. 101/2026 hearing', location: 'Court 4' }]),
      );
      expect(result).toMatchObject({ outcome: 'imported', summary: { new: 1, changed: 0 } });

      const [staged] = await proposals(w);
      expect(staged).toMatchObject({ kind: 'next_date', status: 'proposed', matterId: w.matterId });
      expect(staged?.payload).toMatchObject({ proceedingId: w.proceedingId, date: '2026-12-02' });
      // Nothing is confirmed by an import.
      expect(
        await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId }),
      ).toBeNull();

      const [row] = await ledger(w);
      expect(row).toMatchObject({
        uid: 'hearing-1',
        status: 'proposed',
        proposalId: staged?.id,
        proceedingId: w.proceedingId,
      });
      const [evidence] = await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .select()
          .from(anchor)
          .where(eq(anchor.id, row?.anchorId ?? randomUUID())),
      );
      expect(evidence).toMatchObject({ kind: 'calendar_event' });
      expect(evidence?.quote).toContain('UID:hearing-1');
      expect(evidence?.quote).toContain('DTSTAMP:');

      const [cap] = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(capture));
      expect(cap?.status).toBe('needs_you');
      expect(cap?.sourceMeta['icsImport']).toMatchObject({ new: 1 });
    });
  });

  it('stores nothing for events that are not hearings or look personal, and only counts them', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const result = await importFile(
        w,
        createMemoryObjectStore(),
        ics([
          { uid: 'dinner', summary: 'Dinner with friends' },
          { uid: 'doctor', summary: 'Doctor appointment', location: 'City Hospital' },
          { uid: 'hearing', summary: 'W.P. 101/2026 hearing' },
        ]),
      );
      expect(result).toMatchObject({ outcome: 'imported', summary: { new: 1, ignored: 2 } });
      const rows = await ledger(w);
      expect(rows.map((r) => r.uid)).toEqual(['hearing']);
      expect(JSON.stringify(rows)).not.toMatch(/Doctor|Dinner|Hospital/);
    });
  });

  it('is idempotent: the same file again changes nothing, a higher SEQUENCE replaces the proposal', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const store = createMemoryObjectStore();
      const event = { uid: 'hearing-1', summary: 'W.P. 101/2026 hearing' };
      await importFile(w, store, ics([event]));

      const again = await importFile(w, store, ics([event]));
      expect(again).toMatchObject({
        outcome: 'imported',
        summary: { new: 0, changed: 0, unchanged: 1 },
      });
      expect(await proposals(w)).toHaveLength(1);

      const moved = await importFile(
        w,
        store,
        ics([{ ...event, sequence: 1, start: '20261209T103000' }]),
      );
      expect(moved).toMatchObject({
        outcome: 'imported',
        summary: { new: 0, changed: 1, unchanged: 0 },
      });
      const all = await proposals(w);
      expect(all.map((p) => [p.status, (p.payload as { date: string }).date]).sort()).toEqual([
        ['dismissed', '2026-12-02'],
        ['proposed', '2026-12-09'],
      ]);
      const current = all.find((p) => p.status === 'proposed');
      const [row] = await ledger(w);
      expect(row).toMatchObject({ sequence: 1, proposalId: current?.id });
      expect(await ledger(w)).toHaveLength(1);
    });
  });

  it('keeps a confirmed date: a different day becomes a conflict card and nothing is overwritten', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirmDate(w, '2026-11-20');
      await importFile(
        w,
        createMemoryObjectStore(),
        ics([{ uid: 'hearing-1', summary: 'W.P. 101/2026 hearing' }]),
      );
      const [staged] = await proposals(w);
      expect(staged?.entityRefs).toMatchObject({ conflict: true });
      const current = await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId });
      expect(current?.listDate).toBe('2026-11-20');
    });
  });

  it('lists an unmatched hearing-like event for review and never creates a matter', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(matter));
      await importFile(
        w,
        createMemoryObjectStore(),
        ics([{ uid: 'who', summary: 'W.P. 999/2026 hearing' }]),
      );
      expect(await proposals(w)).toHaveLength(0);
      const [row] = await ledger(w);
      expect(row).toMatchObject({ status: 'unmatched', matterId: null, proposalId: null });
      expect(await inWorkspace(tx, w.workspaceId, (s) => s.select().from(matter))).toHaveLength(
        before.length,
      );
    });
  });

  it('cannot reach another workspace: a case number of workspace B is unmatched in A', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      const otherMatter = await createMatter(b.deps, b.owner, { title: 'Other (fictional)' });
      await createProceeding(b.deps, b.owner, {
        matterId: otherMatter.id,
        forumId: b.forumId,
        caseType: 'W.P.',
        number: '202',
        year: 2026,
        provenance: { sourceType: 'manual' },
      });
      await importFile(
        a,
        createMemoryObjectStore(),
        ics([{ uid: 'cross', summary: 'W.P. 202/2026 hearing' }]),
      );
      const [row] = await ledger(a);
      expect(row).toMatchObject({ status: 'unmatched', proceedingId: null });
      expect(await proposals(a)).toHaveLength(0);
      expect(await proposals(b)).toHaveLength(0);
    });
  });

  it('drops events of a sensitive matter instead of storing them', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await setSensitive(w.deps, w.owner, { matterId: w.matterId, sensitive: true });
      const result = await importFile(
        w,
        createMemoryObjectStore(),
        ics([{ uid: 'secret', summary: 'W.P. 101/2026 hearing' }]),
      );
      expect(result).toMatchObject({ outcome: 'imported', summary: { new: 0, ignored: 1 } });
      expect(await ledger(w)).toHaveLength(0);
      expect(await proposals(w)).toHaveLength(0);
    });
  });

  it('fails a capture that is not a calendar, with the capture marked failed', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const result = await importFile(w, createMemoryObjectStore(), 'this is not a calendar');
      expect(result).toEqual({ outcome: 'failed' });
      const [cap] = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(capture));
      expect(cap?.status).toBe('failed');
    });
  });
});

describe('import review', () => {
  it('confirms one event at a time through the engine, skips another, and closes the capture', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const store = createMemoryObjectStore();
      const captureId = await icsCapture(
        w,
        store,
        ics([
          { uid: 'matched', summary: 'W.P. 101/2026 hearing' },
          { uid: 'lost', summary: 'W.P. 999/2026 hearing', start: '20261203T110000' },
        ]),
      );
      await runIcsImport(
        { db: tx, store, now: () => w.clock.now },
        { workspaceId: w.workspaceId, captureId },
      );
      const scope = {
        db: tx,
        workspaceId: w.workspaceId,
        userId: w.ownerId,
        now: () => w.clock.now,
      };
      const review = await getImportReview(scope, captureId);
      expect(review.captureStatus).toBe('needs_you');
      expect(review.rows.map((r) => [r.uid, r.status, r.preview.kind])).toEqual([
        ['matched', 'proposed', 'next_date'],
        ['lost', 'unmatched', 'none'],
      ]);

      await confirmImportEvent(scope, { captureId, uid: 'matched' });
      const current = await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId });
      expect(current?.listDate).toBe('2026-12-02');

      await skipImportEvent(scope, { captureId, uid: 'lost' });
      const after = await getImportReview(scope, captureId);
      expect(after.rows.map((r) => r.status)).toEqual(['applied', 'skipped']);
      expect(after.captureStatus).toBe('applied');
    });
  });
});

describe('private feed', () => {
  const serveDeps = (w: World, over: Partial<ServeDeps> = {}): ServeDeps => ({
    db: w.tx,
    limit: () => Promise.resolve(true),
    enabled: () => Promise.resolve(true),
    appUrl: 'https://app.example.test',
    now: () => w.clock.now,
    ...over,
  });
  const request = (w: World) => ({
    workspaceId: w.workspaceId,
    actorUserId: w.ownerId,
    disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
  });

  it('shows the token once, stores only its hash and needs the disclosure', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await expect(
        createFeed(tx, { ...request(w), disclosureVersion: 'stale' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      const feed = await createFeed(tx, request(w));
      expect(feed.token).toMatch(/^[\w-]{43}$/);
      const [row] = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(icsFeed));
      expect(row?.tokenHash).toBe(createHash('sha256').update(feed.token).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(feed.token);
      expect(row?.disclosureVersion).toBe(CALENDAR_DISCLOSURE_VERSION);
      expect(
        await getFeedStatus(tx, { workspaceId: w.workspaceId, userId: w.ownerId }),
      ).toMatchObject({
        scope: 'mine',
        includeParties: false,
      });
      await expect(createFeed(tx, request(w))).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('publishes only confirmed hearings, minimal by default, with a Kolkata VTIMEZONE', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirmDate(w, '2026-12-15');
      const { token } = await createFeed(tx, request(w));
      const served = await serveFeed(serveDeps(w), { token });
      expect(served.status).toBe(200);
      if (served.status !== 200) return;
      expect(served.body).toContain('BEGIN:VTIMEZONE');
      expect(served.body).toContain('DTSTART;VALUE=DATE:20261215');
      expect(served.body).toMatch(/SUMMARY:Hearing: (W\.P\.|WP) 101\/2026/);
      expect(served.body.replace(/\r\n /g, '')).not.toContain('Ilango');

      // A proposed (unconfirmed) date is never published.
      await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-12-30',
        provenance: { sourceType: 'manual' },
      });
      const again = await serveFeed(serveDeps(w), { token });
      expect(again.status === 200 && again.body.includes('20261230')).toBe(false);

      // Party names only when the feed asks for them.
      await setFeedIncludeParties(tx, { ...request(w), includeParties: true });
      const withParties = await serveFeed(serveDeps(w), { token });
      expect(withParties.status).toBe(200);
    });
  });

  it('answers 304 for an unchanged feed and bumps SEQUENCE and cancels when a date goes', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirmDate(w, '2026-12-15');
      const { token } = await createFeed(tx, request(w));
      const first = await serveFeed(serveDeps(w), { token });
      if (first.status !== 200) throw new Error('expected 200');
      expect(first.body).toContain('SEQUENCE:0');
      expect(await serveFeed(serveDeps(w), { token, ifNoneMatch: first.etag })).toMatchObject({
        status: 304,
      });
      // The next date is moved: the old listing's event is cancelled, the new one is published.
      await confirmDate(w, '2026-12-22');
      const next = await serveFeed(serveDeps(w), { token, ifNoneMatch: first.etag });
      expect(next.status).toBe(200);
      if (next.status !== 200) return;
      expect(next.body).toContain('STATUS:CANCELLED');
      expect(next.body).toContain('DTSTART;VALUE=DATE:20261222');
      expect(next.etag).not.toBe(first.etag);
      const state = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(icsFeedEvent));
      expect(state.some((e) => e.cancelledAt !== null)).toBe(true);
    });
  });

  it('leaves out matters marked sensitive', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirmDate(w, '2026-12-15');
      await setSensitive(w.deps, w.owner, { matterId: w.matterId, sensitive: true });
      const { token } = await createFeed(tx, request(w));
      const served = await serveFeed(serveDeps(w), { token });
      expect(served).toMatchObject({ status: 200 });
      if (served.status === 200) expect(served.body).not.toContain('20261215');
    });
  });

  it('rotate and revoke take effect at once; unknown, revoked and flag-off tokens are the same 404', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { token } = await createFeed(tx, request(w));
      expect((await serveFeed(serveDeps(w), { token })).status).toBe(200);
      const rotated = await rotateFeed(tx, { workspaceId: w.workspaceId, actorUserId: w.ownerId });
      expect(rotated.token).not.toBe(token);
      expect(await serveFeed(serveDeps(w), { token })).toEqual({ status: 404 });
      expect((await serveFeed(serveDeps(w), { token: rotated.token })).status).toBe(200);
      expect(
        await serveFeed(serveDeps(w, { enabled: () => Promise.resolve(false) }), {
          token: rotated.token,
        }),
      ).toEqual({ status: 404 });
      await revokeFeed(tx, { workspaceId: w.workspaceId, actorUserId: w.ownerId });
      expect(await serveFeed(serveDeps(w), { token: rotated.token })).toEqual({ status: 404 });
      expect(await serveFeed(serveDeps(w), { token: 'x'.repeat(43) })).toEqual({ status: 404 });
      expect(await serveFeed(serveDeps(w), { token: 'short' })).toEqual({ status: 404 });
    });
  });

  it('rate limits a feed with 429', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { token } = await createFeed(tx, request(w));
      const keys: string[] = [];
      const limited = serveDeps(w, {
        limit: (key, limit) => {
          keys.push(`${key}:${String(limit.max)}/${String(limit.windowSeconds)}`);
          return Promise.resolve(false);
        },
      });
      expect(await serveFeed(limited, { token })).toMatchObject({ status: 429 });
      expect(keys[0]).toMatch(/^ics:[0-9a-f-]{36}:60\/3600$/);
    });
  });

  it('keeps scopes: the whole workspace is for owners, a clerk gets a feed of their own', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const clerkId = await addMember(tx, w.workspaceId, 'clerk');
      await expect(
        createFeed(tx, {
          workspaceId: w.workspaceId,
          actorUserId: clerkId,
          scope: 'workspace',
          disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const mine = await createFeed(tx, {
        workspaceId: w.workspaceId,
        actorUserId: clerkId,
        disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
      });
      expect(mine.scope).toBe('mine');
      const owned = await createFeed(tx, { ...request(w), scope: 'workspace' });
      expect(owned.scope).toBe('workspace');
    });
  });

  it('a "mine" feed shows the matters its user owns, not the whole workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirmDate(w, '2026-12-15');
      const advocateId = await addMember(tx, w.workspaceId, 'advocate');
      const { token } = await createFeed(tx, {
        workspaceId: w.workspaceId,
        actorUserId: advocateId,
        disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
      });
      const served = await serveFeed(serveDeps(w), { token });
      expect(served.status).toBe(200);
      if (served.status === 200) expect(served.body).not.toContain('20261215');
    });
  });

  it('keeps tenants apart: each workspace has its own feed and a token resolves only its own', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      await confirmDate(a, '2026-12-15');
      await confirmDate(b, '2026-12-20');
      const feedA = await createFeed(tx, {
        workspaceId: a.workspaceId,
        actorUserId: a.ownerId,
        disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
      });
      const feedB = await createFeed(tx, {
        workspaceId: b.workspaceId,
        actorUserId: b.ownerId,
        disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
      });
      const servedA = await serveFeed(serveDeps(a), { token: feedA.token });
      const servedB = await serveFeed(serveDeps(a), { token: feedB.token });
      if (servedA.status !== 200 || servedB.status !== 200) throw new Error('expected 200');
      expect(servedA.body).toContain('20261215');
      expect(servedA.body).not.toContain('20261220');
      expect(servedB.body).toContain('20261220');
      expect(servedB.body).not.toContain('20261215');
    });
  });

  it('a user in two workspaces has two separate feeds', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      const userId = await addMember(tx, a.workspaceId, 'advocate');
      await inWorkspace(tx, b.workspaceId, (s) =>
        s.insert(schema.member).values({ organizationId: b.workspaceId, userId, role: 'advocate' }),
      );
      const feedA = await createFeed(tx, {
        workspaceId: a.workspaceId,
        actorUserId: userId,
        disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
      });
      expect(await getFeedStatus(tx, { workspaceId: b.workspaceId, userId })).toBeNull();
      const feedB = await createFeed(tx, {
        workspaceId: b.workspaceId,
        actorUserId: userId,
        disclosureVersion: CALENDAR_DISCLOSURE_VERSION,
      });
      expect(feedB.id).not.toBe(feedA.id);
      expect(feedB.token).not.toBe(feedA.token);
      expect((await serveFeed(serveDeps(a), { token: feedA.token })).status).toBe(200);
      expect((await serveFeed(serveDeps(b), { token: feedB.token })).status).toBe(200);
    });
  });
});

describe('read-only by construction', () => {
  it('the calendar domain has no outbound path', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('..', import.meta.url);
    const text = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(new URL(f, dir), 'utf8'))
      .join('\n');
    expect(text).not.toMatch(
      /sendMail|sendEmail|sendWhatsApp|nodemailer|ATTENDEE|ORGANIZER|fetch\(/,
    );
  });
});
