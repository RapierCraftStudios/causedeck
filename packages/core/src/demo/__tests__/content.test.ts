// The sealed and stored content of the demo workspaces (#985): memory M1 to M7 sealed under the
// workspace key (decrypted back to the seed's plain values, never stored in the clear), the sample
// PDFs put in the bucket with a finalized blob row each, and both idempotent.
import { randomBytes } from 'node:crypto';

import { createMockEmbedProvider } from '@causedeck/ai';
import { Secret } from '@causedeck/config/env';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  DEMO_CORPUS_VERSIONS,
  DEMO_SUBJECT_AREAS,
  DEMO_WORKSPACES,
  demoDocumentPdfs,
  demoMember,
  demoMemory,
  seedDemo,
  seedInstant,
} from '@causedeck/db/seed/demo';
import {
  ENRICH_VERSION,
  REDACTION_VERSION,
  SEGMENT_VERSION,
  type ResearchPlan,
} from '@causedeck/intelligence';
import {
  createMemoryObjectStore,
  decryptField,
  EnvKeyProvider,
  getWorkspaceDek,
  type ObjectKey,
} from '@causedeck/storage';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { listRelevantJudgments, rerunAuthoritySearch } from '../../research/index.ts';
import { seedDemoCorpusEmbeddings, seedDemoFiles, seedDemoMemory } from '../content.ts';

const TODAY = '2026-10-21';
const keys = new EnvKeyProvider([{ id: 'kek-1', key: new Secret(randomBytes(32)) }]);
const ws = DEMO_WORKSPACES['bengaluru-chamber'];

describe('demo content: sealed memory', () => {
  it('writes M1 to M5 sealed under the workspace key, once', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY, workspaces: ['bengaluru-chamber'] });
      const first = await seedDemoMemory({ db: tx, keys }, 'bengaluru-chamber', { today: TODAY });
      const again = await seedDemoMemory({ db: tx, keys }, 'bengaluru-chamber', { today: TODAY });
      expect(again).toEqual(first);
      const expected = demoMemory(ws, TODAY);
      const items = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.memoryItem).where(eq(schema.memoryItem.workspaceId, ws.id)),
      );
      expect(items).toHaveLength(expected.items.length);
      expect(new Set(items.map((i) => i.layer))).toEqual(
        new Set(expected.items.map((i) => i.layer)),
      );
      for (const layer of ['M1', 'M2', 'M3', 'M4', 'M5']) {
        expect(
          items.some((i) => i.layer === layer),
          layer,
        ).toBe(true);
      }
      const dek = await getWorkspaceDek(tx, keys, ws.id);
      for (const item of items) {
        expect(item.valueCiphertext).not.toBeNull();
        const plain: unknown = JSON.parse(decryptField(dek, ws.id, item.valueCiphertext ?? ''));
        expect(plain).toEqual(expected.items.find((e) => e.id === item.id)?.value);
      }
      const proposals = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.memoryProposal).where(eq(schema.memoryProposal.workspaceId, ws.id)),
      );
      expect(new Set(proposals.map((p) => p.status))).toEqual(
        new Set(['proposed', 'dismissed', 'observing']),
      );
    });
  });
});

describe('demo content: sample PDFs in the bucket', () => {
  it('stores every order PDF at its document key with a finalized blob, once', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY, workspaces: ['bengaluru-chamber'] });
      const store = createMemoryObjectStore();
      const first = await seedDemoFiles({ db: tx, store }, 'bengaluru-chamber', { today: TODAY });
      expect(
        (await seedDemoFiles({ db: tx, store }, 'bengaluru-chamber', { today: TODAY })).files,
      ).toBe(first.files);
      const pdfs = demoDocumentPdfs(ws, TODAY, seedInstant(TODAY));
      expect(first.files).toBe(pdfs.length);
      const docs = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.document).where(eq(schema.document.workspaceId, ws.id)),
      );
      for (const doc of docs.filter((d) => d.kind === 'order')) {
        const stored = await store.get(doc.storageKey as ObjectKey);
        expect(Buffer.from(stored.body).toString('latin1')).toContain('SYNTHETIC');
      }
      const blobs = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.blob).where(eq(schema.blob.workspaceId, ws.id)),
      );
      expect(blobs).toHaveLength(pdfs.length);
      expect(blobs.every((b) => b.finalizedAt !== null && b.scanStatus === 'skipped')).toBe(true);
      expect(blobs.every((b) => b.mime === 'application/pdf')).toBe(true);
    });
  });
});

describe('demo content: the research corpus (#1070)', () => {
  it('pins the corpus versions the db seed mirrors', () => {
    expect(DEMO_CORPUS_VERSIONS).toEqual({
      redaction: REDACTION_VERSION,
      segment: SEGMENT_VERSION,
      enrich: ENRICH_VERSION,
    });
  });

  it('embeds the demo segments once, with the mock model, and leaves other corpus rows alone', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY, workspaces: ['bengaluru-chamber'] });
      const first = await seedDemoCorpusEmbeddings({ db: tx });
      expect(first.embedded).toBeGreaterThan(0);
      expect((await seedDemoCorpusEmbeddings({ db: tx })).embedded).toBe(0);
      const rows = await tx.execute(
        sql`select embedding_model as model, role from judgment_segment where embedding is not null`,
      );
      const embedded = [...rows] as { model: string; role: string }[];
      expect(embedded).toHaveLength(first.embedded);
      expect(new Set(embedded.map((r) => r.model))).toEqual(
        new Set([createMockEmbedProvider().modelVersion]),
      );
      expect(embedded.some((r) => r.role === 'header')).toBe(false);
    });
  });

  it('answers every subject filter with a result for the demo advocate, and lists matter judgments', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY, workspaces: ['bengaluru-chamber'] });
      await seedDemoCorpusEmbeddings({ db: tx });
      const actor = { workspaceId: ws.id, userId: demoMember(ws, 'advocate').id };
      for (const area of DEMO_SUBJECT_AREAS) {
        const [facts] = [
          ...(await tx.execute(
            sql`select s.text from judgment_segment s join judgment_tag t on t.judgment_id = s.judgment_id
                where t.subject_area = ${area} and s.role = 'facts' order by s.id limit 1`,
          )),
        ] as { text: string }[];
        const plan: ResearchPlan = {
          query: facts?.text ?? '',
          factDescription: facts?.text ?? '',
          keywords: (facts?.text ?? '')
            .split(/\W+/)
            .filter((w) => w.length > 5)
            .slice(0, 8),
          subjectAreas: [area] as ResearchPlan['subjectAreas'],
          statutes: [],
          courts: [],
          courtLevel: null,
          dateFrom: null,
          dateTo: null,
          outcome: null,
          offenceDate: null,
          planner: 'heuristic',
        };
        const result = await rerunAuthoritySearch(tx, actor, { plan });
        expect(result.hits.length, area).toBeGreaterThanOrEqual(1);
      }

      const alerts = await inWorkspace(tx, ws.id, (s) =>
        s
          .select({ matterId: schema.judgmentAlert.matterId })
          .from(schema.judgmentAlert)
          .where(eq(schema.judgmentAlert.workspaceId, ws.id)),
      );
      const matterId = alerts[0]?.matterId ?? '';
      const relevant = await listRelevantJudgments(tx, actor, matterId);
      expect(relevant.length).toBeGreaterThanOrEqual(2);
    });
  });
});
