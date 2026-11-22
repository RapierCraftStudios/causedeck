// The statutes domain (#1125) over a real database. Statute rows are global and SELECT-only for the
// app role, so the owner commits them in `beforeAll` and `afterAll` removes only what this file
// created; judgments are inserted inside each rolled-back app transaction. Covers the section view
// with its CODE_MAP counterpart, history and dated lookups, top authorities across both codes
// (masked titles only, D-053), search, membership, and that nothing reaches audit or logs.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { createDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newUser, newWorkspace } from '../__tests__/fixtures.ts';
import { setAuditSink } from '../workspaces/index.ts';

import {
  getSection,
  listSectionHistory,
  searchSections,
  STATUTE_QUERY_MAX_CHARS,
  topAuthoritiesForSection,
} from './service.ts';

const { statuteAct, statuteSection, statuteSectionVersion } = schema;
const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });

const IPC = 'indian penal code';
const BNS = 'bharatiya nyaya sanhita';
const TEST_ACT = `test act ${randomUUID().slice(0, 8)}`;
const IPC_304A_TEXT = 'Whoever causes the death of any person by doing any rash or negligent act.';

const created = { acts: [] as string[], sections: [] as string[] };

async function ensureAct(key: string, title: string, shortName: string): Promise<string> {
  const [inserted] = await owner
    .insert(statuteAct)
    .values({
      key,
      title,
      shortName,
      inForceFrom: '1860-10-06',
      sourceNote: 'synthetic test fixture (#1125)',
      synthetic: true,
    })
    .onConflictDoNothing()
    .returning({ id: statuteAct.id });
  if (inserted !== undefined) {
    created.acts.push(inserted.id);
    return inserted.id;
  }
  const [row] = await owner
    .select({ id: statuteAct.id })
    .from(statuteAct)
    .where(eq(statuteAct.key, key));
  if (row === undefined) throw new Error(`act ${key} missing`);
  return row.id;
}

async function ensureSection(
  actId: string,
  section: string,
  heading: string,
  versions: { text: string; validFrom: string; validTo: string | null }[],
): Promise<void> {
  const [inserted] = await owner
    .insert(statuteSection)
    .values({ actId, section, heading })
    .onConflictDoNothing()
    .returning({ id: statuteSection.id });
  if (inserted === undefined) return;
  created.sections.push(inserted.id);
  await owner.insert(statuteSectionVersion).values(
    versions.map((v) => ({
      sectionId: inserted.id,
      ...v,
      sourceNote: 'synthetic test fixture (#1125)',
      synthetic: true,
    })),
  );
}

beforeAll(async () => {
  const ipc = await ensureAct(IPC, 'Indian Penal Code', 'IPC');
  const bns = await ensureAct(BNS, 'Bharatiya Nyaya Sanhita', 'BNS');
  const test = await ensureAct(TEST_ACT, `Test Act ${TEST_ACT}`, 'TA');
  await ensureSection(ipc, '304a', 'Causing death by negligence', [
    { text: IPC_304A_TEXT, validFrom: '1870-01-01', validTo: '2024-07-01' },
  ]);
  await ensureSection(bns, '106', 'Causing death by negligence', [
    { text: 'BNS 106 text.', validFrom: '2024-07-01', validTo: null },
  ]);
  await ensureSection(test, '7', 'Duty of the keeper', [
    { text: 'Version one.', validFrom: '2000-01-01', validTo: '2010-01-01' },
    { text: 'Version two.', validFrom: '2010-01-01', validTo: null },
  ]);
});

afterAll(async () => {
  if (created.sections.length > 0) {
    await owner.delete(statuteSection).where(inArray(statuteSection.id, created.sections));
  }
  if (created.acts.length > 0) {
    await owner.delete(statuteAct).where(inArray(statuteAct.id, created.acts));
  }
  await owner.$client.end();
});

async function member(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  return { workspaceId, userId: ownerId };
}

