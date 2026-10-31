// Segment embeddings (#895, ADR 0051 §Vectors): only `facts`, `issues`, `reasoning` and `decision`
// segments are embedded (headers and procedural text are not, which roughly halves the vector count).
// A segment is due when it has no vector or its stored model version differs from the current one, so
// a rerun with the same version is a no-op and a new version re-embeds through the same loop. Batches
// are written by segment id, so a retried batch overwrites the same rows. A run stops once its spend
// reaches the budget; the rest stays due and the next run resumes. The store and the embedder are
// ports: the job wires the drizzle store and the AI gateway, tests wire in-memory ones.
import { schema, type Queryable } from '@causedeck/db';
import { and, asc, inArray, isNull, or, ne, eq } from 'drizzle-orm';

const { judgmentSegment } = schema;

export const EMBEDDED_ROLES = ['facts', 'issues', 'reasoning', 'decision'] as const;

/** Segments sent to the embedder in one call. */
export const EMBED_BATCH_SIZE = 64;

export interface DueSegment {
  id: string;
  judgmentYear: number;
  text: string;
}

export interface SegmentEmbedStore {
  /** Up to `limit` segments of `roles` with no vector or a model version other than `modelVersion`. */
  due(roles: readonly string[], modelVersion: string, limit: number): Promise<DueSegment[]>;
  save(
    rows: readonly { id: string; judgmentYear: number; embedding: number[] }[],
    modelVersion: string,
  ): Promise<void>;
}

export interface SegmentEmbedder {
  /** The version stored per segment; read before any text is sent. */
  modelVersion(): string;
  embed(texts: readonly string[]): Promise<{ vectors: number[][]; costPaise: number }>;
}

export interface EmbedRunOptions {
  /** Stop starting batches once this much has been spent (paise). */
  budgetPaise: number;
  /** Cap on segments per run, for the job timeout. */
  maxSegments?: number;
  batchSize?: number;
}

export interface EmbedRunReport {
  embedded: number;
  costPaise: number;
  /** True when due segments are left (budget, cap or a failed batch ended the run). */
  remaining: boolean;
  budgetStopped: boolean;
}

export async function embedDueSegments(
  store: SegmentEmbedStore,
  embedder: SegmentEmbedder,
  opts: EmbedRunOptions,
): Promise<EmbedRunReport> {
  const version = embedder.modelVersion();
  const batchSize = opts.batchSize ?? EMBED_BATCH_SIZE;
  const cap = opts.maxSegments ?? Number.POSITIVE_INFINITY;
  let embedded = 0;
  let spent = 0;
  let budgetStopped = false;
  while (embedded < cap) {
    if (spent >= opts.budgetPaise) {
      budgetStopped = true;
      break;
    }
    const batch = await store.due(EMBEDDED_ROLES, version, Math.min(batchSize, cap - embedded));
    if (batch.length === 0) break;
    const { vectors, costPaise } = await embedder.embed(batch.map((s) => s.text));
    if (vectors.length !== batch.length)
      throw new Error('embedder returned the wrong vector count');
    await store.save(
      batch.map((s, i) => ({
        id: s.id,
        judgmentYear: s.judgmentYear,
        embedding: vectors[i] ?? [],
      })),
      version,
    );
    spent += costPaise;
    embedded += batch.length;
  }
  const remaining = (await store.due(EMBEDDED_ROLES, version, 1)).length > 0;
  return { embedded, costPaise: spent, remaining, budgetStopped: budgetStopped && remaining };
}

/** The store over `judgment_segment`; the segment's partition key rides along with its id. */
export function drizzleSegmentStore(db: Queryable): SegmentEmbedStore {
  return {
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
    async save(rows, modelVersion) {
      await db.transaction(async (tx) => {
        for (const r of rows) {
          await tx
            .update(judgmentSegment)
            .set({ embedding: r.embedding, embeddingModel: modelVersion })
            .where(
              and(eq(judgmentSegment.id, r.id), eq(judgmentSegment.judgmentYear, r.judgmentYear)),
            );
        }
      });
    },
  };
}
