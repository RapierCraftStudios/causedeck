// Matter read models (#386, part 1 of #40) on the test database: every searchMatters filter, sort
// and keyset page, case-number search in any punctuation, visibility (restricted matters, junior
// scope), the Overview (next date with provenance, unresolved conflicts, synopsis only with
// `strategy.read`), the proceedings tree, people grouped by role edge and the documents' version
// chain. Every name is fictional.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildDocument,
  buildForum,
  buildListing,
  buildMatter,
  buildObligation,
  buildPerson,
  buildProceeding,
  buildProceedingLink,
  buildRoleEdge,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  getMatterOverview,
  listMatterDocuments,
  listMatterPeople,
  listMatterProceedingsTree,
  restrictMatter,
  searchMatters,
  WorkspaceError,
  type MatterGraphDeps,
  type MatterListRow,
} from '../../index.ts';
import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

/** The court day is 2026-10-21 in Asia/Kolkata. */
const NOW = new Date('2026-10-21T06:00:00Z');

interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  forumId: string;
  otherForumId: string;
  deps: MatterGraphDeps;
  as: (userId: string) => { userId: string; workspaceId: string };
  in: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
}

async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const run = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, workspaceId, fn);
  const forum = await run((s) => buildForum(s, workspaceId));
  const other = await run((s) =>
    buildForum(s, workspaceId, { court: 'City Civil Court', seat: 'Bengaluru' }),
  );
  return {
    tx,
    workspaceId,
    ownerId,
    forumId: forum.id,
    otherForumId: other.id,
    deps: { db: tx, events: { emit: () => undefined }, now: () => NOW },
    as: (userId) => ({ userId, workspaceId }),
    in: run,
  };
}

async function memberIdOf(w: World, userId: string): Promise<string> {
  const [row] = await w.in((s) =>
    s
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, w.workspaceId), eq(schema.member.userId, userId)),
      ),
  );
  if (!row) throw new Error('member not found');
  return row.id;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

/** A matter with one main W.P. proceeding and, optionally, a canonical listing. */
async function seedMatter(
  w: World,
  opts: {
    title: string;
    updatedAt?: Date;
    status?: 'active' | 'disposed' | 'archived';
    sensitive?: boolean;
    ownerMemberId?: string;
    forumId?: string;
    number?: string;
    year?: number;
    caseTypeCode?: string;
    next?: string;
    petitioner?: string;
    respondent?: string;
  },
) {
  return w.in(async (s) => {
    const m = await buildMatter(s, w.workspaceId, {
      title: opts.title,
      ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.sensitive === undefined ? {} : { sensitive: opts.sensitive }),
      ...(opts.ownerMemberId ? { ownerMemberId: opts.ownerMemberId } : {}),
    });
    const p = await buildProceeding(s, w.workspaceId, {
      matterId: m.id,
      forumId: opts.forumId ?? w.forumId,
      caseTypeCode: opts.caseTypeCode ?? 'WP',
      number: opts.number ?? null,
      year: opts.year ?? null,
      titlePetitioner: opts.petitioner ?? null,
      titleRespondent: opts.respondent ?? null,
    });
    const l =
      opts.next === undefined
        ? undefined
        : await buildListing(s, w.workspaceId, {
            proceedingId: p.id,
            listDate: opts.next,
            canonical: true,
            confirmationState: 'confirmed',
            stageRaw: 'FOR ADMISSION',
          });
    return { matterId: m.id, proceedingId: p.id, listingId: l?.id };
  });
}

