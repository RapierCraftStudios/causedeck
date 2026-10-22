// Court-adapter parse health (#372, ADR 0015): the aggregate the admin console (#27) and the status
// page (#42) show. It reads the `adapter_health_summary` view, which counts every workspace's parse
// runs by adapter and version and names no workspace, document or hall, so it works in any scope
// and needs no actor: nothing in it belongs to a tenant.
import { db as appDb, schema, type Queryable } from '@causedeck/db';
import { asc } from 'drizzle-orm';

export interface AdapterHealthSummaryRow {
  adapterId: string;
  adapterVersion: string;
  runs: number;
  okRuns: number;
  degradedRuns: number;
  failedRuns: number;
  rowsParsed: number;
  rowsAnchored: number;
}

/** Parse-run counts per adapter and version, ordered by adapter then version. */
export async function getAdapterHealthSummary(
  db: Queryable = appDb,
): Promise<AdapterHealthSummaryRow[]> {
  // `bigint(..., { mode: 'number' })` columns: drizzle returns plain numbers.
  const view = schema.adapterHealthSummary;
  return db.select().from(view).orderBy(asc(view.adapterId), asc(view.adapterVersion));
}
