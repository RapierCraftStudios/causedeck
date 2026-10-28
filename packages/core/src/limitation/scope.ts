// The shared entry of every limitation service: the flag gate first (a workspace without the
// feature learns nothing else), then membership and the role. `canWrite` is `limitation.write`
// (owners and advocates); `canSeeRules` is `limitation.read` (junior and up). A clerk or viewer
// gets due dates only.
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { FeatureDisabledError } from './errors.ts';

export const LIMITATION_FLAG = 'limitation.enabled';

export interface LimitationActor {
  workspaceId: string;
  userId: string;
}

export interface LimitationDeps {
  db: Database | Transaction;
  /** The flag read; `isEnabled('limitation.enabled')` when omitted. */
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The clock; the system clock when omitted. */
  now?: () => Date;
}

export interface LimitationScope {
  tx: Transaction;
  actor: Actor;
  memberId: string;
  now: Date;
  canWrite: boolean;
  canSeeRules: boolean;
}

export function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

export async function withLimitation<T>(
  deps: LimitationDeps,
  actor: LimitationActor,
  need: 'read' | 'write',
  fn: (scope: LimitationScope) => Promise<T>,
): Promise<T> {
  const flag =
    deps.flagEnabled ??
    ((workspaceId) => isEnabled(LIMITATION_FLAG, { workspaceId }, { db: deps.db }));
  if (!(await flag(actor.workspaceId))) throw new FeatureDisabledError(LIMITATION_FLAG);
  return withWorkspace(deps.db, actor, async (tx) => {
    const role = await memberRole(tx, actor.userId, actor.workspaceId);
    if (role === null || !isRole(role)) throw notFound('Matter not found');
    const settings =
      deps.settings ?? toPolicySettings(await getRoleSettings(tx, actor.workspaceId));
    const who: Actor = { ...actor, role };
    const canWrite = can(who, 'limitation.write', undefined, settings).allow;
    if (need === 'write' && !canWrite) throw forbidden('You cannot compute limitation dates');
    const { member } = schema;
    const [self] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, actor.workspaceId), eq(member.userId, actor.userId)))
      .limit(1);
    if (self === undefined) throw notFound('Matter not found');
    return fn({
      tx,
      actor: who,
      memberId: self.id,
      now: deps.now?.() ?? new Date(),
      canWrite,
      canSeeRules: can(who, 'limitation.read', undefined, settings).allow,
    });
  });
}
