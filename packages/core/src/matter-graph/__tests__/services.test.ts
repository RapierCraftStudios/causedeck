// Matter-graph services (#362, part 1 of #33) on the test database: zod-validated inputs, the
// role from the membership row, NOT_FOUND outside the workspace, the typed cross-workspace error on
// links, normalised identifiers, the duplicate finder, and events emitted only for writes that
// commit, with the matter's `sensitive` flag.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  archiveMatter,
  createDocument,
  createMatter,
  createProceeding,
  CrossWorkspaceError,
  findDuplicateProceedings,
  linkProceedings,
  listMatters,
  restrictMatter,
  updateIdentifiers,
  updateMatter,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';
import { addMember, newUser, newWorkspace } from '../../__tests__/fixtures.ts';

const MANUAL = { sourceType: 'manual' } as const;
const SHA = 'b'.repeat(64);

interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  forumId: string;
  events: GraphEvent[];
  deps: MatterGraphDeps;
  as: (userId: string) => { userId: string; workspaceId: string };
}

async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const events: GraphEvent[] = [];
  return {
    tx,
    workspaceId,
    ownerId,
    forumId: forum.id,
    events,
    deps: { db: tx, events: { emit: (e) => events.push(e) } },
    as: (userId) => ({ userId, workspaceId }),
  };
}

async function memberId(tx: Transaction, workspaceId: string, userId: string): Promise<string> {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, userId))),
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

describe('matter services', () => {
  it('creates a matter for a writer, refuses viewers, non-members and invalid input', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const row = await createMatter(w.deps, w.as(w.ownerId), {
        title: 'Fictional Petitioner v. State',
        sensitive: true,
      });
      expect(row).toMatchObject({ workspaceId: w.workspaceId, status: 'active', sensitive: true });
      expect(w.events).toEqual([
        {
          type: 'matter.created',
          workspaceId: w.workspaceId,
          actorUserId: w.ownerId,
          matterId: row.id,
          sensitive: true,
        },
      ]);

      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      expect(await codeOf(createMatter(w.deps, w.as(viewer), { title: 'X' }))).toBe('FORBIDDEN');
      const outsider = await newUser(tx);
      expect(await codeOf(createMatter(w.deps, w.as(outsider), { title: 'X' }))).toBe('NOT_FOUND');
      expect(await codeOf(createMatter(w.deps, w.as(w.ownerId), { title: ' ' }))).toBe(
        'VALIDATION',
      );
      expect(
        await codeOf(
          createMatter(w.deps, w.as(w.ownerId), { title: 'X', extra: 1 } as unknown as {
            title: string;
          }),
        ),
      ).toBe('VALIDATION');
      expect(w.events).toHaveLength(1);
    });
  });

  it('updates and archives a matter; an archived matter is read-only', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const m = await createMatter(w.deps, owner, { title: 'Before' });
      const updated = await updateMatter(w.deps, owner, {
        matterId: m.id,
        patch: { title: 'After', practiceArea: 'writ' },
      });
      expect(updated).toMatchObject({ title: 'After', practiceArea: 'writ' });
      expect(w.events.at(-1)).toMatchObject({
        type: 'matter.updated',
        changed: ['practiceArea', 'title'],
      });
      expect(await codeOf(updateMatter(w.deps, owner, { matterId: m.id, patch: {} }))).toBe(
        'VALIDATION',
      );

      const archived = await archiveMatter(w.deps, owner, { matterId: m.id });
      expect(archived.status).toBe('archived');
      const count = w.events.length;
      await archiveMatter(w.deps, owner, { matterId: m.id });
      expect(w.events).toHaveLength(count);
      expect(
        await codeOf(updateMatter(w.deps, owner, { matterId: m.id, patch: { title: 'Again' } })),
      ).toBe('CONFLICT');
      expect(await codeOf(archiveMatter(w.deps, owner, { matterId: randomUUID() }))).toBe(
        'NOT_FOUND',
      );
    });
  });

  it('lists readable matters in keyset pages, hiding restricted and unassigned ones', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      const junior = await addMember(tx, w.workspaceId, 'junior');
      const juniorMember = await memberId(tx, w.workspaceId, junior);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push((await createMatter(w.deps, owner, { title: `Matter ${String(i)}` })).id);
      }
      const restricted = ids[0] ?? '';
      await restrictMatter(tx, owner, { matterId: restricted, allowedUserIds: [] });
      const juniors = await createMatter(w.deps, owner, {
        title: 'Junior owns',
        ownerMemberId: juniorMember,
      });

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await listMatters(w.deps, owner, {
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...result.items.map((m) => m.id));
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }
      expect([...seen].sort()).toEqual([...ids, juniors.id].sort());
      expect(new Set(seen).size).toBe(seen.length);

      const forAdvocate = await listMatters(w.deps, w.as(advocate), { limit: 100 });
      expect(forAdvocate.items.map((m) => m.id)).not.toContain(restricted);
      expect(forAdvocate.items).toHaveLength(5);
      const forJunior = await listMatters(w.deps, w.as(junior), { limit: 100 });
      expect(forJunior.items.map((m) => m.id)).toEqual([juniors.id]);

      await archiveMatter(w.deps, owner, { matterId: juniors.id });
      const archived = await listMatters(w.deps, owner, { status: 'archived' });
      expect(archived.items.map((m) => m.id)).toEqual([juniors.id]);
      expect(await codeOf(listMatters(w.deps, owner, { cursor: 'not-a-cursor' }))).toBe(
        'VALIDATION',
      );
    });
  });
});

