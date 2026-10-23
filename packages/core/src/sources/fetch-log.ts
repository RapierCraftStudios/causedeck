// The governed fetch layer's log writer (#479, D-048). `fetch_log` is global and content-free: ids,
// a URL hash, status, tier and cost. Cost is metered per call here; the usage service is
// workspace-scoped and the fetch layer has no workspace, so per-workspace usage keys stay with the
// callers that know one.
import { db as appDb, schema, type Queryable } from '@causedeck/db';

const { fetchLog } = schema;

/** Structurally the `FetchLogEntry` of `@causedeck/fetch`, which core must not import for its types. */
export interface FetchLogInput {
  sourceId: string;
  urlHash: string;
  status: number;
  tier: schema.SourceMaxTier | null;
  costDollars: number;
  fetchedAt: Date;
  advocateId: string | null;
}

/** Append one `fetch_log` row. */
export async function recordFetchLog(db: Queryable, entry: FetchLogInput): Promise<void> {
  await db.insert(fetchLog).values({
    sourceId: entry.sourceId,
    urlHash: entry.urlHash,
    status: entry.status,
    tier: entry.tier,
    costDollars: String(entry.costDollars),
    fetchedAt: entry.fetchedAt,
    delegatedAdvocateId: entry.advocateId,
  });
}

/** The `log` sink for `createFetcher`, writing through the app database. */
export function createFetchLogSink(db: Queryable = appDb): {
  record(entry: FetchLogInput): Promise<void>;
} {
  return { record: (entry) => recordFetchLog(db, entry) };
}