async function allPages(
  w: World,
  userId: string,
  input: Parameters<typeof searchMatters>[2],
): Promise<MatterListRow[]> {
  const out: MatterListRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await searchMatters(w.deps, w.as(userId), {
      ...input,
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    out.push(...result.items);
    if (result.nextCursor === null) return out;
    cursor = result.nextCursor;
  }
  throw new Error('too many pages');
}

describe('searchMatters', () => {
  it('returns the list row: parties, forum, stage, proceeding count, next date, owner', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const ownerMember = await memberIdOf(w, w.ownerId);
      const a = await seedMatter(w, {
        title: 'Ilango v. Mullai Traders (fictional)',
        petitioner: 'P. Ilango (fictional)',
        respondent: 'Mullai Traders (fictional)',
        ownerMemberId: ownerMember,
        number: '12345',
        year: 2026,
        next: '2026-11-02',
      });
      // A W.M.P. child, a past canonical date and a later one: the earliest upcoming wins.
      await w.in(async (s) => {
        const child = await buildProceeding(s, w.workspaceId, {
          matterId: a.matterId,
          forumId: w.forumId,
          kind: 'misc',
          caseTypeCode: 'WMP',
          parentProceedingId: a.proceedingId,
        });
        await buildListing(s, w.workspaceId, {
          proceedingId: child.id,
          listDate: '2026-10-25',
          canonical: true,
          stageRaw: 'FOR ORDERS',
          stageNorm: 'orders',
        });
      });

      const { items, nextCursor } = await searchMatters(w.deps, w.as(w.ownerId));
      expect(nextCursor).toBeNull();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: a.matterId,
        petitioner: 'P. Ilango (fictional)',
        respondent: 'Mullai Traders (fictional)',
        forum: { id: w.forumId, court: 'High Court of Madras' },
        stage: 'orders',
        proceedingCount: 2,
        nextDate: { date: '2026-10-25', confirmationState: 'proposed', sourceType: 'manual' },
        owner: { memberId: ownerMember, userId: w.ownerId },
        sensitive: false,
        status: 'active',
      });
    });
  });

  it('filters by status, forum, owner, no next date and sensitive', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      const advocateMember = await memberIdOf(w, advocate);
      const dated = await seedMatter(w, { title: 'Dated', next: '2026-11-01' });
      const past = await seedMatter(w, { title: 'Past only', next: '2026-10-01' });
      const disposed = await seedMatter(w, { title: 'Disposed', status: 'disposed' });
      const sensitive = await seedMatter(w, { title: 'Sensitive', sensitive: true });
      const bengaluru = await seedMatter(w, { title: 'Elsewhere', forumId: w.otherForumId });
      const owned = await seedMatter(w, { title: 'Owned', ownerMemberId: advocateMember });

      const ids = async (input: Parameters<typeof searchMatters>[2]) =>
        (await searchMatters(w.deps, w.as(w.ownerId), { ...input, limit: 100 })).items
          .map((m) => m.id)
          .sort();
      const sorted = (...list: { matterId: string }[]) => list.map((m) => m.matterId).sort();

      expect(await ids({ status: 'disposed' })).toEqual(sorted(disposed));
      expect(await ids({ forumId: w.otherForumId })).toEqual(sorted(bengaluru));
      expect(await ids({ ownerMemberId: advocateMember })).toEqual(sorted(owned));
      expect(await ids({ sensitive: true })).toEqual(sorted(sensitive));
      expect(await ids({ noNextDate: false })).toEqual(sorted(dated));
      // A past canonical date is not a next date.
      expect(await ids({ noNextDate: true })).toEqual(
        sorted(past, disposed, sensitive, bengaluru, owned),
      );
      expect(await ids({ sensitive: false, status: 'active', noNextDate: true })).toEqual(
        sorted(past, bengaluru, owned),
      );
    });
  });

  it('finds matters by title, party, alias and case number in any punctuation', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const writ = await seedMatter(w, {
        title: 'Kaveri Writ (fictional)',
        petitioner: 'P. Ilango (fictional)',
        respondent: 'Mullai Traders (fictional)',
        number: '45',
        year: 2026,
      });
      const suit = await seedMatter(w, {
        title: 'Thendral Suit (fictional)',
        caseTypeCode: 'OS',
        number: '12345',
        year: 2024,
      });
      await w.in(async (s) => {
        const party = await buildPerson(s, w.workspaceId, {
          name: 'R. Nila (fictional)',
          aliases: ['Nila Enterprises (fictional)'],
        });
        await buildRoleEdge(s, w.workspaceId, {
          fromPersonId: party.id,
          kind: 'appears_for',
          proceedingId: suit.proceedingId,
        });
      });
      const find = async (q: string) =>
        (await searchMatters(w.deps, w.as(w.ownerId), { q })).items.map((m) => m.id);

      expect(await find('kaveri writ')).toEqual([writ.matterId]);
      expect(await find('ilango')).toEqual([writ.matterId]);
      expect(await find('MULLAI')).toEqual([writ.matterId]);
      expect(await find('Nila (fictional)')).toEqual([suit.matterId]);
      expect(await find('enterprises')).toEqual([suit.matterId]);
      for (const q of ['W.P. No. 45 of 2026', 'WP 45/2026', 'wp-0045-26', 'WP45/26', 'w.p 45']) {
        expect(await find(q), q).toEqual([writ.matterId]);
      }
      for (const q of ['O.S. 12345/2024', 'os no 12345 of 24', '12345']) {
        expect(await find(q), q).toEqual([suit.matterId]);
      }
      expect(await find('WP 45/2025')).toEqual([]);
      expect(await find('O.S. 45/2026')).toEqual([]);
      // LIKE wildcards are literal.
      expect(await find('%')).toEqual([]);
    });
  });

  it('sorts by next date (nulls last), updated and title, paging without gaps or repeats', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const at = (day: number) => new Date(Date.UTC(2026, 9, day));
      const m = [
        await seedMatter(w, { title: 'charlie', next: '2026-11-03', updatedAt: at(3) }),
        await seedMatter(w, { title: 'Alpha', next: '2026-11-01', updatedAt: at(1) }),
        await seedMatter(w, { title: 'echo', updatedAt: at(5) }),
        await seedMatter(w, { title: 'bravo', next: '2026-11-01', updatedAt: at(5) }),
        await seedMatter(w, { title: 'Delta', updatedAt: at(2) }),
      ];
      const [charlie, alpha, echo, bravo, delta] = m.map((x) => x.matterId) as [
        string,
        string,
        string,
        string,
        string,
      ];
      const tie = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

      const byDate = (await allPages(w, w.ownerId, { sort: 'next_date' })).map((r) => r.id);
      expect(byDate).toEqual([...tie(alpha, bravo), charlie, ...tie(delta, echo)]);
      const byUpdated = (await allPages(w, w.ownerId, { sort: 'updated' })).map((r) => r.id);
      expect(byUpdated).toEqual([...tie(bravo, echo).reverse(), charlie, delta, alpha]);
      const byTitle = (await allPages(w, w.ownerId, { sort: 'title' })).map((r) => r.id);
      expect(byTitle).toEqual([alpha, bravo, charlie, delta, echo]);
      // The default sort is the next date.
      const first = await searchMatters(w.deps, w.as(w.ownerId), { limit: 2 });
      expect(first.items.map((r) => r.id)).toEqual(tie(alpha, bravo));

      // A cursor belongs to its sort; a garbled one is invalid.
      const cursor = first.nextCursor ?? '';
      expect(await codeOf(searchMatters(w.deps, w.as(w.ownerId), { sort: 'title', cursor }))).toBe(
        'VALIDATION',
      );
      expect(await codeOf(searchMatters(w.deps, w.as(w.ownerId), { cursor: 'nope' }))).toBe(
        'VALIDATION',
      );
      expect(await codeOf(searchMatters(w.deps, w.as(w.ownerId), { limit: 101 }))).toBe(
        'VALIDATION',
      );
    });
  });

  it('defaults to pages of 50 and leaves merged matters out', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.in(async (s) => {
        for (let i = 0; i < 51; i++)
          await buildMatter(s, w.workspaceId, { title: `M ${String(i)}` });
      });
      const survivor = await seedMatter(w, { title: 'Survivor' });
      await w.in((s) =>
        buildMatter(s, w.workspaceId, { title: 'Merged', mergedIntoMatterId: survivor.matterId }),
      );
      const first = await searchMatters(w.deps, w.as(w.ownerId), { sort: 'title' });
      expect(first.items).toHaveLength(50);
      const rest = await searchMatters(w.deps, w.as(w.ownerId), {
        sort: 'title',
        cursor: first.nextCursor ?? '',
      });
      expect(rest.items).toHaveLength(2);
      expect(rest.nextCursor).toBeNull();
      expect([...first.items, ...rest.items].map((r) => r.title)).not.toContain('Merged');
    });
  });

  it('honours visibility: restricted matters, junior scope, outsiders', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      const junior = await addMember(tx, w.workspaceId, 'junior');
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      const juniorMember = await memberIdOf(w, junior);
      const open = await seedMatter(w, { title: 'Open matter' });
      const restricted = await seedMatter(w, { title: 'Restricted matter' });
      const juniors = await seedMatter(w, { title: 'Junior owns', ownerMemberId: juniorMember });
      await restrictMatter(tx, w.as(w.ownerId), {
        matterId: restricted.matterId,
        allowedUserIds: [],
      });
      const ids = async (userId: string) =>
        (await searchMatters(w.deps, w.as(userId), { q: 'matter' })).items.map((r) => r.id);

      expect((await ids(w.ownerId)).sort()).toEqual([open.matterId, restricted.matterId].sort());
      expect(await ids(advocate)).toEqual([open.matterId]);
      expect(await ids(viewer)).toEqual([open.matterId]);
      expect((await searchMatters(w.deps, w.as(junior))).items.map((r) => r.id)).toEqual([
        juniors.matterId,
      ]);

      const other = await newWorkspace(tx);
      const theirs = await searchMatters(w.deps, {
        userId: other.ownerId,
        workspaceId: other.workspaceId,
      });
      expect(theirs.items).toEqual([]);
      expect(
        await codeOf(searchMatters(w.deps, { userId: other.ownerId, workspaceId: w.workspaceId })),
      ).toBe('NOT_FOUND');
    });
  });
});