describe('proceeding services', () => {
  it('normalises case type, number and two-digit year; a duplicate identity is CONFLICT', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const m = await createMatter(w.deps, owner, { title: 'Writ', sensitive: true });
      const p = await createProceeding(w.deps, owner, {
        matterId: m.id,
        forumId: w.forumId,
        caseType: 'w.p.',
        number: '00045',
        year: 24,
        provenance: MANUAL,
      });
      expect(p).toMatchObject({
        caseTypeCode: 'WP',
        caseTypeRaw: 'w.p.',
        number: '45',
        year: 2024,
      });
      expect(w.events.at(-1)).toEqual({
        type: 'proceeding.created',
        workspaceId: w.workspaceId,
        actorUserId: w.ownerId,
        matterId: m.id,
        sensitive: true,
        proceedingId: p.id,
      });
      const count = w.events.length;
      const again = createProceeding(w.deps, owner, {
        matterId: m.id,
        forumId: w.forumId,
        caseType: 'WP',
        number: '45',
        year: 2024,
        provenance: MANUAL,
      });
      expect(await codeOf(again)).toBe('CONFLICT');
      expect(
        await codeOf(
          createProceeding(w.deps, owner, {
            matterId: m.id,
            forumId: randomUUID(),
            caseType: 'WP',
            provenance: MANUAL,
          }),
        ),
      ).toBe('NOT_FOUND');
      expect(
        await codeOf(
          createProceeding(w.deps, owner, {
            matterId: m.id,
            forumId: w.forumId,
            caseType: 'WP',
            provenance: { sourceType: 'adapter' },
          }),
        ),
      ).toBe('VALIDATION');
      // Failed writes roll back and emit nothing.
      expect(w.events).toHaveLength(count);

      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      expect(
        await codeOf(
          updateIdentifiers(w.deps, w.as(viewer), { proceedingId: p.id, cnr: 'TNMH010000452024' }),
        ),
      ).toBe('FORBIDDEN');
      const fixed = await updateIdentifiers(w.deps, owner, {
        proceedingId: p.id,
        cnr: 'tnmh010000452024',
        number: '046',
      });
      expect(fixed).toMatchObject({ cnr: 'TNMH010000452024', number: '46' });
      expect(w.events.at(-1)).toMatchObject({
        type: 'proceeding.identifiers_updated',
        changed: ['cnr', 'number'],
      });
    });
  });

  it('links within a workspace only: across workspaces it is a CrossWorkspaceError', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      const proceedingOf = async (w: World, caseType: string) => {
        const m = await createMatter(w.deps, w.as(w.ownerId), { title: caseType });
        return createProceeding(w.deps, w.as(w.ownerId), {
          matterId: m.id,
          forumId: w.forumId,
          caseType,
          provenance: MANUAL,
        });
      };
      const wp = await proceedingOf(a, 'W.P.');
      const wa = await proceedingOf(a, 'W.A.');
      const other = await proceedingOf(b, 'W.P.');
      const link = (from: string, to: string, kind: 'appeal_from' | 'parent_of' = 'appeal_from') =>
        linkProceedings(a.deps, a.as(a.ownerId), {
          fromProceedingId: from,
          toProceedingId: to,
          kind,
          provenance: MANUAL,
        });

      const count = a.events.length;
      for (const [from, to] of [
        [wp.id, other.id],
        [other.id, wp.id],
      ] as const) {
        const error: unknown = await link(from, to).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CrossWorkspaceError);
        expect((error as CrossWorkspaceError).code).toBe('NOT_FOUND');
      }
      // The same call from inside B's scope is refused before any query.
      const fromB = await inWorkspace(tx, b.workspaceId, (s) =>
        linkProceedings({ ...a.deps, db: s }, a.as(a.ownerId), {
          fromProceedingId: wp.id,
          toProceedingId: wa.id,
          kind: 'connected',
          provenance: MANUAL,
        }).catch((e: unknown) => e),
      );
      expect(fromB).toBeInstanceOf(CrossWorkspaceError);
      for (const w of [a, b]) {
        expect(
          await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.proceedingLink)),
        ).toEqual([]);
      }
      expect(a.events).toHaveLength(count);

      const row = await link(wa.id, wp.id);
      expect(row).toMatchObject({ workspaceId: a.workspaceId, kind: 'appeal_from' });
      expect(a.events.at(-1)).toMatchObject({ type: 'proceeding.linked', linkId: row.id });
      expect(await codeOf(link(wa.id, wp.id))).toBe('CONFLICT');
      await link(wp.id, wa.id, 'parent_of');
      expect(await codeOf(link(wa.id, wp.id, 'parent_of'))).toBe('CONFLICT');
      expect(await codeOf(link(wp.id, wp.id))).toBe('VALIDATION');
    });
  });

  it('finds duplicates by CNR first, then by the normalised identity', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const m = await createMatter(w.deps, owner, { title: 'Writ' });
      const base = { matterId: m.id, forumId: w.forumId, provenance: MANUAL };
      const byIdentity = await createProceeding(w.deps, owner, {
        ...base,
        caseType: 'W.P.',
        number: '0010234',
        year: 26,
      });
      const byCnr = await createProceeding(w.deps, owner, {
        ...base,
        caseType: 'W.M.P.',
        number: '1',
        year: 2026,
        cnr: 'TNMH010102342026',
      });
      await createProceeding(w.deps, owner, {
        ...base,
        caseType: 'WP',
        number: '10235',
        year: 2026,
      });

      const found = await findDuplicateProceedings(w.deps, owner, {
        identity: { cnr: 'TNMH010102342026', caseType: 'wp', number: '10234', year: 2026 },
      });
      expect(found.map((p) => p.id)).toEqual([byCnr.id, byIdentity.id]);
      const excluded = await findDuplicateProceedings(w.deps, owner, {
        identity: { caseType: 'W P', number: '10234', year: 26 },
        excludeProceedingId: byIdentity.id,
      });
      expect(excluded).toEqual([]);
      expect(
        await codeOf(findDuplicateProceedings(w.deps, owner, { identity: { caseType: 'WP' } })),
      ).toBe('VALIDATION');
    });
  });
});

