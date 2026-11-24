// The judgment reader (#1174, D-053): redacted pages only (a sentinel party name in `page_text` never
// leaks), the paragraph and page anchors, the stored masked title, attribution from the provenance,
// the page-pending flag of plain-text pages, and null for a missing or not yet redacted judgment.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { newUser, newWorkspace } from '../__tests__/fixtures.ts';

import { getJudgmentForReader } from './reader.ts';

const SENTINEL = 'Zorblax Industries';

async function seed(
  tx: Transaction,
  v: {
    redacted?: { pageNo: number; text: string; source?: 'text' | 'ocr' }[] | null;
    title?: string;
    titleMasked?: boolean;
    bench?: string[];
    licence?: string;
  } = {},
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const redacted =
    v.redacted === undefined
      ? [
          { pageNo: 1, text: 'JUDGMENT\n\n1. [PARTY] filed the petition.\n\n2. The facts are these.' },
          { pageNo: 2, text: '3. The court considered the bail plea.\n\n4. Bail is granted.' },
        ]
      : v.redacted;
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      neutralCitation: `2024:MHC:${sha256.slice(0, 5)}`,
      judgmentDate: '2024-03-04',
      bench: v.bench ?? [],
      provenance: {
        url: `https://court.example/${sha256}.pdf`,
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
        ...(v.licence === undefined ? {} : { licence: v.licence }),
      },
      pageText: [
        { pageNo: 1, text: `JUDGMENT\n\n1. ${SENTINEL} filed the petition.\n\n2. The facts are these.` },
        { pageNo: 2, text: `3. ${SENTINEL} pleaded for bail.\n\n4. Bail is granted.` },
      ],
      redactedText: redacted,
      redactionVersion: redacted === null ? 0 : 1,
      caseTitle: v.title ?? 'State v. Ravi',
      titleMasked: v.titleMasked ?? false,
      courtLevel: 'high_court',
    })
    .returning({ id: schema.judgment.id });
  return row?.id ?? '';
}

describe('getJudgmentForReader', () => {
  it('serves the redacted pages with a paragraph anchor, attribution and bench strength', async () => {
    await withTestDb(async (tx) => {
      const judgmentId = await seed(tx, {
        bench: ['A. Judge', 'B. Judge'],
        licence: 'CC-BY-4.0',
      });
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      const view = await getJudgmentForReader(tx, actor, { judgmentId, para: 3 });
      expect(view?.pages.map((p) => [p.pageNo, p.pinpoint])).toEqual([
        [1, 'verified'],
        [2, 'verified'],
      ]);
      expect(view?.anchor).toEqual({ page: 2, para: 3, offset: 0, pinpoint: 'verified' });
      const para2 = await getJudgmentForReader(tx, actor, { judgmentId, para: 2 });
      const page1 = para2?.pages[0]?.text ?? '';
      expect(para2?.anchor).toMatchObject({ page: 1, para: 2 });
      expect(page1.slice(para2?.anchor?.offset ?? 0)).toMatch(/^2\. The facts/);
      expect(view?.attribution.sourceUrl).toMatch(/^https:\/\/court\.example\//);
      expect(view?.attribution.licence).toBe('CC-BY-4.0');
      expect(view?.benchStrength).toBe(2);
      expect(view?.title).toBe('State v. Ravi');
      expect(JSON.stringify(view)).not.toContain(SENTINEL);
      // A paragraph that is not there falls back to the page; neither gives no anchor.
      const byPage = await getJudgmentForReader(tx, actor, { judgmentId, para: 99, page: 2 });
      expect(byPage?.anchor).toEqual({ page: 2, para: null, offset: 0, pinpoint: 'verified' });
      expect((await getJudgmentForReader(tx, actor, { judgmentId }))?.anchor).toBeNull();
    });
  });

  it('keeps a masked title masked and flags plain-text pages page_pending', async () => {
    await withTestDb(async (tx) => {
      const judgmentId = await seed(tx, {
        title: 'X v. State',
        titleMasked: true,
        redacted: [{ pageNo: 1, text: '1. [PARTY] appeals.', source: 'text' }],
      });
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const view = await getJudgmentForReader(
        tx,
        { workspaceId, userId: ownerId },
        { judgmentId, page: 1 },
      );
      expect(view).toMatchObject({ title: 'X v. State', titleMasked: true, benchStrength: null });
      expect(view?.attribution.licence).toBeNull();
      expect(view?.anchor).toEqual({ page: 1, para: null, offset: 0, pinpoint: 'page_pending' });
    });
  });

  it('returns null for a missing or unredacted judgment and refuses non-members', async () => {
    await withTestDb(async (tx) => {
      const unredacted = await seed(tx, { redacted: null });
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      expect(await getJudgmentForReader(tx, actor, { judgmentId: unredacted })).toBeNull();
      expect(await getJudgmentForReader(tx, actor, { judgmentId: randomUUID() })).toBeNull();
      expect(await getJudgmentForReader(tx, actor, { judgmentId: 'nope' })).toBeNull();
      await expect(
        getJudgmentForReader(tx, actor, { judgmentId: unredacted, para: 0 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      const stranger = await newUser(tx);
      await expect(
        getJudgmentForReader(tx, { workspaceId, userId: stranger }, { judgmentId: unredacted }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