async function seedJudgment(
  tx: Transaction,
  v: {
    title: string;
    titleMasked?: boolean;
    level: string;
    redactionVersion?: number;
    statute: string;
    section: string;
    page: number;
  },
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.test.judgments',
      court: v.level === 'supreme_court' ? 'SC' : 'MHC',
      sha256,
      neutralCitation: `2019:T:${sha256.slice(0, 6)}`,
      judgmentDate: '2019-03-04',
      provenance: {
        url: `https://court.example/${sha256}.pdf`,
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.test.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'Raw page text with a party name.' }],
      redactionVersion: v.redactionVersion ?? 1,
      caseTitle: v.title,
      titleMasked: v.titleMasked ?? false,
      courtLevel: v.level,
    })
    .returning({ id: schema.judgment.id });
  const judgmentId = row?.id ?? '';
  await tx.insert(schema.judgmentStatuteRef).values({
    judgmentId,
    statute: v.statute,
    section: v.section,
    page: v.page,
    rulesetVersion: 'enrich-1',
  });
  return judgmentId;
}

describe('getSection (#1125)', () => {
  it('returns the IPC 304A text, heading and its BNS 106 counterpart', async () => {
    await withTestDb(async (tx) => {
      const view = await getSection(tx, await member(tx), {
        statute: 'Indian Penal Code',
        section: '304A',
        onDate: '2020-01-01',
      });
      expect(view?.act.key).toBe(IPC);
      expect(view?.section).toBe('304a');
      expect(view?.heading).toBe('Causing death by negligence');
      expect(view?.version?.text).toBe(IPC_304A_TEXT);
      expect(view?.counterpart.kind).toBe('recorded');
      if (view?.counterpart.kind !== 'recorded') throw new Error('no counterpart');
      expect(view.counterpart.counterparts).toContainEqual(
        expect.objectContaining({ statute: BNS, section: '106' }),
      );
    });
  });

  it('picks the version in force on the date and rejects a malformed date', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      const ref = { statute: TEST_ACT, section: '7' };
      expect((await getSection(tx, actor, { ...ref, onDate: '2005-06-01' }))?.version?.text).toBe(
        'Version one.',
      );
      expect((await getSection(tx, actor, { ...ref, onDate: '2010-01-01' }))?.version?.text).toBe(
        'Version two.',
      );
      expect((await getSection(tx, actor, { ...ref, onDate: '1999-12-31' }))?.version).toBeNull();
      expect(await getSection(tx, actor, { statute: TEST_ACT, section: '999' })).toBeNull();
      await expect(getSection(tx, actor, { ...ref, onDate: '01-01-2010' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });
  });
});

describe('listSectionHistory (#1125)', () => {
  it('returns both versions oldest first with their validity ranges', async () => {
    await withTestDb(async (tx) => {
      const history = await listSectionHistory(tx, await member(tx), {
        statute: TEST_ACT,
        section: '7',
      });
      expect(history?.statute).toBe(TEST_ACT);
      expect(history?.heading).toBe('Duty of the keeper');
      expect(
        history?.versions.map((v) => ({ text: v.text, from: v.validFrom, to: v.validTo })),
      ).toEqual([
        { text: 'Version one.', from: '2000-01-01', to: '2010-01-01' },
        { text: 'Version two.', from: '2010-01-01', to: null },
      ]);
    });
  });
});

