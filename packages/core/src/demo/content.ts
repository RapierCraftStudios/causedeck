// The sealed and stored content of the demo workspaces (#985): the parts `@causedeck/db`'s seed
// cannot write because they need `@causedeck/storage`. `seedDemoMemory` seals the memory items M1
// to M7, their proposals and usage under the workspace key (`demoMemory` in the db seed holds the
// plain values); `seedDemoFiles` puts the SYNTHETIC sample order PDFs in the bucket at the key each
// `document` row names and records a finalized `blob` row. Both are idempotent (fixed ids, conflicts
// ignored) and deterministic apart from the ciphertext nonce. Run by `pnpm db:seed:demo:content`
// and by the nightly reset (`system.demo.reset`), which wipes memory with the rest of the workspace.
// Not exported from the package index: it is seed tooling, not a service.
import { createMockEmbedProvider } from '@causedeck/ai';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import {
  drizzleSegmentStore,
  embedDueSegments,
  type EMBEDDED_ROLES,
  type SegmentEmbedStore,
} from '@causedeck/intelligence';
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  DEMO_JUDGMENTS,
  demoDocumentPdfs,
  demoMemory,
  demoMember,
  demoWorkspace,
  kolkataToday,
  seedInstant,
  type DemoWorkspaceKey,
} from '@causedeck/db/seed/demo';
import {
  encryptField,
  ensureWorkspaceKey,
  getWorkspaceDek,
  objectKey,
  type KeyProvider,
  type ObjectKey,
  type ObjectStore,
} from '@causedeck/storage';

const { memoryItem, memoryProposal, memoryUsage, blob, judgmentSegment } = schema;

export interface DemoContentDeps {
  db: Queryable;
  keys: KeyProvider;
}

export interface DemoContentResult {
  items: number;
  proposals: number;
  usages: number;
}

/** Seal and write the memory of one demo workspace. Refuses nothing: the caller guards production. */
export async function seedDemoMemory(
  { db, keys }: DemoContentDeps,
  key: DemoWorkspaceKey,
  { today }: { today?: string } = {},
): Promise<DemoContentResult> {
  const ws = demoWorkspace(key);
  const day = today ?? kolkataToday();
  const memory = demoMemory(ws, day);
  await ensureWorkspaceKey(db, keys, ws.id);
  const dek = await getWorkspaceDek(db, keys, ws.id);
  const seal = (value: unknown) => encryptField(dek, ws.id, JSON.stringify(value));
  await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
    // The one memory_item writer besides confirmMemory (#985): it must only ever touch a demo workspace.
    const [org] = await tx
      .select({ isDemo: schema.organization.isDemo })
      .from(schema.organization)
      .where(eq(schema.organization.id, ws.id));
    if (org?.isDemo !== true) throw new Error(`seedDemoMemory: ${ws.id} is not a demo workspace`);
    if (memory.items.length > 0) {
      await tx
        .insert(memoryItem)
        .values(
          memory.items.map((i) => ({
            id: i.id,
            workspaceId: ws.id,
            layer: i.layer,
            key: i.key,
            scope: i.scope,
            matterId: i.matterId,
            personId: i.personId,
            ownerUserId: i.ownerUserId,
            valueCiphertext: seal(i.value),
            sourceType: i.sourceType,
            sourceRef: i.sourceRef,
            confidence: i.confidence === null ? null : i.confidence.toFixed(3),
            confirmationState: i.confirmationState,
            strategy: i.strategy,
            sharedWithChamber: i.sharedWithChamber,
            createdAt: i.createdAt,
            updatedAt: i.createdAt,
          })),
        )
        .onConflictDoNothing();
    }
    if (memory.proposals.length > 0) {
      await tx
        .insert(memoryProposal)
        .values(
          memory.proposals.map((p) => ({
            id: p.id,
            workspaceId: ws.id,
            layer: p.layer,
            key: p.key,
            scope: p.scope,
            matterId: p.matterId,
            personId: p.personId,
            ownerUserId: p.ownerUserId,
            proposedValueCiphertext: seal(p.value),
            evidence: p.evidence,
            patternKey: p.patternKey,
            sourceType: p.sourceType,
            sourceRef: 'seed:demo',
            confidence: p.confidence.toFixed(3),
            status: p.status,
            proposedAt: p.proposedAt,
            decidedAt: p.decidedAt,
          })),
        )
        .onConflictDoNothing();
    }
    if (memory.usages.length > 0) {
      await tx
        .insert(memoryUsage)
        .values(memory.usages.map((u) => ({ ...u, workspaceId: ws.id })))
        .onConflictDoNothing();
    }
  });
  return {
    items: memory.items.length,
    proposals: memory.proposals.length,
    usages: memory.usages.length,
  };
}

