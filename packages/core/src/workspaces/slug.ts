// Workspace slugs (#177): generated from the name, unique across live, soft-deleted and recently
// renamed workspaces, never a reserved route word. A slug changes only by an owner rename, and the
// old slug redirects to the workspace for SLUG_REDIRECT_DAYS (`workspace_slug_history`).
import { schema, type Database, type Transaction, type Workspace } from '@causedeck/db';
import {
  isReservedSlug,
  Slug,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
} from '@causedeck/validators/workspace';
import { and, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';

import { conflict, invalid, isUniqueViolation } from './errors.ts';
import { liveWorkspace, requireOwner } from './members.ts';

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

/** Slugs held by a workspace (any, including soft-deleted) or by an unexpired redirect. */
async function takenSlugs(db: Queryable, candidates: string[]): Promise<Set<string>> {
  const current = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(inArray(organization.slug, candidates));
  const redirects = await db
    .select({ slug: workspaceSlugHistory.slug })
    .from(workspaceSlugHistory)
    .where(
      and(
        inArray(workspaceSlugHistory.slug, candidates),
        gt(workspaceSlugHistory.expiresAt, sql`now()`),
      ),
    );
  return new Set([...current, ...redirects].map((r) => r.slug.toLowerCase()));
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
      const workspace = await requireOwner(tx, request.workspaceId, request.actorUserId);
      const oldSlug = workspace.slug;
      if (oldSlug.toLowerCase() === newSlug) return oldSlug;

      const [holder] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, newSlug));
      if (holder) throw conflict('This slug is taken');
      const [redirect] = await tx
        .select({ workspaceId: workspaceSlugHistory.workspaceId })
        .from(workspaceSlugHistory)
        .where(
          and(
            eq(workspaceSlugHistory.slug, newSlug),
            gt(workspaceSlugHistory.expiresAt, sql`now()`),
          ),
        );
      if (redirect && redirect.workspaceId !== workspace.id) throw conflict('This slug is taken');

      // The new slug is free: drop its own old redirect (renaming back) or an expired one.
      await tx
        .delete(workspaceSlugHistory)
        .where(
          and(
            eq(workspaceSlugHistory.slug, newSlug),
            or(
              eq(workspaceSlugHistory.workspaceId, workspace.id),
              lte(workspaceSlugHistory.expiresAt, sql`now()`),
            ),
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
 * for unknown, expired or soft-deleted.
 */
export async function resolveSlug(db: Queryable, slug: string): Promise<ResolvedSlug | null> {
  const [current] = await db
    .select()
    .from(organization)
    .where(and(eq(organization.slug, slug), liveWorkspace));
  if (current) return { workspace: current, redirectFrom: null };

  const [redirected] = await db
    .select({ workspace: organization })
    .from(workspaceSlugHistory)
    .innerJoin(organization, eq(organization.id, workspaceSlugHistory.workspaceId))
    .where(
      and(
        eq(workspaceSlugHistory.slug, slug),
        gt(workspaceSlugHistory.expiresAt, sql`now()`),
        liveWorkspace,
      ),
    );
  return redirected ? { workspace: redirected.workspace, redirectFrom: slug } : null;
}