describe('topAuthoritiesForSection (#1125)', () => {
  it('finds judgments citing either code with the page, masked titles only', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      const j1 = await seedJudgment(tx, {
        title: 'State v. [MASKED]',
        titleMasked: true,
        level: 'supreme_court',
        statute: IPC,
        section: '304a',
        page: 3,
      });
      const j2 = await seedJudgment(tx, {
        title: 'Rao v. Hospital',
        level: 'high_court',
        statute: BNS,
        section: '106',
        page: 2,
      });
      const j3 = await seedJudgment(tx, {
        title: 'Murder case',
        level: 'supreme_court',
        statute: IPC,
        section: '302',
        page: 1,
      });
      const j4 = await seedJudgment(tx, {
        title: 'Unmasked party v. party',
        level: 'supreme_court',
        redactionVersion: 0,
        statute: IPC,
        section: '304a',
        page: 1,
      });
      const ours = new Set([j1, j2, j3, j4]);
      for (const ref of [
        { statute: 'IPC', section: '304A' },
        { statute: BNS, section: '106' },
      ]) {
        const result = await topAuthoritiesForSection(tx, actor, { ...ref, limit: 50 });
        const mine = result.filter((a) => ours.has(a.judgmentId));
        expect(mine.map((a) => [a.judgmentId, a.page])).toEqual([
          [j1, 3],
          [j2, 2],
        ]);
        expect(mine[0]).toMatchObject({
          title: 'State v. [MASKED]',
          titleMasked: true,
          courtLevel: 'supreme_court',
          citedStatute: IPC,
          citedSection: '304a',
          citedByCount: 0,
        });
        // The corpus record link (#1126): the provenance URL, opened at `page`.
        expect(mine[0]?.sourceUrl).toMatch(/^https:\/\/court\.example\/[0-9a-f]+\.pdf$/);
        expect(JSON.stringify(result)).not.toContain('Raw page text');
      }
      expect(
        await topAuthoritiesForSection(tx, actor, { statute: TEST_ACT, section: '7' }),
      ).toEqual([]);
    });
  });
});

describe('searchSections (#1125)', () => {
  it('matches headings and section numbers and validates the query', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      const hits = await searchSections(tx, actor, { query: 'negligence', limit: 50 });
      expect(hits).toContainEqual(
        expect.objectContaining({ statute: IPC, section: '304a', shortName: 'IPC' }),
      );
      const byNumber = await searchSections(tx, actor, { query: 'Section 7', limit: 50 });
      expect(byNumber).toContainEqual(expect.objectContaining({ statute: TEST_ACT, section: '7' }));
      const keeper = await searchSections(tx, actor, { query: 'keeper', limit: 50 });
      expect(keeper.filter((h) => h.statute === TEST_ACT)).toEqual([
        expect.objectContaining({ statute: TEST_ACT, section: '7', heading: 'Duty of the keeper' }),
      ]);
      for (const query of ['   ', 'x'.repeat(STATUTE_QUERY_MAX_CHARS + 1)]) {
        await expect(searchSections(tx, actor, { query })).rejects.toMatchObject({
          code: 'VALIDATION',
        });
      }
    });
  });
});

describe('statutes membership and privacy (#1125)', () => {
  const calls = (tx: Transaction, actor: { workspaceId: string; userId: string }) => [
    () => getSection(tx, actor, { statute: IPC, section: '304a' }),
    () => listSectionHistory(tx, actor, { statute: IPC, section: '304a' }),
    () => searchSections(tx, actor, { query: 'negligence' }),
    () => topAuthoritiesForSection(tx, actor, { statute: IPC, section: '304a' }),
  ];

  it('denies a user who is not a member of the workspace', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const outsider = { workspaceId, userId: await newUser(tx) };
      for (const call of calls(tx, outsider)) {
        await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    });
  });

  it('writes no audit event and logs nothing', async () => {
    const sink = vi.fn(() => Promise.resolve());
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    setAuditSink({ write: sink });
    try {
      await withTestDb(async (tx) => {
        const actor = await member(tx);
        const count = () =>
          withWorkspace(tx, { workspaceId: actor.workspaceId }, async (s) => {
            const [row] = await s
              .select({ n: sql<number>`count(*)::int` })
              .from(schema.auditEvent)
              .where(eq(schema.auditEvent.workspaceId, actor.workspaceId));
            return row?.n ?? 0;
          });
        const before = await count();
        for (const call of calls(tx, actor)) await call();
        expect(await count()).toBe(before);
      });
      expect(sink).not.toHaveBeenCalled();
      for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    } finally {
      setAuditSink(null);
      for (const spy of logs) spy.mockRestore();
    }
    const source = readFileSync(path.join(import.meta.dirname, 'service.ts'), 'utf8');
    expect(source).not.toContain('record(');
    expect(source).not.toContain('@causedeck/observability');
  });
});
