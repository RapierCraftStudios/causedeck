import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { closeEnquiry, listEnquiries, logEnquiry } from '../enquiry.ts';
import { retentionCutoff, sweepClosedEnquiries } from '../retention.ts';
import { chamber, deps, ENQUIRY } from './helpers.ts';

describe('enquiry retention (#87)', () => {
  it('computes the cutoff in calendar months', () => {
    expect(retentionCutoff(new Date('2026-11-02T10:00:00Z'), 12).toISOString()).toBe(
      '2025-11-02T10:00:00.000Z',
    );
  });

  it('deletes closed enquiries past the workspace retention and keeps the rest', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const closedAt = new Date('2025-10-01T00:00:00Z');
      const old = await logEnquiry(deps(tx), c.owner, ENQUIRY);
      const recent = await logEnquiry(deps(tx), c.owner, ENQUIRY);
      const open = await logEnquiry(deps(tx), c.owner, ENQUIRY);
      await closeEnquiry(deps(tx, { now: () => closedAt }), c.owner, { enquiryId: old.id });
      await closeEnquiry(deps(tx, { now: () => new Date('2026-10-01T00:00:00Z') }), c.owner, {
        enquiryId: recent.id,
      });
      const now = new Date('2026-11-02T00:00:00Z');
      expect(await sweepClosedEnquiries({ db: tx, now: () => now }, c.workspaceId)).toEqual({
        deleted: 1,
      });
      const left = (await listEnquiries(deps(tx), c.owner)).map((e) => e.id).sort();
      expect(left).toEqual([recent.id, open.id].sort());
      const parties = await inWorkspace(tx, c.workspaceId, (s) =>
        s.select().from(schema.enquiryParty).where(eq(schema.enquiryParty.enquiryId, old.id)),
      );
      expect(parties).toEqual([]);
      // A shorter setting sweeps the recent one too.
      await inWorkspace(tx, c.workspaceId, (s) =>
        s
          .update(schema.workspaceSettings)
          .set({ enquiryRetentionMonths: 1 })
          .where(eq(schema.workspaceSettings.workspaceId, c.workspaceId)),
      );
      expect(await sweepClosedEnquiries({ db: tx, now: () => now }, c.workspaceId)).toEqual({
        deleted: 1,
      });
    });
  });
});
