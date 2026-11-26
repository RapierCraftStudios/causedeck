// Corpus coverage (#1174): searchable judgments counted by court and year; a judgment that is not
// redacted, or whose segments are from an older redaction, is not counted. Non-members are refused.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { newUser, newWorkspace } from '../__tests__/fixtures.ts';

import { getCorpusCoverage } from './coverage.ts';

async function seed(
  tx: Transaction,
  v: { court: string; date: string | null; redaction: number; segmented: number },
): Promise<void> {
  const sha256 = randomUUID().replaceAll('-', '');
  await tx.insert(schema.judgment).values({
    sourceId: 'in.test.judgments',
    court: v.court,
    sha256,
    judgmentDate: v.date,
    provenance: {
      url: `https://court.example/${sha256}.pdf`,
      fetchedAt: '2026-10-23T00:00:00.000Z',
      sha256,
      sourceId: 'in.test.judgments',
      sourceVersion: 'v1',
      tierUsed: 'http',
      costDollars: 0,
    },
    pageText: [{ pageNo: 1, text: 'Raw.' }],
    redactedText: v.redaction > 0 ? [{ pageNo: 1, text: 'Redacted.' }] : null,
    redactionVersion: v.redaction,
    segmentVersion: v.segmented > 0 ? 1 : 0,
    segmentedRedactionVersion: v.segmented,
    courtLevel: 'high_court',
  });
}

describe('getCorpusCoverage', () => {
  it('counts searchable judgments by court and year range and skips unredacted ones', async () => {
    await withTestDb(async (tx) => {
      // Court codes unique to this test, so judgments other tests left in the corpus do not count.
      const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z]/g, 'Q');
      const a = `ZA${tag}`;
      const b = `ZB${tag}`;
      await seed(tx, { court: a, date: '2015-02-01', redaction: 1, segmented: 1 });
      await seed(tx, { court: a, date: '2021-06-30', redaction: 2, segmented: 2 });
      await seed(tx, { court: a, date: '2024-01-01', redaction: 0, segmented: 0 });
      await seed(tx, { court: a, date: '2025-01-01', redaction: 2, segmented: 1 });
      await seed(tx, { court: b, date: null, redaction: 1, segmented: 1 });
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const coverage = await getCorpusCoverage(tx, { workspaceId, userId: ownerId });
      const byCourt = new Map(coverage.courts.map((c) => [c.court, c]));
      expect(byCourt.get(a)).toEqual({
        court: a,
        courtLevel: 'high_court',
        judgments: 2,
        yearFrom: 2015,
        yearTo: 2021,
      });
      expect(byCourt.get(b)).toMatchObject({ judgments: 1, yearFrom: null, yearTo: null });
      expect(coverage.judgments).toBe(coverage.courts.reduce((n, c) => n + c.judgments, 0));
      expect(coverage.judgments).toBeGreaterThanOrEqual(3);
      expect(coverage.yearFrom).not.toBeNull();
      expect(coverage.yearFrom ?? 0).toBeLessThanOrEqual(2015);
    });
  });

  it('refuses a non-member', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const stranger = await newUser(tx);
      await expect(
        getCorpusCoverage(tx, { workspaceId, userId: stranger }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
