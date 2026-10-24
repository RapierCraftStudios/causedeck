// Portfolio services (#663): the CSV reader and writer; an import of 1,000 CNRs creates 1,000 cases
// and watches within the per-advocate cap, staggered and without a fetch; refusals for non-owners,
// uncleared sources and bare CNRs; dashboard filters; formula-safe export.
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import {
  buildForum,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';

import { parsePortfolioCsv, toCsv } from './csv.ts';
import {
  createPortfolio,
  exportPortfolioCsv,
  importPortfolioCases,
  listPortfolioCases,
  listPortfolios,
  MAX_PORTFOLIO_WATCHES_PER_ADVOCATE,
  portfolioSummary,
} from './index.ts';

const SOURCE = 'in.tn.chennai-district:case_status';
const NOW = new Date('2026-11-01T00:00:00Z');

/** A valid fictional CNR: 4 letters, 12 digits. */
const cnrOf = (n: number) => `TNCH${String(n).padStart(12, '0')}`;

describe('portfolio CSV', () => {
  it('reads quoted fields, BOM and CRLF, and reports bad and repeated rows', () => {
    const parsed = parsePortfolioCsv(
      `\uFEFFCNR,Case Number,source\r\n${cnrOf(1)},"WP, 1/2026",\r\ntncn000000000002,,s1\n,,\nBAD,,\n${cnrOf(1)},,\n`,
    );
    expect(parsed.rows.map((r) => [r.cnr, r.caseNumber, r.sourceId])).toEqual([
      [cnrOf(1), 'WP, 1/2026', null],
      ['TNCN000000000002', null, 's1'],
    ]);
    expect(parsed.errors.map((e) => e.line)).toEqual([4, 5, 6]);
  });

  it('refuses more than 1,000 rows, an empty file and a missing header', () => {
    const rows = Array.from({ length: 1001 }, (_, i) => cnrOf(i)).join('\n');
    expect(() => parsePortfolioCsv(`cnr\n${rows}`)).toThrow(/at most 1000/);
    expect(() => parsePortfolioCsv('')).toThrow(/empty/);
    expect(() => parsePortfolioCsv('name\nx')).toThrow(/cnr or case_number/);
    expect(() => parsePortfolioCsv('cnr\n"open')).toThrow(/quote/);
  });

  it('writes quoted cells and neutralises formulas', () => {
    expect(toCsv([['a,b', '=SUM(A1)', 'say "hi"', null]])).toBe(
      `"a,b",'=SUM(A1),"say ""hi""",\r\n`,
    );
  });
});

interface World {
  tx: Transaction;
  workspaceId: string;
  owner: { userId: string; workspaceId: string };
  portfolioId: string;
  panel: string[];
  forumId: string;
}

async function world(tx: Transaction, advocates = 1, cleared = true): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const owner = { userId: ownerId, workspaceId };
  const forumId = (await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId))).id;
  const state = cleared
    ? { clearedAt: NOW, termsStatus: 'cleared' as const, counselStatus: 'cleared' as const }
    : { clearedAt: null };
  await tx
    .insert(schema.source)
    .values({
      id: SOURCE,
      kind: 'court',
      baseUrl: 'https://xt.example.test',
      owner: 'xt',
      ...state,
    })
    .onConflictDoUpdate({ target: schema.source.id, set: state });
  const panel: string[] = [];
  for (let i = 0; i < advocates; i += 1) panel.push(await addMember(tx, workspaceId, 'advocate'));
  const portfolioId = await withWorkspace(tx, owner, async (s) => {
    const [p] = await s
      .insert(schema.portfolio)
      .values({ workspaceId, name: 'Recovery book', createdBy: ownerId })
      .returning({ id: schema.portfolio.id });
    const id = p?.id ?? '';
    await s
      .insert(schema.portfolioPanelAdvocate)
      .values(panel.map((advocateUserId) => ({ workspaceId, portfolioId: id, advocateUserId })));
    return id;
  });
  return { tx, workspaceId, owner, portfolioId, panel, forumId };
}