describe('createDocument', () => {
  it('emits document.created carrying the matter sensitive flag', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const owner = w.as(w.ownerId);
      const document = (matterId: string) => ({
        matterId,
        kind: 'pleading' as const,
        storageKey: `ws/${w.workspaceId}/document/${randomUUID()}`,
        sha256: SHA,
      });
      const sensitive = await createMatter(w.deps, owner, { title: 'Sealed', sensitive: true });
      const plain = await createMatter(w.deps, owner, { title: 'Open' });
      w.events.length = 0;

      const doc = await createDocument(w.deps, owner, document(sensitive.id));
      expect(doc).toMatchObject({ matterId: sensitive.id, workspaceId: w.workspaceId });
      expect(w.events).toEqual([
        {
          type: 'document.created',
          workspaceId: w.workspaceId,
          actorUserId: w.ownerId,
          matterId: sensitive.id,
          sensitive: true,
          documentId: doc.id,
        },
      ]);
      await createDocument(w.deps, owner, document(plain.id));
      expect(w.events.at(-1)).toMatchObject({ matterId: plain.id, sensitive: false });

      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      expect(await codeOf(createDocument(w.deps, w.as(viewer), document(plain.id)))).toBe(
        'FORBIDDEN',
      );
      expect(
        await codeOf(
          createDocument(w.deps, owner, { ...document(plain.id), storageKey: 'ws/other/x' }),
        ),
      ).toBe('VALIDATION');
      expect(w.events).toHaveLength(2);
    });
  });
});
