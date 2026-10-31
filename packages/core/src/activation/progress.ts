// Practice-school progress for signed-in readers (#703 R4, D-049). One row per (user, module) in
// `learn_progress`, a global table under FORCE RLS on `app.user_id`: every call opens `withUser`
// for the given user, so the database, not this code, keeps one reader's progress from another.
// Marking is idempotent and the first completion time is kept. Ids and a closed slug list only: no
// email, no free text. `LEARN_MODULE_SLUGS` mirrors `apps/site/src/learn/slugs.ts` (a test keeps
// the two equal; the site does not depend on this package).
import { schema, withUser, type Queryable } from '@causedeck/db';
import { and, asc, eq } from 'drizzle-orm';

export const LEARN_MODULE_SLUGS = [
  'court-day-practice',
  'reading-cause-lists',
  'listings-and-mentions',
  'filing-and-defect-cures',
  'limitation-basics',
  'using-the-os',
] as const;
export type LearnModuleSlug = (typeof LEARN_MODULE_SLUGS)[number];

export function isLearnModuleSlug(value: unknown): value is LearnModuleSlug {
  return typeof value === 'string' && (LEARN_MODULE_SLUGS as readonly string[]).includes(value);
}

function assertSlug(slug: unknown): asserts slug is LearnModuleSlug {
  if (!isLearnModuleSlug(slug)) throw new TypeError('unknown learn module');
}

export interface LearnProgressEntry {
  slug: LearnModuleSlug;
  completedAt: Date;
}

/** Mark `slug` done for `userId`. Returns whether a row was written (false: already done). */
export async function markLearnModuleDone(
  db: Queryable,
  { userId, slug }: { userId: string; slug: string },
): Promise<boolean> {
  assertSlug(slug);
  return withUser(db, { userId }, async (tx) => {
    const rows = await tx
      .insert(schema.learnProgress)
      .values({ userId, moduleSlug: slug })
      .onConflictDoNothing({
        target: [schema.learnProgress.userId, schema.learnProgress.moduleSlug],
      })
      .returning({ id: schema.learnProgress.id });
    return rows.length > 0;
  });
}

/** Un-mark `slug` for `userId`. Returns whether a row was removed. */
export async function unmarkLearnModule(
  db: Queryable,
  { userId, slug }: { userId: string; slug: string },
): Promise<boolean> {
  assertSlug(slug);
  return withUser(db, { userId }, async (tx) => {
    const rows = await tx
      .delete(schema.learnProgress)
      .where(
        and(eq(schema.learnProgress.userId, userId), eq(schema.learnProgress.moduleSlug, slug)),
      )
      .returning({ id: schema.learnProgress.id });
    return rows.length > 0;
  });
}

/** The modules `userId` has completed, in teaching order. */
export async function listCompletedLearnModules(
  db: Queryable,
  { userId }: { userId: string },
): Promise<LearnProgressEntry[]> {
  const rows = await withUser(db, { userId }, (tx) =>
    tx
      .select({
        slug: schema.learnProgress.moduleSlug,
        completedAt: schema.learnProgress.completedAt,
      })
      .from(schema.learnProgress)
      .where(eq(schema.learnProgress.userId, userId))
      .orderBy(asc(schema.learnProgress.completedAt)),
  );
  const order = (slug: LearnModuleSlug) => LEARN_MODULE_SLUGS.indexOf(slug);
  return rows
    .filter((row): row is { slug: LearnModuleSlug; completedAt: Date } =>
      isLearnModuleSlug(row.slug),
    )
    .sort((a, b) => order(a.slug) - order(b.slug));
}
