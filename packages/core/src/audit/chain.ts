// Chain verification (#227, #26 part 2). Recomputes each event's hash with the same canonical JSON
// the writer used (`app_audit_canonical`, migration 0008_audit) and checks every `prev_hash` links
// to the event before it, so an altered, inserted or removed row is reported.
import { withWorkspace, type Queryable } from '@causedeck/db';
import { sql } from 'drizzle-orm';

export interface ChainRange {
  /** Inclusive lower bound on `created_at`; the first row's `prev_hash` is then taken as given. */
  from?: Date;
  /** Exclusive upper bound on `created_at`. */
  to?: Date;
}

export interface ChainVerification {
  ok: boolean;
  /** Events checked. */
  checked: number;
  /** The first event in chain order that fails: its `hash` or its link to the previous event. */
  brokenAt?: { id: string; reason: 'hash' | 'link' };
}

/**
 * Verify one workspace's audit chain (optionally a `created_at` range of it). Account-level events
 * are verified by the nightly job (#230).
 */
export async function verifyChain(
  db: Queryable,
  workspaceId: string,
  range: ChainRange = {},
): Promise<ChainVerification> {
  const from = range.from?.toISOString() ?? null;
  const to = range.to?.toISOString() ?? null;
  const rows = await withWorkspace(db, { workspaceId }, (tx) =>
    tx.execute<{ checked: number; id: string | null; reason: 'hash' | 'link' | null }>(sql`
      with c as (
        select a.id, a.created_at,
               a.hash = sha256(coalesce(a.prev_hash, ''::bytea)
                               || convert_to(app_audit_canonical(a)::text, 'UTF8')) as hash_ok,
               case when row_number() over w = 1
                    then ${from}::timestamptz is not null or a.prev_hash is null
                    else a.prev_hash is not distinct from lag(a.hash) over w end as link_ok
        from audit_event a
        where a.workspace_id = ${workspaceId}::uuid
          and (${from}::timestamptz is null or a.created_at >= ${from}::timestamptz)
          and (${to}::timestamptz is null or a.created_at < ${to}::timestamptz)
        window w as (order by a.created_at, a.id)
      )
      select n.checked, b.id, b.reason
      from (select count(*)::int as checked from c) n
      left join lateral (
        select c.id, case when not c.hash_ok then 'hash' else 'link' end as reason
        from c where not c.hash_ok or not c.link_ok
        order by c.created_at, c.id limit 1
      ) b on true`),
  );
  const [row] = rows;
  const checked = row?.checked ?? 0;
  if (row?.id && row.reason)
    return { ok: false, checked, brokenAt: { id: row.id, reason: row.reason } };
  return { ok: true, checked };
}