export interface DemoFilesDeps {
  db: Queryable;
  store: ObjectStore;
}

/** Put the sample PDFs of one demo workspace in the bucket and record their `blob` rows. */
export async function seedDemoFiles(
  { db, store }: DemoFilesDeps,
  key: DemoWorkspaceKey,
  { today }: { today?: string } = {},
): Promise<{ files: number }> {
  const ws = demoWorkspace(key);
  const day = today ?? kolkataToday();
  const at = seedInstant(day);
  const owner = demoMember(ws, 'advocate');
  const pdfs = demoDocumentPdfs(ws, day, at);
  for (const pdf of pdfs) {
    const objKey: ObjectKey = objectKey(
      { workspaceId: ws.id, kind: 'document', id: pdf.documentId },
      at,
    );
    if (objKey !== pdf.storageKey) throw new Error(`demo file: key mismatch for ${pdf.documentId}`);
    await store.put({ key: objKey, body: pdf.bytes, contentType: 'application/pdf' });
  }
  await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
    for (let i = 0; i < pdfs.length; i += 200) {
      await tx
        .insert(blob)
        .values(
          pdfs.slice(i, i + 200).map((pdf) => ({
            id: pdf.documentId,
            workspaceId: ws.id,
            key: pdf.storageKey,
            kind: 'document',
            filename: pdf.filename,
            size: pdf.bytes.byteLength,
            sha256: pdf.sha256,
            mime: 'application/pdf',
            scanStatus: 'skipped' as const,
            createdBy: owner.id,
            createdAt: at,
            finalizedAt: at,
          })),
        )
        .onConflictDoNothing();
    }
  });
  return { files: pdfs.length };
}

export interface DemoCorpusEmbedDeps {
  db: Queryable;
}

/**
 * Embed the segments of the synthetic demo corpus (#1070) with the mock embedder, the model
 * `searchAuthorities` queries with when no provider is configured (`createMockEmbedProvider`:
 * deterministic, 1024 dimensions). `@causedeck/db` writes the rows but cannot import the embedder, so
 * this is the second half of the corpus seed. It only touches the demo judgments (not a real corpus
 * row), embeds the same roles `system.corpus.embed` does, and is a no-op once every demo segment
 * carries the current model version. Returns how many segments it embedded.
 */
export async function seedDemoCorpusEmbeddings({ db }: DemoCorpusEmbedDeps): Promise<{
  embedded: number;
}> {
  const provider = createMockEmbedProvider();
  const demoIds = DEMO_JUDGMENTS.map((j) => j.id);
  const all = drizzleSegmentStore(db);
  // `save` is the shared store's; `due` is limited to the demo judgments (never a real corpus row).
  const store: SegmentEmbedStore = {
    due: (roles, modelVersion, limit) =>
      db
        .select({
          id: judgmentSegment.id,
          judgmentYear: judgmentSegment.judgmentYear,
          text: judgmentSegment.text,
        })
        .from(judgmentSegment)
        .where(
          and(
            inArray(judgmentSegment.judgmentId, demoIds),
            inArray(judgmentSegment.role, [...roles] as (typeof EMBEDDED_ROLES)[number][]),
            or(
              isNull(judgmentSegment.embedding),
              isNull(judgmentSegment.embeddingModel),
              ne(judgmentSegment.embeddingModel, modelVersion),
            ),
          ),
        )
        .orderBy(asc(judgmentSegment.judgmentYear), asc(judgmentSegment.id))
        .limit(limit),
    save: (rows, modelVersion) => all.save(rows, modelVersion),
  };
  const report = await embedDueSegments(
    store,
    {
      modelVersion: () => provider.modelVersion,
      embed: async (texts) => {
        const batch = await provider.embed(texts);
        return { vectors: batch.vectors, costPaise: 0 };
      },
    },
    { budgetPaise: 1 },
  );
  return { embedded: report.embedded };
}
