// Segment embeddings (#895): only the four roles are embedded, the same model version is a no-op, a new
// version re-embeds, a run stops at its budget and the next resumes, and a retried batch rewrites the
// same rows. In-memory store and the mock embedder; the drizzle store runs in the core job test.
import { createEmbedGateway, createMockEmbedProvider } from '@causedeck/ai';
import { describe, expect, it, vi } from 'vitest';

import {
  EMBEDDED_ROLES,
  embedDueSegments,
  type SegmentEmbedder,
  type SegmentEmbedStore,
} from './embed.ts';

interface Row {
  id: string;
  role: string;
  judgmentYear: number;
  text: string;
  embedding: number[] | null;
  model: string | null;
}

function memoryStore(rows: Row[]): SegmentEmbedStore {
  return {
    due: (roles, version, limit) =>
      Promise.resolve(
        rows
          .filter((r) => roles.includes(r.role) && (r.embedding === null || r.model !== version))
          .slice(0, limit)
          .map(({ id, judgmentYear, text }) => ({ id, judgmentYear, text })),
      ),
    save: (saved, version) => {
      for (const s of saved) {
        const row = rows.find((r) => r.id === s.id);
        if (row) Object.assign(row, { embedding: s.embedding, model: version });
      }
      return Promise.resolve();
    },
  };
}

const ROLES = ['header', 'facts', 'issues', 'arguments', 'reasoning', 'decision', 'other'];
const fresh = (): Row[] =>
  ROLES.flatMap((role, i) =>
    [0, 1].map((n) => ({
      id: `${role}-${String(n)}`,
      role,
      judgmentYear: 2015 + i,
      text: `text of ${role} ${String(n)}`,
      embedding: null,
      model: null,
    })),
  );

function embedderFor(version = '1', pricePaise = 0) {
  const gateway = createEmbedGateway({ providers: [createMockEmbedProvider({ version })] });
  const embed = vi.fn(async (texts: readonly string[]) => {
    const r = await gateway.embed(texts);
    return { vectors: r.vectors, costPaise: pricePaise * texts.length };
  });
  const embedder: SegmentEmbedder = {
    modelVersion: () => gateway.active().modelVersion,
    embed,
  };
  return { embedder, embed };
}

describe('embedDueSegments', () => {
  it('embeds only facts, issues, reasoning and decision segments', async () => {
    const rows = fresh();
    const { embedder } = embedderFor();
    const report = await embedDueSegments(memoryStore(rows), embedder, { budgetPaise: 1e9 });
    expect(report).toMatchObject({ embedded: 8, remaining: false, budgetStopped: false });
    for (const r of rows) {
      expect(r.embedding !== null).toBe((EMBEDDED_ROLES as readonly string[]).includes(r.role));
    }
    expect(rows.find((r) => r.role === 'facts')?.model).toBe('mock-embed@1');
  });

  it('is a no-op for the same model version and re-embeds for a new one', async () => {
    const rows = fresh();
    await embedDueSegments(memoryStore(rows), embedderFor('1').embedder, { budgetPaise: 1e9 });
    const same = embedderFor('1');
    expect(
      await embedDueSegments(memoryStore(rows), same.embedder, { budgetPaise: 1e9 }),
    ).toMatchObject({
      embedded: 0,
    });
    expect(same.embed).not.toHaveBeenCalled();
    const next = embedderFor('2');
    const report = await embedDueSegments(memoryStore(rows), next.embedder, { budgetPaise: 1e9 });
    expect(report.embedded).toBe(8);
    expect(rows.filter((r) => r.model === 'mock-embed@2')).toHaveLength(8);
  });

  it('stops at the cost budget and resumes on the next run', async () => {
    const rows = fresh();
    const store = memoryStore(rows);
    const { embedder } = embedderFor('1', 10);
    const first = await embedDueSegments(store, embedder, { budgetPaise: 30, batchSize: 2 });
    // Two batches of 2 cost 40 >= 30: the third batch never starts.
    expect(first).toMatchObject({
      embedded: 4,
      costPaise: 40,
      remaining: true,
      budgetStopped: true,
    });
    const second = await embedDueSegments(store, embedder, { budgetPaise: 1e9, batchSize: 2 });
    expect(second).toMatchObject({ embedded: 4, remaining: false, budgetStopped: false });
  });

  it('a retried batch rewrites the same rows instead of duplicating them', async () => {
    const rows = fresh();
    const store = memoryStore(rows);
    const { embedder } = embedderFor();
    const failing: SegmentEmbedder = {
      modelVersion: () => embedder.modelVersion(),
      embed: () => Promise.reject(new Error('throttled')),
    };
    await expect(embedDueSegments(store, failing, { budgetPaise: 1e9 })).rejects.toThrow();
    expect(rows.every((r) => r.embedding === null)).toBe(true);
    await embedDueSegments(store, embedder, { budgetPaise: 1e9 });
    await embedDueSegments(store, embedder, { budgetPaise: 1e9 });
    expect(rows).toHaveLength(14);
    expect(rows.filter((r) => r.embedding !== null)).toHaveLength(8);
  });
});
