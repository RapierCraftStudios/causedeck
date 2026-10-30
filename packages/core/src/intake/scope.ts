// The shared entry of every intake service: the flag gate, the member's role and the policy check,
// all before any enquiry row is touched. The flag is read first, so a workspace without the feature
// learns nothing else; a non-member gets NOT_FOUND and a role below advocate gets FORBIDDEN.
import { isRole } from '@causedeck/auth';
import { can, type Action, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';
import type { z } from 'zod';

import { FeatureDisabledError } from './errors.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

export const ENQUIRY_LOG_FLAG = 'intake.enquiry_log';

export interface IntakeActor {
  workspaceId: string;
  userId: string;
}

export interface IntakeDeps {
  db: Database | Transaction;
  /** The flag read; `isEnabled('intake.enquiry_log')` when omitted. */
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The clock; the system clock when omitted. */
  now?: () => Date;
}

export interface IntakeScope {
  tx: Transaction;
  actor: Actor;
  now: Date;
  settings: PolicySettings;
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

export async function withIntake<T>(
  deps: IntakeDeps,
  actor: IntakeActor,
  action: Extract<Action, 'enquiry.read' | 'enquiry.write'>,
  fn: (scope: IntakeScope) => Promise<T>,
): Promise<T> {
  const flag =
    deps.flagEnabled ??
    ((workspaceId) => isEnabled(ENQUIRY_LOG_FLAG, { workspaceId }, { db: deps.db }));
  if (!(await flag(actor.workspaceId))) throw new FeatureDisabledError(ENQUIRY_LOG_FLAG);
  return withWorkspace(deps.db, actor, async (tx) => {
    const role = await memberRole(tx, actor.userId, actor.workspaceId);
    if (role === null || !isRole(role)) throw notFound('Enquiry not found');
    const settings =
      deps.settings ?? toPolicySettings(await getRoleSettings(tx, actor.workspaceId));
    const who: Actor = { ...actor, role };
    if (!can(who, action, undefined, settings).allow) {
      throw forbidden('You cannot use the enquiry log');
    }
    return fn({ tx, actor: who, now: deps.now?.() ?? new Date(), settings });
  });
}
