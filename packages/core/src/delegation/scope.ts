// The shared plumbing of the delegation services (#63), internal to the domain: parse the input,
// open the actor's workspace scope (`withWorkspace`, RLS), take the role from the membership row
// (never from the caller) and decide with `can()`. Mirrors the court-day scope; the court-day
// internals are not part of its barrel, so the few lines are repeated here.
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  type schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import type { DeliveryJob } from '@causedeck/notifications';
import type { z } from 'zod';

import { crossWorkspace } from '../matter-graph/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

export interface DelegationDeps {
  db: Database | Transaction;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /**
   * Sends one `notification.deliver` job for the assignee's notification. Omitted, the in-app row
   * is still written and no push or email goes out.
   */
  enqueueDelivery?: (job: DeliveryJob) => Promise<unknown>;
  /** The clock (tests). */
  now?: () => Date;
}

export interface DelegationActor {
  workspaceId: string;
  userId: string;
}

export interface DelegationScope {
  tx: Transaction;
  actor: Actor;
  settings: () => Promise<PolicySettings>;
}

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** The calendar day in India (`yyyy-mm-dd`) of `at`. */
export function delegationDay(at: Date): string {
  return IST_DAY.format(at);
}

export function parseDelegationInput<S extends z.ZodType>(
  schemaOf: S,
  input: unknown,
): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Run `fn` in the actor's workspace scope. */
export async function inDelegationScope<T>(
  deps: DelegationDeps,
  actor: DelegationActor,
  fn: (scope: DelegationScope) => Promise<T>,
): Promise<T> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Workspace not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw crossWorkspace();
  }
  const { workspaceId, userId } = actor;
  return withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Workspace not found');
    let settings: PolicySettings | undefined = deps.settings;
    return fn({
      tx,
      actor: { userId, workspaceId, role },
      settings: async () => (settings ??= toPolicySettings(await getRoleSettings(tx, workspaceId))),
    });
  });
}

/** FORBIDDEN unless the actor's role may `action` (no resource). */
export function requireDelegationAction(
  scope: DelegationScope,
  action: Parameters<typeof can>[1],
  settings: PolicySettings,
  message: string,
): void {
  if (!can(scope.actor, action, undefined, settings).allow) throw forbidden(message);
}

export type MemberRow = Pick<
  typeof schema.member.$inferSelect,
  'id' | 'userId' | 'role' | 'status'
>;