describe('matter workspace read models', () => {
  it('builds the Overview with next date provenance, conflicts, counts and people', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const a = await seedMatter(w, { title: 'Overview (fictional)', next: '2026-11-02' });
      await w.in(async (s) => {
        await s
          .update(schema.matter)
          .set({ synopsis: 'Argue delay first.' })
          .where(eq(schema.matter.id, a.matterId));
        // A proposal for another date is a conflict; one for a past date is not.
        await buildListing(s, w.workspaceId, {
          proceedingId: a.proceedingId,
          listDate: '2026-11-09',
          sourceType: 'adapter',
          sourceRef: 'cause-list:2026-10-20',
        });
        await buildListing(s, w.workspaceId, {
          proceedingId: a.proceedingId,
          listDate: '2026-10-01',
          sourceType: 'adapter',
          sourceRef: 'old',
        });
        await buildObligation(s, w.workspaceId, { matterId: a.matterId });
        const elsewhere = await buildMatter(s, w.workspaceId, { title: 'Elsewhere' });
        await buildObligation(s, w.workspaceId, { matterId: elsewhere.id });
        await buildDocument(s, w.workspaceId, { matterId: a.matterId });
        const client = await buildPerson(s, w.workspaceId, {
          kind: 'client',
          contact: { phone: '+91 00000 00000' },
        });
        await buildRoleEdge(s, w.workspaceId, { fromPersonId: client.id, matterId: a.matterId });
      });

      const overview = await getMatterOverview(w.deps, w.as(w.ownerId), { matterId: a.matterId });
      expect(overview.header).toMatchObject({ id: a.matterId, title: 'Overview (fictional)' });
      expect(overview.header.clients.map((c) => c.kind)).toEqual(['client']);
      expect(overview.nextDate).toMatchObject({
        date: '2026-11-02',
        listingId: a.listingId,
        canonical: true,
        provenance: { sourceType: 'manual', confirmationState: 'confirmed' },
      });
      expect(overview.conflicts).toHaveLength(1);
      expect(overview.conflicts[0]).toMatchObject({
        proceedingId: a.proceedingId,
        current: { date: '2026-11-02', canonical: true },
        proposed: {
          date: '2026-11-09',
          canonical: false,
          provenance: { sourceType: 'adapter', sourceRef: 'cause-list:2026-10-20' },
        },
      });
      expect(overview.proceedings).toMatchObject({
        count: 1,
        byState: { filed: 1 },
        lead: { id: a.proceedingId },
      });
      expect(overview.openObligations).toBe(1);
      expect(overview.recentDocuments).toHaveLength(1);
      expect(overview.people.find((g) => g.kind === 'represents')?.edges).toHaveLength(1);
      expect(overview.synopsis).toEqual({
        text: 'Argue delay first.',
        provenance: { sourceType: 'manual' },
      });
      expect(overview.synopsisDenied).toBe(false);
      // Nothing was resolved: the canonical listing is unchanged.
      const [canonical] = await w.in((s) =>
        s
          .select()
          .from(schema.listing)
          .where(eq(schema.listing.id, a.listingId ?? '')),
      );
      expect(canonical?.canonical).toBe(true);
    });
  });

  it('shows the synopsis only with strategy.read and hides unreadable matters', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const a = await seedMatter(w, { title: 'Strategy (fictional)' });
      await w.in((s) =>
        s
          .update(schema.matter)
          .set({ synopsis: 'Private strategy.' })
          .where(eq(schema.matter.id, a.matterId)),
      );
      const clerk = await addMember(tx, w.workspaceId, 'clerk');
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      for (const userId of [clerk, viewer]) {
        const view = await getMatterOverview(w.deps, w.as(userId), { matterId: a.matterId });
        expect(view.synopsis).toBeNull();
        expect(view.synopsisDenied).toBe(true);
      }
      const forAdvocate = await getMatterOverview(w.deps, w.as(advocate), { matterId: a.matterId });
      expect(forAdvocate.synopsis?.text).toBe('Private strategy.');

      const junior = await addMember(tx, w.workspaceId, 'junior');
      const other = await newWorkspace(tx);
      for (const read of [
        getMatterOverview,
        listMatterProceedingsTree,
        listMatterPeople,
        listMatterDocuments,
      ] as const) {
        expect(await codeOf(read(w.deps, w.as(junior), { matterId: a.matterId }))).toBe(
          'NOT_FOUND',
        );
        expect(
          await codeOf(
            read(
              w.deps,
              { userId: other.ownerId, workspaceId: other.workspaceId },
              {
                matterId: a.matterId,
              },
            ),
          ),
        ).toBe('NOT_FOUND');
        expect(await codeOf(read(w.deps, w.as(w.ownerId), { matterId: randomUUID() }))).toBe(
          'NOT_FOUND',
        );
      }
    });
  });

  it('lists the proceedings tree with children, links and next dates', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const a = await seedMatter(w, {
        title: 'Tree',
        number: '45',
        year: 2026,
        next: '2026-11-02',
      });
      const other = await seedMatter(w, { title: 'Appeal elsewhere' });
      const { wmp, wa } = await w.in(async (s) => {
        const wmpRow = await buildProceeding(s, w.workspaceId, {
          matterId: a.matterId,
          forumId: w.forumId,
          kind: 'misc',
          caseTypeCode: 'WMP',
          caseTypeRaw: 'W.M.P.',
          parentProceedingId: a.proceedingId,
          srNo: 'SR 101',
        });
        const waRow = await buildProceeding(s, w.workspaceId, {
          matterId: a.matterId,
          forumId: w.forumId,
          createdAt: new Date(Date.now() + 60_000),
          kind: 'appeal',
          caseTypeCode: 'WA',
          number: '7',
          year: 2026,
        });
        await buildProceedingLink(s, w.workspaceId, {
          fromProceedingId: waRow.id,
          toProceedingId: a.proceedingId,
          kind: 'appeal_from',
        });
        await buildProceedingLink(s, w.workspaceId, {
          fromProceedingId: a.proceedingId,
          toProceedingId: other.proceedingId,
          kind: 'connected',
        });
        return { wmp: wmpRow, wa: waRow };
      });

      const tree = await listMatterProceedingsTree(w.deps, w.as(w.ownerId), {
        matterId: a.matterId,
      });
      expect(tree.map((n) => n.id)).toEqual([a.proceedingId, wa.id]);
      const [main, appeal] = tree;
      expect(main).toMatchObject({
        number: '45',
        unnumbered: false,
        nextDate: { date: '2026-11-02' },
      });
      expect(main?.children.map((c) => c.id)).toEqual([wmp.id]);
      expect(main?.children[0]).toMatchObject({
        caseType: 'W.M.P.',
        unnumbered: true,
        srNo: 'SR 101',
      });
      expect(main?.links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'appeal_from',
            direction: 'to',
            otherProceedingId: wa.id,
          }),
          expect.objectContaining({
            kind: 'connected',
            direction: 'from',
            otherProceedingId: other.proceedingId,
            otherMatterId: other.matterId,
          }),
        ]),
      );
      expect(appeal?.links).toEqual([
        expect.objectContaining({
          direction: 'from',
          otherProceedingId: a.proceedingId,
          otherMatterId: null,
        }),
      ]);

      // A restricted matter at the other end of a link is not named.
      await restrictMatter(tx, w.as(w.ownerId), { matterId: other.matterId, allowedUserIds: [] });
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      const forAdvocate = await listMatterProceedingsTree(w.deps, w.as(advocate), {
        matterId: a.matterId,
      });
      expect(forAdvocate[0]?.links.find((l) => l.kind === 'connected')?.otherMatterId).toBeNull();
    });
  });

  it('groups people by role edge kind with contact only for clients and professionals', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const a = await seedMatter(w, { title: 'People' });
      await w.in(async (s) => {
        const client = await buildPerson(s, w.workspaceId, {
          kind: 'client',
          name: 'P. Ilango (fictional)',
          contact: { email: 'ilango@example.test' },
        });
        const counsel = await buildPerson(s, w.workspaceId, {
          kind: 'advocate',
          name: 'R. Nila (fictional)',
        });
        const elsewhere = await seedMatter(w, { title: 'Elsewhere' });
        await buildRoleEdge(s, w.workspaceId, { fromPersonId: client.id, matterId: a.matterId });
        await buildRoleEdge(s, w.workspaceId, {
          fromPersonId: counsel.id,
          kind: 'opposes',
          proceedingId: a.proceedingId,
        });
        await buildRoleEdge(s, w.workspaceId, {
          fromPersonId: counsel.id,
          kind: 'appears_for',
          matterId: elsewhere.matterId,
        });
      });
      const groups = await listMatterPeople(w.deps, w.as(w.ownerId), { matterId: a.matterId });
      expect(groups.map((g) => g.kind)).toEqual([
        'represents',
        'appears_for',
        'instructed_by',
        'assigned_to',
        'opposes',
      ]);
      const represents = groups[0]?.edges ?? [];
      expect(represents).toHaveLength(1);
      expect(represents[0]?.person).toMatchObject({
        kind: 'client',
        contact: { email: 'ilango@example.test' },
      });
      expect(groups[1]?.edges).toEqual([]);
      expect(groups[4]?.edges[0]).toMatchObject({
        proceedingId: a.proceedingId,
        person: { kind: 'advocate', contact: null },
      });
    });
  });

  it('lists documents newest first with kind, text status, source and version chain', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const a = await seedMatter(w, { title: 'Documents' });
      const { first, second, third } = await w.in(async (s) => {
        const at = (day: number) => new Date(Date.UTC(2026, 9, day));
        const one = await buildDocument(s, w.workspaceId, {
          matterId: a.matterId,
          kind: 'pleading',
          language: 'ta',
          createdAt: at(1),
        });
        const two = await buildDocument(s, w.workspaceId, {
          matterId: a.matterId,
          kind: 'pleading',
          supersedesDocumentId: one.id,
          textStatus: 'ocr',
          createdAt: at(2),
        });
        const three = await buildDocument(s, w.workspaceId, {
          matterId: a.matterId,
          kind: 'order',
          createdAt: at(3),
        });
        return { first: one, second: two, third: three };
      });
      const page1 = await listMatterDocuments(w.deps, w.as(w.ownerId), {
        matterId: a.matterId,
        limit: 2,
      });
      expect(page1.items.map((d) => d.id)).toEqual([third.id, second.id]);
      expect(page1.items[1]).toMatchObject({
        textStatus: 'ocr',
        supersedesDocumentId: first.id,
        supersededByDocumentId: null,
        source: { type: 'manual' },
      });
      const page2 = await listMatterDocuments(w.deps, w.as(w.ownerId), {
        matterId: a.matterId,
        limit: 2,
        cursor: page1.nextCursor ?? '',
      });
      expect(page2.items.map((d) => d.id)).toEqual([first.id]);
      expect(page2.items[0]).toMatchObject({ language: 'ta', supersededByDocumentId: second.id });
      expect(page2.nextCursor).toBeNull();
    });
  });
});
