// Workspace slugs (#177): generated from the name, unique across live, soft-deleted and recently
// renamed workspaces, never a reserved route word. A slug changes only by an owner rename, and the
// old slug redirects to the workspace for SLUG_REDIRECT_DAYS (`workspace_slug_history`).
// Uniqueness and resolution must see every workspace, which row-level security (#19) hides, so
// they go through SECURITY DEFINER functions (0006_rls_baseline) that return only slugs, ids and
// booleans; the unique indexes stay the backstop against races.
import {
  schema,
  withWorkspace,
  type Database,
  type Transaction,
  type Workspace,
} from '@causedeck/db';
import {
  isReservedSlug,
  Slug,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
} from '@causedeck/validators/workspace';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { conflict, invalid, isUniqueViolation } from './errors.ts';
import { liveWorkspace, requireCan } from './members.ts';

type Queryable = Database | Transaction;

const { organization, workspaceSlugHistory } = schema;

const FALLBACK_SLUG = 'workspace';

/** How long an old slug keeps redirecting to its workspace after a rename. */
export const SLUG_REDIRECT_DAYS = 90;

/** A URL-safe base slug for `name`: lowercase ASCII words joined by hyphens. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug.length < SLUG_MIN_LENGTH || isReservedSlug(slug) ? FALLBACK_SLUG : slug;
}

function withSuffix(base: string, n: number): string {
  if (n === 1) return base;
  const suffix = `-${String(n)}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
}

function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/** Slugs held by a workspace (any, including soft-deleted) or by an unexpired redirect. */
async function takenSlugs(db: Queryable, candidates: string[]): Promise<Set<string>> {
  const rows = await db.execute<{ slug: string }>(
    sql`select t.slug from app_slug_taken(${textArray(candidates)}) as t(slug)`,
  );
  return new Set(rows.map((r) => r.slug.toLowerCase()));
}

/** The first free slug among `base`, `base-2`, `base-3`, ... */
export async function generateUniqueSlug(db: Queryable, name: string): Promise<string> {
  const base = slugify(name);
  for (let start = 1; ; start += 50) {
    const candidates = Array.from({ length: 50 }, (_, i) => withSuffix(base, start + i));
    const taken = await takenSlugs(db, candidates);
    const free = candidates.find((c) => !taken.has(c) && !isReservedSlug(c));
    if (free !== undefined) return free;
  }
}

export interface RenameSlugRequest {
  workspaceId: string;
  actorUserId: string;
  newSlug: string;
}

/**
 * Owner-only rename. The old slug is kept in `workspace_slug_history` and redirects for
 * SLUG_REDIRECT_DAYS; until then no other workspace can take it.
 */
export async function renameSlug(db: Queryable, request: RenameSlugRequest): Promise<string> {
  const parsed = Slug.safeParse(request.newSlug);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid slug');
  const newSlug = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      const workspace = await requireCan(
        tx,
        request.workspaceId,
        request.actorUserId,
        'workspace.rename',
      );
      const oldSlug = workspace.slug;
      if (oldSlug.toLowerCase() === newSlug) return oldSlug;

      // Expired redirects (of any workspace) no longer hold either slug: drop them first.
      await tx.execute(sql`select app_release_expired_slugs(${textArray([newSlug, oldSlug])})`);
      const [free] = await tx.execute<{ ok: boolean }>(
        sql`select app_slug_available(${newSlug}, ${workspace.id}::uuid) as ok`,
      );
      if (free?.ok !== true) throw conflict('This slug is taken');

      // The new slug is free: drop its own old redirect (renaming back).
      await tx
        .delete(workspaceSlugHistory)
        .where(
          and(
            eq(workspaceSlugHistory.slug, newSlug),
            eq(workspaceSlugHistory.workspaceId, workspace.id),
          ),
        );
      const expiresAt = sql`now() + make_interval(days => ${SLUG_REDIRECT_DAYS})`;
      await tx
        .insert(workspaceSlugHistory)
        .values({ workspaceId: workspace.id, slug: oldSlug, expiresAt })
        .onConflictDoUpdate({
          target: workspaceSlugHistory.slug,
          set: { workspaceId: workspace.id, createdAt: sql`now()`, expiresAt },
        });
      await tx.update(organization).set({ slug: newSlug }).where(eq(organization.id, workspace.id));
      return newSlug;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('This slug is taken');
    throw error;
  }
}

export interface ResolvedSlug {
  workspace: Workspace;
  /** Set when `slug` is an old slug: redirect from it to `workspace.slug`. */
  redirectFrom: string | null;
}

/**
 * The live workspace a slug points at, directly or through an unexpired redirect. `null` (a 404)
 * for unknown, expired or soft-deleted. The workspace row is read in its own scope (with `userId`
 * as the acting user); membership is the caller's check.
 */
export async function resolveSlug(
  db: Queryable,
  slug: string,
  userId?: string,
): Promise<ResolvedSlug | null> {
  const [hit] = await db.execute<{ workspace_id: string; redirected: boolean }>(
    sql`select r.workspace_id::text as workspace_id, r.redirected from app_resolve_slug(${slug}) as r`,
  );
  if (!hit) return null;
  const workspaceId = hit.workspace_id;
  const [workspace] = await withWorkspace(
    db,
    userId === undefined ? { workspaceId } : { workspaceId, userId },
    (tx) =>
      tx
        .select()
        .from(organization)
        .where(and(eq(organization.id, workspaceId), liveWorkspace)),
  );
  if (!workspace) return null;
  return { workspace, redirectFrom: hit.redirected ? slug : null };
}