async function proceedings(w: World, count: number, from = 0): Promise<void> {
  await inWorkspace(w.tx, w.workspaceId, async (s) => {
    for (let i = from; i < from + count; i += 1) {
      const m = await buildMatter(s, w.workspaceId);
      await buildProceeding(s, w.workspaceId, {
        matterId: m.id,
        forumId: w.forumId,
        number: String(i + 1),
        year: 2026,
        cnr: cnrOf(i),
      });
    }
  });
}

const csvOf = (n: number, from = 0) =>
  `cnr\n${Array.from({ length: n }, (_, i) => cnrOf(from + i)).join('\n')}\n`;

describe('importPortfolioCases', () => {
  it('imports 1,000 CNRs: 1,000 cases and watches within the cap, staggered, no fetch', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, 5);
      await proceedings(w, 1000);
      const report = await importPortfolioCases({ db: tx, now: () => NOW }, w.owner, {
        portfolioId: w.portfolioId,
        csv: csvOf(1000),
        sourceId: SOURCE,
      });
      expect(report).toMatchObject({ created: 1000, watched: 1000, unwatched: 0, invalid: 0 });
      const watches = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.caseWatch),
      );
      expect(watches).toHaveLength(1000);
      const perAdvocate = new Map<string, number>();
      for (const x of watches)
        perAdvocate.set(x.advocateUserId, (perAdvocate.get(x.advocateUserId) ?? 0) + 1);
      expect([...perAdvocate.keys()].sort()).toEqual([...w.panel].sort());
      for (const n of perAdvocate.values())
        expect(n).toBeLessThanOrEqual(MAX_PORTFOLIO_WATCHES_PER_ADVOCATE);
      const due = watches.map((x) => x.lastPolledAt?.getTime() ?? 0);
      expect(Math.min(...due)).toBeLessThanOrEqual(NOW.getTime() - 1440 * 60_000 + 60_000);
      expect(Math.max(...due)).toBeLessThan(NOW.getTime());
      expect(new Set(due).size).toBeGreaterThan(500);
      // The same file again is all duplicates and adds nothing.
      const again = await importPortfolioCases({ db: tx, now: () => NOW }, w.owner, {
        portfolioId: w.portfolioId,
        csv: csvOf(1000),
        sourceId: SOURCE,
      });
      expect(again).toMatchObject({ created: 0, duplicates: 1000, watched: 0 });
    });
  }, 300_000);

  it('keeps bare CNRs and case numbers as unwatched cases, and stops at the advocate cap', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, 1);
      await proceedings(w, 2);
      const csv = `cnr,case_number\n${cnrOf(0)},\n${cnrOf(1)},\n${cnrOf(900)},\n,WP 5/2026\nBAD,\n`;
      const report = await importPortfolioCases({ db: tx, now: () => NOW }, w.owner, {
        portfolioId: w.portfolioId,
        csv,
        sourceId: SOURCE,
      });
      expect(report).toMatchObject({ created: 4, watched: 2, unwatched: 2, invalid: 1 });
      expect(report.errors).toEqual([{ line: 6, message: 'Not a valid CNR' }]);
      const cases = await listPortfolioCases({ db: tx }, w.owner, { portfolioId: w.portfolioId });
      expect(cases.filter((c) => c.proceedingId !== null)).toHaveLength(2);
    });
  });

  it('creates no watch at an uncleared source or without a panel, and refuses non-owners', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, 1, false);
      await proceedings(w, 1);
      const input = { portfolioId: w.portfolioId, csv: csvOf(1), sourceId: SOURCE };
      const report = await importPortfolioCases({ db: tx, now: () => NOW }, w.owner, input);
      expect(report).toMatchObject({ created: 1, watched: 0, unwatched: 1 });
      expect(
        await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.caseWatch)),
      ).toEqual([]);
      const member = await addMember(tx, w.workspaceId, 'advocate');
      await expect(
        importPortfolioCases({ db: tx }, { userId: member, workspaceId: w.workspaceId }, input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        importPortfolioCases({ db: tx }, w.owner, { ...input, sourceId: 'no.such:source' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});

describe('dashboard and export', () => {
  it('filters by stage, next date and adverse order, summarises and exports safely', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, 1);
      await importPortfolioCases({ db: tx, now: () => NOW }, w.owner, {
        portfolioId: w.portfolioId,
        csv: `cnr,case_number\n${cnrOf(1)},\n${cnrOf(2)},\n${cnrOf(3)},\n,=cmd|calc\n`,
      });
      const set = async (cnr: string, v: Partial<typeof schema.portfolioCase.$inferInsert>) =>
        inWorkspace(tx, w.workspaceId, (s) =>
          s.update(schema.portfolioCase).set(v).where(eq(schema.portfolioCase.cnr, cnr)),
        );
      await set(cnrOf(1), { status: 'Arguments', nextDate: '2026-11-03' });
      await set(cnrOf(2), {
        status: 'Orders',
        nextDate: '2026-10-01',
        lastAdverseOrderAt: NOW,
        lastAdverseOrderRef: 'Order 7',
      });
      await set(cnrOf(3), { status: 'Arguments', nextDate: '2026-12-25' });
      const input = { portfolioId: w.portfolioId };
      const list = await listPortfolioCases({ db: tx }, w.owner, input);
      expect(list.map((c) => c.cnr)).toEqual([cnrOf(2), cnrOf(1), cnrOf(3), null]);
      const ids = async (f: object) =>
        (await listPortfolioCases({ db: tx }, w.owner, { ...input, ...f })).map((c) => c.cnr);
      expect(await ids({ stage: 'Arguments' })).toEqual([cnrOf(1), cnrOf(3)]);
      expect(await ids({ nextFrom: '2026-11-01', nextTo: '2026-11-30' })).toEqual([cnrOf(1)]);
      expect(await ids({ adverseOnly: true })).toEqual([cnrOf(2)]);
      expect(await ids({ limit: 1, offset: 1 })).toEqual([cnrOf(1)]);
      await expect(
        listPortfolioCases({ db: tx }, w.owner, { ...input, nextFrom: 'x' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      const summary = await portfolioSummary({ db: tx, now: () => NOW }, w.owner, input);
      expect(summary).toMatchObject({ total: 4, withAdverseOrder: 1, upcoming: 1, overdue: 1 });
      expect(summary.byStage).toContainEqual({ stage: 'Arguments', count: 2 });
      const csv = await exportPortfolioCsv({ db: tx }, w.owner, input);
      const lines = csv.trim().split('\r\n');
      expect(lines[0]).toBe(
        'cnr,case_number,source,stage,next_date,last_adverse_order_at,last_adverse_order_ref,status_checked_at',
      );
      expect(lines).toHaveLength(5);
      expect(lines[1]).toContain('Order 7');
      expect(lines[4]).toContain(",'=cmd|calc,");
    });
  });
});

describe('listPortfolios and createPortfolio (#666)', () => {
  it('lets an owner create a portfolio that every member lists, and refuses a repeat name', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const owner = { userId: ownerId, workspaceId };
      const clerk = { userId: await addMember(tx, workspaceId, 'clerk'), workspaceId };
      const made = await createPortfolio({ db: tx }, owner, { name: '  Recovery book  ' });
      expect(made.name).toBe('Recovery book');
      expect((await listPortfolios({ db: tx }, clerk)).map((p) => p.id)).toEqual([made.id]);
      await expect(createPortfolio({ db: tx }, owner, { name: 'Recovery book' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  it('refuses a non-owner, a blank name and a stranger', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const owner = { userId: ownerId, workspaceId };
      const advocate = { userId: await addMember(tx, workspaceId, 'advocate'), workspaceId };
      await expect(createPortfolio({ db: tx }, advocate, { name: 'X' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(createPortfolio({ db: tx }, owner, { name: '   ' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      const other = await newWorkspace(tx);
      await expect(
        listPortfolios({ db: tx }, { userId: other.ownerId, workspaceId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
