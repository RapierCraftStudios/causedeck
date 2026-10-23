import type { Queryable } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import { verifyCitation } from './verify.ts';

const row = (citation: string) => ({
  id: 'j1',
  court: citation.includes('KHC') ? 'KHC' : 'MHC',
  judgmentDate: '2026-10-21',
  provenance: { url: 'https://court.example/j.pdf' },
  pageText: [
    { pageNo: 1, text: 'IN THE HIGH COURT\nDATED: 21.10.2026' },
    { pageNo: 2, text: `body\n${citation}\nmore` },
  ],
});

const dbWith = (rows: unknown[]) =>
  ({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
  }) as unknown as Queryable;

describe('verifyCitation', () => {
  it('verifies Madras and Karnataka forms with page anchors', async () => {
    const madras = await verifyCitation('2026/MHC/1234', { db: dbWith([row('2026:MHC:1234')]) });
    expect(madras).toMatchObject({
      status: 'VERIFIED',
      citation: '2026:MHC:1234',
      judgmentId: 'j1',
      anchors: [{ pageNo: 2, quote: '2026:MHC:1234' }],
    });
    const khc = await verifyCitation('2026:KHC-D:567', { db: dbWith([row('2026:KHC-D:567')]) });
    expect(khc).toMatchObject({ status: 'VERIFIED', court: 'KHC' });
  });

  it('marks a citation not in the corpus or unreadable as UNVERIFIED', async () => {
    expect(await verifyCitation('2026:MHC:9', { db: dbWith([]) })).toEqual({
      status: 'UNVERIFIED',
      citation: '2026:MHC:9',
      reason: 'not_in_corpus',
    });
    expect(await verifyCitation('see above', { db: dbWith([row('x')]) })).toEqual({
      status: 'UNVERIFIED',
      citation: null,
      reason: 'unreadable',
    });
  });
});
