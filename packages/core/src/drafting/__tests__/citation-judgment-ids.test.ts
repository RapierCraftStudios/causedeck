// #1191: a verified draft citation carries the stored judgment's id, found by its source URL, so the
// studio opens it in the in-app reader instead of the provenance URL (often `….tar#member.pdf`).
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { CitationReportSchema } from '@causedeck/validators/citation';
import { describe, expect, it } from 'vitest';

import { judgmentIdsBySourceUrl, reportFromRows, type AuthorityRow } from '../citations.ts';

const VERSION = '00000000-0000-4000-8000-000000000001';

async function seed(tx: Transaction, url: string): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      provenance: {
        url,
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [],
    })
    .returning({ id: schema.judgment.id });
  return row?.id ?? '';
}

function row(id: string, sourceUrl: string | null): AuthorityRow {
  return {
    id,
    workspaceId: '00000000-0000-4000-8000-000000000002',
    draftVersionId: VERSION,
    blockId: 'b1',
    span: [0, 12],
    rawText: '2026:MHC:1',
    normalized: '2026:MHC:1',
    kind: 'neutral',
    resolution: {},
    status: 'verified',
    sourceUrl,
    checkedAt: new Date('2026-01-01T00:00:00Z'),
    ackBy: null,
    ackAt: null,
  };
}

describe('judgmentIdsBySourceUrl', () => {
  it('maps a source URL to its one stored judgment and skips unknown or shared URLs', async () => {
    await withTestDb(async (tx) => {
      const tag = randomUUID();
      const tar = `https://open-data.example/mhc/2026.tar#${tag}.pdf`;
      const shared = `https://open-data.example/mhc/${tag}-shared.pdf`;
      const id = await seed(tx, tar);
      await seed(tx, shared);
      await seed(tx, shared);
      const ids = await judgmentIdsBySourceUrl(tx, [
        tar,
        shared,
        `https://open-data.example/${tag}-none.pdf`,
        null,
      ]);
      expect([...ids]).toEqual([[tar, id]]);
      expect(await judgmentIdsBySourceUrl(tx, [null, ''])).toEqual(new Map());
    });
  });
});

describe('reportFromRows judgment ids', () => {
  it('adds judgmentId only to citations whose source URL is a stored judgment', () => {
    const judgmentId = randomUUID();
    const tar = 'https://open-data.example/mhc/2026.tar#a.pdf';
    const report = reportFromRows(
      VERSION,
      [row('a', tar), row('b', 'https://other.example/b.pdf'), row('c', null)],
      new Map([[tar, judgmentId]]),
    );
    expect(report.items.map((i) => i.judgmentId)).toEqual([judgmentId, undefined, undefined]);
    expect(report.items[1]).not.toHaveProperty('judgmentId');
    expect(CitationReportSchema.safeParse(report).success).toBe(true);
  });
});
