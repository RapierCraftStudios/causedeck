// `matterVisibilityPredicate()`: `can(actor, 'matter.read', matter)` as a SQL filter (#233), for
// list queries that cannot load every matter and call `filterVisible()`. It reads the restriction
// rows (`matter_restriction`) and the actor's junior assignments; RLS keeps it inside the actor's
// workspace, and the subqueries pin the workspace too. Keep it in step with `can()`: the tests
// compare the two on the same data.
import { matterRestriction } from '@causedeck/db/schema';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { domainOf } from './actions';
import type { Actor, PolicySettings } from './can';
import { JUNIOR_MATTER_SCOPED } from './matrix';

type SqlOperand = AnyColumn | SQL;

export interface VisibilityOptions {
  settings?: PolicySettings;
  /** The matter's owner (`Resource.ownerUserId`); a junior sees matters they own. */
  ownerUserId?: SqlOperand;
}

/**
 * A predicate that is true for the rows whose matter (`matterId`, a uuid column or expression) the
 * actor may read: restricted matters only for the listed users and owners (unless
 * `ownersSeeRestrictedMatters` is false), and for juniors only assigned, listed or owned matters.
 */
export function matterVisibilityPredicate(
  actor: Actor,
  matterId: SqlOperand,
  { settings = {}, ownerUserId }: VisibilityOptions = {},
): SQL {
  if (actor.suspended === true) return sql`false`;
  if (settings.disabledDomains?.has(domainOf('matter.read')) === true) return sql`false`;

  const mr = matterRestriction;
  const sameMatter = sql`${mr.workspaceId} = ${actor.workspaceId}::uuid and ${mr.matterId} = ${matterId}`;
  const listed = sql`${actor.userId}::uuid = any(${mr.allowedUserIds})`;
  const conditions: SQL[] = [];

  const ownerSees = actor.role === 'owner' && settings.ownersSeeRestrictedMatters !== false;
  if (!ownerSees) {
    conditions.push(sql`not exists (select 1 from ${mr} where ${sameMatter} and not ${listed})`);
  }

  if (actor.role === 'junior' && JUNIOR_MATTER_SCOPED.has('matter.read')) {
    const reach: SQL[] = [sql`exists (select 1 from ${mr} where ${sameMatter} and ${listed})`];
    const assigned = [...(actor.assignedMatterIds ?? [])];
    if (assigned.length > 0) {
      reach.push(
        sql`${matterId} in (${sql.join(
          assigned.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    }
    if (ownerUserId !== undefined) reach.push(sql`${ownerUserId} = ${actor.userId}::uuid`);
    conditions.push(sql`(${sql.join(reach, sql` or `)})`);
  }

  return conditions.length === 0 ? sql`true` : sql`(${sql.join(conditions, sql` and `)})`;
}
