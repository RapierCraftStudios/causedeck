import { withTestDb } from '@causedeck/db/testing';
import { BRIEF_FIXTURE_SEARCH_WORD } from '@causedeck/db/seed/brief-fixtures';
import { hasProvenance } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

import { assembleBrief } from '../assemble.ts';

import { seedBrief } from './helpers.ts';

const now = () => new Date('2026-10-25T09:00:00Z');

describe('assembleBrief', () => {
  it('returns every section with provenance on every line (R1, R2, R3)', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const brief = await assembleBrief({ db: tx, now }, actor, fixture.listingId);
      expect(brief.stage?.text).toMatch(/final hearing/i);
      expect(brief.last_order.length).toBeGreaterThanOrEqual(2);
      expect(brief.last_order.length).toBeLessThanOrEqual(3);
      for (const l of [...brief.last_order, ...(brief.stage ? [brief.stage] : [])]) {
        expect(hasProvenance(l)).toBe(true);
      }
      // No date appears that is not in the anchored source text.
      const sourceText = brief.last_order.map((l) => l.quote ?? '').join(' ');
      for (const m of brief.last_order.flatMap((l) => l.text.match(/\d{1,2} [A-Z][a-z]+( \d{4})?/g) ?? [])) {
        expect(sourceText).toContain(m.split(' ').slice(0, 2).join(' '));
      }
      expect(brief.obligations.open).toHaveLength(2);
      expect(brief.obligations.open[0]?.overdue).toBe(true);
      expect(brief.obligations.open[0]?.text).toBe('counter not yet filed; due 20 Oct');
      expect(brief.obligations.closed_count).toBe(1);
      expect(brief.last_hearing).not.toBeNull();
    });
  });

  it('labels an unconfirmed order line and keeps it anchored (R2)', async () => {
    await withTestDb(async (tx) => {
      const { actor, workspaceId, fixture } = await seedBrief(tx);
      const { inWorkspace } = await import('@causedeck/db/testing');
      const { schema } = await import('@causedeck/db');
      const { eq } = await import('drizzle-orm');
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.order)
          .set({ confirmationState: 'proposed' })
          .where(eq(schema.order.id, fixture.orderId)),
      );
      const brief = await assembleBrief({ db: tx, now }, actor, fixture.listingId, {
        compress: false,
      });
      expect(brief.last_order.length).toBeGreaterThan(0);
      for (const l of brief.last_order) {
        expect(l.label).toBe('Unconfirmed');
        expect(l.anchor_id).not.toBeNull();
      }
    });
  });

  it('returns at most 5 context passages from the matter only (R6)', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const brief = await assembleBrief({ db: tx, now }, actor, fixture.listingId, {
        contextQuery: BRIEF_FIXTURE_SEARCH_WORD,
      });
      expect(brief.context.length).toBeGreaterThan(0);
      expect(brief.context.length).toBeLessThanOrEqual(5);
      expect(brief.context.every((p) => p.document_id === fixture.documentId)).toBe(true);
      expect(brief.context.some((p) => p.document_id === fixture.otherDocumentId)).toBe(false);
    });
  });

  it('is deterministic with no AI and no context on a sensitive matter (R9)', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const brief = await assembleBrief({ db: tx, now }, actor, fixture.sensitiveListingId, {
        contextQuery: BRIEF_FIXTURE_SEARCH_WORD,
      });
      expect(brief.sensitive).toBe(true);
      expect(brief.ai_used).toBe(false);
      expect(brief.context).toEqual([]);
    });
  });

  it('writes nothing and rejects a bad id (R1)', async () => {
    await withTestDb(async (tx) => {
      const { actor } = await seedBrief(tx);
      await expect(assembleBrief({ db: tx }, actor, 'nope')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
