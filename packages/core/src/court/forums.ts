// Forum services (#34, ADR 0014; PRD CL-1). A workspace sees the system catalogue (null
// `workspace_id`, seeded by the owner from packages/db/src/seed/forum-catalogue) plus its own custom
// forums; RLS (`ws_isolation` + `global_read`, ADR 0013) hides every other workspace's. Reads run in
// the given workspace's scope. `createWorkspaceForum` adds a custom A0 forum: it needs `matter.write`
// (a forum is entered while recording a matter), never takes a system forum's code, and cannot write
// the catalogue (RLS rejects a null `workspace_id` for the app role anyway).
import { isRole } from '@causedeck/auth';
import { assertCan, ForbiddenError, type Actor } from '@causedeck/auth/policy';
import { currentScope, isUuid, schema, withWorkspace, type Queryable } from '@causedeck/db';
import {
  FORUM_CODE_PATTERN,
  ForumConfigSchema,
  LanguageProfileSchema,
  type ForumDeepLinkKind,
} from '@causedeck/validators/forum';
import { FORUM_SIDES, JURISDICTION_KINDS } from '@causedeck/validators/matter-graph';
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { buildDeepLink, type DeepLinkParams, type OpenInNewWindow } from './deep-links.ts';

const { forum } = schema;

export type Forum = typeof forum.$inferSelect;

/** Who is asking: the caller's role, if any, is replaced by the active membership's role. */
export type ForumActor = Omit<Actor, 'role'> & Partial<Pick<Actor, 'role'>>;

export interface ListForumsOptions {
  /** Also return disabled forums (e.g. the catalogued Madurai Bench). Default false. */
  includeDisabled?: boolean;
}

const forumNotFound = () => notFound('Forum not found');

function visible(options: ListForumsOptions, ...conditions: (SQL | undefined)[]) {
  return and(options.includeDisabled === true ? undefined : eq(forum.enabled, true), ...conditions);
}

/** The catalogue forums and the workspace's own, ordered by court and establishment. */
export async function listForums(
  db: Queryable,
  workspaceId: string,
  options: ListForumsOptions = {},
): Promise<Forum[]> {
  return withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .select()
      .from(forum)
      .where(visible(options))
      .orderBy(asc(forum.court), asc(forum.establishment), asc(forum.code)),
  );
}

/** The forums seated in `city` (case-insensitive), catalogue and the workspace's own. */
export async function listForumsByCity(
  db: Queryable,
  workspaceId: string,
  city: string,
  options: ListForumsOptions = {},
): Promise<Forum[]> {
  const seat = city.trim();
  if (seat === '') return [];
  return withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .select()
      .from(forum)
      .where(visible(options, sql`lower(${forum.seat}) = lower(${seat})`))
      .orderBy(asc(forum.court), asc(forum.establishment), asc(forum.code)),
  );
}

/**
 * A forum by id or code, catalogue or the workspace's own (disabled ones included). By code, the
 * catalogue row wins over a workspace row with the same code. `NOT_FOUND` otherwise.
 */
export async function getForum(
  db: Queryable,
  workspaceId: string,
  idOrCode: string,
): Promise<Forum> {
  const key = idOrCode.trim();
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(forum)
      .where(isUuid(key) ? eq(forum.id, key) : eq(forum.code, key))
      .orderBy(sql`${forum.workspaceId} is not null`)
      .limit(1);
    if (row === undefined) throw forumNotFound();
    return row;
  });
}

const CreateWorkspaceForumInputSchema = z
  .object({
    code: z.string().regex(FORUM_CODE_PATTERN, 'code must be a dotted lower-case slug'),
    court: z.string().trim().min(1).max(200),
    establishment: z.string().trim().min(1).max(200).nullish(),
    seat: z.string().trim().min(1).max(100).nullish(),
    side: z.enum(FORUM_SIDES).exactOptional(),
    jurisdictionKind: z.enum(JURISDICTION_KINDS),
    languageProfile: LanguageProfileSchema.exactOptional(),
    config: ForumConfigSchema.exactOptional(),
  })
  .strict();

export type CreateWorkspaceForumInput = z.input<typeof CreateWorkspaceForumInputSchema>;

/**
 * Add a custom A0 forum to the actor's workspace (no adapter). Requires `matter.write` (junior and
 * above): `FORBIDDEN` otherwise, `NOT_FOUND` for a non-member, `CONFLICT` when the code is a system
 * forum's or already one of the workspace's, `VALIDATION` for a malformed input.
 */
export async function createWorkspaceForum(
  db: Queryable,
  actor: ForumActor,
  input: CreateWorkspaceForumInput,
): Promise<Forum> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw forumNotFound();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw forumNotFound();
  }
  const parsed = CreateWorkspaceForumInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const data = parsed.data;
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw forumNotFound();
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    try {
      assertCan({ ...actor, role }, 'matter.write', { kind: 'forum', workspaceId }, { settings });
    } catch (error) {
      if (error instanceof ForbiddenError) throw forbidden('You cannot add a forum');
      throw error;
    }
    const [taken] = await tx
      .select({ workspaceId: forum.workspaceId })
      .from(forum)
      .where(
        and(
          eq(forum.code, data.code),
          or(isNull(forum.workspaceId), eq(forum.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (taken !== undefined) {
      throw conflict(
        taken.workspaceId === null
          ? 'This code belongs to a catalogue forum'
          : 'This workspace already has a forum with this code',
      );
    }
    const [row] = await tx
      .insert(forum)
      .values({
        workspaceId,
        code: data.code,
        court: data.court,
        establishment: data.establishment ?? null,
        seat: data.seat ?? null,
        side: data.side ?? 'not_applicable',
        jurisdictionKind: data.jurisdictionKind,
        languageProfile: data.languageProfile ?? {},
        adapterId: null,
        adapterLevel: 'A0',
        config: data.config ?? {},
        enabled: true,
      })
      .returning();
    if (row === undefined) throw new Error('createWorkspaceForum: insert returned no row');
    return row;
  });
}

/**
 * The forum's `kind` page as a new-window link (first host, the others as fallbacks), or null when
 * the forum is disabled, has no such page, or its config does not validate.
 */
export function resolveDeepLink(
  target: Pick<Forum, 'enabled' | 'config'>,
  kind: ForumDeepLinkKind,
  params: DeepLinkParams = {},
): OpenInNewWindow | null {
  if (!target.enabled) return null;
  const config = ForumConfigSchema.safeParse(target.config);
  if (!config.success) return null;
  return buildDeepLink(config.data, kind, params);
}
