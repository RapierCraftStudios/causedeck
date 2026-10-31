// Applying a mask request (#892): title and text masked, `handled_at` recorded, the action audited,
// the staff gate, and the raw text and sha256 left as they were.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withUser, type Database } from '@causedeck/db';
import { closeTestDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMaskRequest, MaskRequestError } from './masking.ts';

let owner: Database;
let opsId: string;
let supportId: string;

async function seedStaff(role: 'ops' | 'support'): Promise<string> {
  const id = randomUUID();
  await owner.insert(schema.user).values({ id, name: role, email: `${role}-${id}@causedeck.test` });
  await owner.insert(schema.staffUser).values({ userId: id, role });
  return id;
}

beforeAll(async () => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  opsId = await seedStaff('ops');
  supportId = await seedStaff('support');
});

afterAll(async () => {
  for (const id of [opsId, supportId])
    await owner.delete(schema.user).where(eq(schema.user.id, id));
  await owner.$client.end();
  await closeTestDb();
});

const PAGES = [
  {
    pageNo: 1,
    text: 'BETWEEN:\nRamesh Kumar ... APPELLANT\nAND:\nSuresh Babu ... RESPONDENT',
  },
  { pageNo: 2, text: 'Ramesh Kumar met Neha Sharma at the market.' },
];

async function seed(tx: never): Promise<{ judgmentId: string; requestId: string; sha256: string }> {
  const db = tx as Database;
  const sha256 = randomUUID().replaceAll('-', '');
  const [j] = await db
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      provenance: {
        url: 'https://mhc.example/j/m.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: PAGES,
      redactedText: PAGES,
      caseTitle: 'Ramesh Kumar v. Suresh Babu',
    })
    .returning({ id: schema.judgment.id });
  const [r] = await db
    .insert(schema.corpusMaskRequest)
    .values({
      judgmentId: j?.id ?? '',
      requestedBy: 'Registrar, High Court',
      requestedAction: 'mask title and text',
      names: ['Neha Sharma'],
      legalBasis: 'Order dated 1.10.2026',
    })
    .returning({ id: schema.corpusMaskRequest.id });
  return { judgmentId: j?.id ?? '', requestId: r?.id ?? '', sha256 };
}

describe('applyMaskRequest', () => {
  it('masks the title and text, records handled_at and audits', async () => {
    await withTestDb(async (tx) => {
      const { judgmentId, requestId, sha256 } = await seed(tx as never);
      const out = await applyMaskRequest(tx, { userId: opsId }, requestId);
      expect(out.maskReason).toBe(`mask_request:${requestId}`);

      const [j] = await tx.select().from(schema.judgment).where(eq(schema.judgment.id, judgmentId));
      expect(j?.titleMasked).toBe(true);
      expect(j?.caseTitle ?? '').not.toMatch(/Ramesh|Suresh/);
      const text = (j?.redactedText ?? []).map((p) => p.text).join('\n');
      expect(text).not.toMatch(/Ramesh|Suresh|Neha|Sharma/);
      expect(j?.maskReason).toBe(`mask_request:${requestId}`);
      // P4: the raw text and the hash are untouched.
      expect(j?.pageText).toEqual(PAGES);
      expect(j?.sha256).toBe(sha256);

      const [req] = await tx
        .select()
        .from(schema.corpusMaskRequest)
        .where(eq(schema.corpusMaskRequest.id, requestId));
      expect(req?.status).toBe('applied');
      expect(req?.handledAt).toBeInstanceOf(Date);

      const events = await withUser(tx, { userId: opsId }, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.action, 'corpus.mask_applied')),
      );
      expect(events.filter((e) => e.targetId === judgmentId)).toHaveLength(1);
    });
  });

  it("drops the judgment's segments and marks it for re-segmentation (#893)", async () => {
    await withTestDb(async (tx) => {
      const { judgmentId, requestId } = await seed(tx as never);
      await tx
        .update(schema.judgment)
        .set({ segmentVersion: 1 })
        .where(eq(schema.judgment.id, judgmentId));
      await tx.insert(schema.judgmentSegment).values({
        judgmentId,
        ordinal: 1,
        role: 'facts',
        pageFrom: 1,
        pageTo: 1,
        text: 'Ramesh Kumar met Neha Sharma at the market.',
        court: 'MHC',
        courtLevel: 'high_court',
        judgmentYear: 2026,
      });
      await applyMaskRequest(tx, { userId: opsId }, requestId);

      const left = await tx
        .select({ id: schema.judgmentSegment.id })
        .from(schema.judgmentSegment)
        .where(eq(schema.judgmentSegment.judgmentId, judgmentId));
      expect(left).toEqual([]);
      const [j] = await tx.select().from(schema.judgment).where(eq(schema.judgment.id, judgmentId));
      expect(j?.segmentVersion).toBe(0);
    });
  });

  it('refuses non-ops staff and a request already handled', async () => {
    await withTestDb(async (tx) => {
      const { requestId } = await seed(tx as never);
      await expect(applyMaskRequest(tx, { userId: supportId }, requestId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await applyMaskRequest(tx, { userId: opsId }, requestId);
      await expect(applyMaskRequest(tx, { userId: opsId }, requestId)).rejects.toBeInstanceOf(
        MaskRequestError,
      );
    });
  });
});
