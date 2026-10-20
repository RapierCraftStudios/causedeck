// Postgres store for `Idempotency-Key` (#14): one row per (user, key), claimed before the handler
// runs so concurrent duplicates see "in progress", completed with the response, and expired 24 h
// after the first request. Moved here from apps/api (#299) so the api reaches the table only through
// `@causedeck/core/runtime`.
import { schema, type Database } from '@causedeck/db';
import { and, eq, lte } from 'drizzle-orm';

export type StoredApiResponse = schema.StoredApiResponse;

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** `response.status` of a claimed key whose request is still running. */
export const IN_PROGRESS_STATUS = 0;

export interface IdempotencyRecord {
  requestHash: string;
  response: StoredApiResponse;
  expiresAt: Date;
}

export interface ClaimInput {
  userId: string;
  key: string;
  workspaceId: string | null;
  method: string;
  path: string;
  requestHash: string;
  now: Date;
}

export interface IdempotencyStore {
  get(userId: string, key: string): Promise<IdempotencyRecord | null>;
  /** Insert an in-progress claim; `false` when a row already exists. */
  claim(input: ClaimInput): Promise<boolean>;
  complete(userId: string, key: string, response: StoredApiResponse): Promise<void>;
  release(userId: string, key: string): Promise<void>;
  /** Delete the row if it has expired at `now`. */
  dropExpired(userId: string, key: string, now: Date): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
}

const t = schema.apiIdempotencyKey;

export function createIdempotencyStore(db: Database): IdempotencyStore {
  const byKey = (userId: string, key: string) => and(eq(t.userId, userId), eq(t.key, key));

  return {
    async get(userId, key) {
      const [row] = await db
        .select({ requestHash: t.requestHash, response: t.response, expiresAt: t.expiresAt })
        .from(t)
        .where(byKey(userId, key))
        .limit(1);
      return row ?? null;
    },

    async claim({ now, ...input }) {
      const inserted = await db
        .insert(t)
        .values({
          ...input,
          response: { status: IN_PROGRESS_STATUS, headers: {}, body: '' },
          createdAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        })
        .onConflictDoNothing({ target: [t.userId, t.key] })
        .returning({ id: t.id });
      return inserted.length > 0;
    },

    async complete(userId, key, response) {
      await db.update(t).set({ response }).where(byKey(userId, key));
    },

    async release(userId, key) {
      await db.delete(t).where(byKey(userId, key));
    },

    async dropExpired(userId, key, now) {
      await db.delete(t).where(and(byKey(userId, key), lte(t.expiresAt, now)));
    },

    async purgeExpired(now) {
      const deleted = await db.delete(t).where(lte(t.expiresAt, now)).returning({ id: t.id });
      return deleted.length;
    },
  };
}
