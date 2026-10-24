// Anchored order extraction (#46) against the real test database: the validated extraction and its
// rejections are stored, re-extraction supersedes without deleting, the capture goes to "Needs you"
// when a person must look, and a capture that may not reach AI never touches the gateway.
import type { AiGateway } from '@causedeck/ai';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { runOrderExtraction } from '../index.ts';

const NOW = new Date('2026-10-19T10:00:00Z');
type Tx = Parameters<typeof newWorkspace>[0];

const PAGE = [
  "BEFORE: THE HON'BLE MR. JUSTICE A. SAMPLE",
  'W.P. No. 1234/2025',
  'Dated: 05.01.2026',
  'ORDER',
  'Post on 12.03.2026 for hearing.',
].join('\n');

async function seed(tx: Tx, options: { aiBlocked?: boolean; text?: string } = {}) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  return inWorkspace(tx, workspaceId, async (s) => {
    const [cap] = await s
      .insert(schema.capture)
      .values({
        workspaceId,
        channel: 'upload',
        mime: 'application/pdf',
        sizeBytes: 8,
        originalFilename: 'order.pdf',
        createdBy: ownerId,
        status: 'ready',
        aiBlocked: options.aiBlocked === true,
      })
      .returning();
    const id = crypto.randomUUID();
    const [doc] = await s
      .insert(schema.document)
      .values({
        id,
        workspaceId,
        kind: 'order',
        storageKey: `ws/${workspaceId}/document/${id}`,
        sha256: 'a'.repeat(64),
        textStatus: 'layer',
        sourceCaptureId: cap?.id ?? null,
      })
      .returning();
    await s.insert(schema.documentPage).values({
      workspaceId,
      documentId: id,
      pageNo: 1,
      text: options.text ?? PAGE,
      textSource: 'layer',
    });
    return { workspaceId, ownerId, captureId: cap?.id ?? '', documentId: doc?.id ?? '' };
  });
}

const gatewayWith = (output: unknown) => {
  const run = vi.fn(() => Promise.resolve({ output, callId: crypto.randomUUID() }));
  return { gateway: { run } as unknown as AiGateway, run };
};

const model = {
  bench: [],
  orderDate: null,
  caseNumbers: [],
  neutralCitation: null,
  orderType: 'interim',
  directions: [],
  nextDate: {
    date: '2026-03-12',
    phrase: 'Post on 12.03.2026',
    page: 1,
    quote: 'Post on 12.03.2026 for hearing.',
  },
  stageCues: [],
  confidence: 0.9,
};

describe('runOrderExtraction', () => {
  it('stores the extraction with anchors, and is idempotent per document and version', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const g = gatewayWith(model);
      const payload = { workspaceId: s.workspaceId, documentId: s.documentId };
      const first = await runOrderExtraction(
        { db: tx, gateway: g.gateway, now: () => NOW },
        payload,
      );
      expect(first).toMatchObject({ outcome: 'extracted', deterministicOnly: false });
      const again = await runOrderExtraction(
        { db: tx, gateway: g.gateway, now: () => NOW },
        payload,
      );
      expect(again).toEqual({ outcome: 'exists' });
      expect(g.run).toHaveBeenCalledTimes(1);
      const rows = await inWorkspace(tx, s.workspaceId, (q) => q.select().from(schema.extraction));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'current',
        documentId: s.documentId,
        ambiguous: false,
      });
      const anchors = await inWorkspace(tx, s.workspaceId, (q) => q.select().from(schema.anchor));
      expect(anchors.length).toBeGreaterThan(0);
      expect(anchors.every((a) => a.documentId === s.documentId && a.quote.length > 0)).toBe(true);
    });
  });

  it('supersedes the current extraction on re-extraction and never deletes it', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const g = gatewayWith(model);
      const deps = { db: tx, gateway: g.gateway, now: () => NOW };
      const payload = { workspaceId: s.workspaceId, documentId: s.documentId };
      await runOrderExtraction(deps, payload);
      await runOrderExtraction(deps, { ...payload, reextract: true });
      const rows = await inWorkspace(tx, s.workspaceId, (q) =>
        q.select().from(schema.extraction).where(eq(schema.extraction.documentId, s.documentId)),
      );
      expect(rows.map((r) => r.status).sort()).toEqual(['current', 'superseded']);
      expect(rows.find((r) => r.status === 'superseded')?.supersededAt).not.toBeNull();
    });
  });

  it('skips the gateway for an ai_blocked capture: pre-parse only, no ai_call', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx, { aiBlocked: true });
      const g = gatewayWith(model);
      const out = await runOrderExtraction(
        { db: tx, gateway: g.gateway, now: () => NOW },
        { workspaceId: s.workspaceId, documentId: s.documentId },
      );
      expect(g.run).not.toHaveBeenCalled();
      expect(out).toMatchObject({ outcome: 'extracted', deterministicOnly: true });
      const [row] = await inWorkspace(tx, s.workspaceId, (q) => q.select().from(schema.extraction));
      expect(row).toMatchObject({ deterministicOnly: true, aiCallId: null });
      expect((row?.result as { confidence: number }).confidence).toBeLessThanOrEqual(0.6);
      const calls = await inWorkspace(tx, s.workspaceId, (q) => q.select().from(schema.aiCall));
      expect(calls).toHaveLength(0);
    });
  });

  it('routes a capture with several next dates to needs_you, keeping the candidates', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx, { text: `${PAGE}\nPost on 20.04.2026 for final hearing.` });
      const out = await runOrderExtraction(
        { db: tx, gateway: gatewayWith(model).gateway, now: () => NOW },
        { workspaceId: s.workspaceId, documentId: s.documentId },
      );
      if (out.outcome !== 'extracted') throw new Error(`unexpected outcome ${out.outcome}`);
      expect(out.needsYou).toContain('extraction_ambiguous');
      const [cap] = await inWorkspace(tx, s.workspaceId, (q) =>
        q
          .select()
          .from(schema.capture)
          .where(
            and(eq(schema.capture.id, s.captureId), eq(schema.capture.workspaceId, s.workspaceId)),
          ),
      );
      expect(cap?.status).toBe('needs_you');
      expect(cap?.sourceMeta).toMatchObject({ needsYouReason: 'extraction_ambiguous' });
      const [row] = await inWorkspace(tx, s.workspaceId, (q) => q.select().from(schema.extraction));
      expect(row?.ambiguous).toBe(true);
    });
  });

  it('skips a document that is not an order', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      await inWorkspace(tx, s.workspaceId, (q) =>
        q
          .update(schema.document)
          .set({ kind: 'pleading' })
          .where(eq(schema.document.id, s.documentId)),
      );
      const out = await runOrderExtraction(
        { db: tx, now: () => NOW },
        { workspaceId: s.workspaceId, documentId: s.documentId },
      );
      expect(out).toEqual({ outcome: 'skipped', reason: 'not_an_order' });
    });
  });
});
