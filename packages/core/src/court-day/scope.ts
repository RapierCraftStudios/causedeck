// The shared plumbing of the court-day services (#58), internal to the domain: parse the actor, open
// the actor's workspace scope (`withWorkspace`, RLS), take the role from the membership row (never
// from the caller) and decide with `can()`. Events are collected while the scope runs and emitted only
// once it has resolved, so a rolled-back write emits nothing.
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { crossWorkspace } from '../matter-graph/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

/** Events of the court day, emitted through an injected port; no job is registered (#59, #64 consume them). */
export type CourtDayEvent = {
  type: 'court_day.list_changed';
  workspaceId: string;
  forumId: string;
  listDate: string;
  listType: string;
  snapshotId: string;
  previousSnapshotId: string | null;
  label: 'changed' | 'supplementary';
  added: number;
  removed: number;
  moved: number;
  stageChanged: number;
};

export interface CourtDayEvents {
  emit(event: CourtDayEvent): void;
}

export interface CourtDayDeps {
  db: Database | Transaction;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  events?: CourtDayEvents;
}

export interface CourtDayActor {
  workspaceId: string;
  userId: string;
}

export interface CourtDayScope {
  tx: Transaction;
  actor: Actor;
  /** The policy settings: the injected ones, or the workspace's stored role settings (loaded once). */
  settings: () => Promise<PolicySettings>;
  emit: (event: CourtDayEvent) => void;
}

/** The parsed input, or VALIDATION with the first issue's message. */
export function parseCourtDayInput<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Run `fn` in the actor's workspace scope; emit its events once the scope has resolved. */
export async function inCourtDayScope<T>(
  deps: CourtDayDeps,
  actor: CourtDayActor,
  fn: (scope: CourtDayScope) => Promise<T>,
): Promise<T> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Workspace not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw crossWorkspace();
  }
  const events: CourtDayEvent[] = [];
  const { workspaceId, userId } = actor;
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Workspace not found');
    let settings: PolicySettings | undefined = deps.settings;
    return fn({
      tx,
      actor: { userId, workspaceId, role },
      settings: async () => (settings ??= toPolicySettings(await getRoleSettings(tx, workspaceId))),
      emit: (event) => events.push(event),
    });
  });
  for (const event of events) deps.events?.emit(event);
  return result;
}

/** The actor's member id in the workspace, or NOT_FOUND. */
export async function actorMemberId(scope: CourtDayScope): Promise<string> {
  const { tx, actor } = scope;
  const [row] = await tx
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, actor.workspaceId),
        eq(schema.member.userId, actor.userId),
      ),
    )
    .limit(1);
  if (row === undefined) throw notFound('Workspace not found');
  return row.id;
}

/** FORBIDDEN unless the actor's role may `action` (no resource). */
export function requireAction(
  scope: CourtDayScope,
  action: Parameters<typeof can>[1],
  settings: PolicySettings,
  message: string,
): void {
  if (!can(scope.actor, action, undefined, settings).allow) throw forbidden(message);
}
