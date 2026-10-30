// The preparedness tap (#86): one optional 1-5 rating per member and appearance, shown after a
// confirmed outcome. `shouldPrompt` applies the prompt rules; a rating or a skip is an upsert on
// (appearance, member), so tapping again updates it. A viewer is never asked.
import { schema, withWorkspace } from '@causedeck/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { forbidden, notFound } from '../shared/errors.ts';

import { promptsEnabled, requirePovMember, type PovActor, type PovDeps } from './prefs.ts';
import { isBaseline, istDayStart } from './time.ts';

const { appearance, organization, preparednessRating } = schema;

/** At most this many prompts per member per IST day. */
export const MAX_PROMPTS_PER_DAY = 3;
/** This many skips in a row pause the prompts. */
export const SKIP_STREAK = 3;
/** The pause after {@link SKIP_STREAK} skips, in days. */
export const SKIP_PAUSE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PromptFacts {
  enabled: boolean;
  /** The appearance already has a rating row for this member (shown, answered or skipped). */
  alreadyShown: boolean;
  shownToday: number;
  /** The member's answered-or-skipped rows, newest first: when skipped, else null. */
  recent: { skippedAt: Date | null }[];
  now: Date;
}

/** The prompt rules as a pure function of loaded facts. */
export function decidePrompt(facts: PromptFacts): boolean {
  if (!facts.enabled || facts.alreadyShown) return false;
  if (facts.shownToday >= MAX_PROMPTS_PER_DAY) return false;
  const streak = facts.recent.slice(0, SKIP_STREAK);
  if (streak.length === SKIP_STREAK && streak.every((r) => r.skippedAt !== null)) {
    const last = streak[0]?.skippedAt;
    if (last && facts.now.getTime() - last.getTime() < SKIP_PAUSE_DAYS * DAY_MS) return false;
  }
  return true;
}

/** The member's own appearance at the hearing; NOT_FOUND otherwise. */
async function ownAppearance(
  deps: PovDeps,
  actor: PovActor,
  memberId: string,
  hearingId: string,
): Promise<string> {
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ id: appearance.id })
      .from(appearance)
      .where(
        and(
          eq(appearance.workspaceId, actor.workspaceId),
          eq(appearance.hearingId, hearingId),
          eq(appearance.memberId, memberId),
        ),
      )
      .limit(1),
  );
  if (row === undefined) throw notFound('Appearance not found');
  return row.id;
}

async function baselineNow(deps: PovDeps, actor: PovActor, at: Date): Promise<boolean> {
  const [org] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ createdAt: organization.createdAt })
      .from(organization)
      .where(eq(organization.id, actor.workspaceId)),
  );
  return org === undefined ? false : isBaseline(org.createdAt, at);
}

/**
 * Whether to show the tap for the actor's appearance at `hearingId`. When it should show, the
 * showing is recorded (an empty row), so the appearance is never prompted twice.
 */
export async function shouldPrompt(
  deps: PovDeps,
  actor: PovActor,
  input: { hearingId: string },
): Promise<boolean> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role === 'viewer') return false;
  const now = (deps.now ?? (() => new Date()))();
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ id: appearance.id })
      .from(appearance)
      .where(
        and(
          eq(appearance.workspaceId, actor.workspaceId),
          eq(appearance.hearingId, input.hearingId),
          eq(appearance.memberId, who.memberId),
        ),
      )
      .limit(1),
  );
  if (row === undefined) return false;
  const enabled = await promptsEnabled(deps.db, actor, who.memberId);
  const facts = await withWorkspace(deps.db, actor, async (tx) => {
    const mine = and(
      eq(preparednessRating.workspaceId, actor.workspaceId),
      eq(preparednessRating.memberId, who.memberId),
    );
    const [shown] = await tx
      .select({ id: preparednessRating.id })
      .from(preparednessRating)
      .where(and(mine, eq(preparednessRating.appearanceId, row.id)));
    const [today] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(preparednessRating)
      .where(and(mine, gte(preparednessRating.createdAt, istDayStart(now))));
    const recent = await tx
      .select({ skippedAt: preparednessRating.skippedAt })
      .from(preparednessRating)
      .where(
        and(
          mine,
          sql`(${preparednessRating.rating} is not null or ${preparednessRating.skippedAt} is not null)`,
        ),
      )
      .orderBy(desc(preparednessRating.updatedAt))
      .limit(SKIP_STREAK);
    return { alreadyShown: shown !== undefined, shownToday: today?.n ?? 0, recent };
  });
  if (!decidePrompt({ enabled, now, ...facts })) return false;
  const baseline = await baselineNow(deps, actor, now);
  await withWorkspace(deps.db, actor, (tx) =>
    tx
      .insert(preparednessRating)
      .values({
        workspaceId: actor.workspaceId,
        appearanceId: row.id,
        memberId: who.memberId,
        baseline,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing(),
  );
  return true;
}

async function upsert(
  deps: PovDeps,
  actor: PovActor,
  hearingId: string,
  answer: { rating: number | null; skippedAt: Date | null; note: string | null },
): Promise<{ id: string }> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role === 'viewer') throw forbidden('Viewers are not asked');
  const now = (deps.now ?? (() => new Date()))();
  const appearanceId = await ownAppearance(deps, actor, who.memberId, hearingId);
  const baseline = await baselineNow(deps, actor, now);
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .insert(preparednessRating)
      .values({
        workspaceId: actor.workspaceId,
        appearanceId,
        memberId: who.memberId,
        baseline,
        createdAt: now,
        updatedAt: now,
        ...answer,
      })
      .onConflictDoUpdate({
        target: [
          preparednessRating.workspaceId,
          preparednessRating.appearanceId,
          preparednessRating.memberId,
        ],
        // The baseline tag stays with the first showing.
        set: { ...answer, updatedAt: now },
      })
      .returning({ id: preparednessRating.id }),
  );
  if (row === undefined) throw notFound('Rating not found');
  return row;
}

/** Store or update the actor's rating for their appearance at the hearing. */
export function recordPreparedness(
  deps: PovDeps,
  actor: PovActor,
  input: { hearingId: string; rating: number; note?: string },
): Promise<{ id: string }> {
  return upsert(deps, actor, input.hearingId, {
    rating: input.rating,
    skippedAt: null,
    note: input.note ?? null,
  });
}

/** Record that the actor skipped the tap (a later rating replaces the skip). */
export function recordSkip(
  deps: PovDeps,
  actor: PovActor,
  input: { hearingId: string },
): Promise<{ id: string }> {
  const now = (deps.now ?? (() => new Date()))();
  return upsert(deps, actor, input.hearingId, { rating: null, skippedAt: now, note: null });
}
