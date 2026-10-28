// Who may use the proof-of-value measures and what each member can see of them (#86). Measurement
// is in-workspace and personal data of members (DPDP): a member reads and deletes their own rows;
// the owner also reads any member's rows; owner and advocates read the aggregate (counts and
// averages only). Nothing here leaves the workspace except the owner's manual report download.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, avg, count, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

const { contextTestResult, loadPulse, member, povPrefs, preparednessRating } = schema;

export type Db = Database | Transaction;

export interface PovActor {
  userId: string;
  workspaceId: string;
}

export interface PovDeps {
  db: Db;
  now?: () => Date;
}

export interface PovMember {
  memberId: string;
  role: 'owner' | 'advocate' | 'junior' | 'clerk' | 'viewer';
}

/** The actor's active membership; NOT_FOUND to a non-member (the workspace is not revealed). */
export async function requirePovMember(db: Db, actor: PovActor): Promise<PovMember> {
  const role = await memberRole(db, actor.userId, actor.workspaceId);
  if (role === null) throw notFound('Workspace not found');
  const [row] = await withWorkspace(db, actor, (tx) =>
    tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, actor.workspaceId), eq(member.userId, actor.userId)))
      .limit(1),
  );
  if (row === undefined) throw notFound('Workspace not found');
  return { memberId: row.id, role };
}

/** A member who records measures: a viewer sees nothing of the instruments. */
export async function requirePovRecorder(db: Db, actor: PovActor): Promise<PovMember> {
  const who = await requirePovMember(db, actor);
  if (who.role === 'viewer') throw forbidden('Viewers are not asked');
  return who;
}

/** Whether the member's prompts are on; no row means on. */
export async function promptsEnabled(
  db: Db,
  actor: PovActor,
  memberId: string,
): Promise<boolean> {
  const [row] = await withWorkspace(db, actor, (tx) =>
    tx
      .select({ enabled: povPrefs.promptsEnabled })
      .from(povPrefs)
      .where(and(eq(povPrefs.workspaceId, actor.workspaceId), eq(povPrefs.memberId, memberId))),
  );
  return row?.enabled ?? true;
}

/** The actor's own preference. */
export async function getPovPrefs(
  deps: PovDeps,
  actor: PovActor,
): Promise<{ promptsEnabled: boolean }> {
  const who = await requirePovMember(deps.db, actor);
  return { promptsEnabled: await promptsEnabled(deps.db, actor, who.memberId) };
}

/** Turn the actor's prompts on or off; off takes effect at once (every prompt rule reads it). */
export async function setPovPrefs(
  deps: PovDeps,
  actor: PovActor,
  input: { promptsEnabled: boolean },
): Promise<{ promptsEnabled: boolean }> {
  const who = await requirePovMember(deps.db, actor);
  const at = (deps.now ?? (() => new Date()))();
  await withWorkspace(deps.db, actor, (tx) =>
    tx
      .insert(povPrefs)
      .values({
        workspaceId: actor.workspaceId,
        memberId: who.memberId,
        promptsEnabled: input.promptsEnabled,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [povPrefs.workspaceId, povPrefs.memberId],
        set: { promptsEnabled: input.promptsEnabled, updatedAt: at },
      }),
  );
  return { promptsEnabled: input.promptsEnabled };
}

export interface OwnRatingRow {
  id: string;
  appearanceId: string;
  rating: number | null;
  skipped: boolean;
  baseline: boolean;
  note: string | null;
  createdAt: Date;
}

export interface OwnPov {
  ratings: OwnRatingRow[];
  pulses: {
    id: string;
    isoWeek: string;
    demand: number | null;
    worry: number | null;
    effort: number | null;
    dismissed: boolean;
    baseline: boolean;
  }[];
  contextTests: { id: string; matterId: string; elapsedMs: number | null; startedAt: Date }[];
}

/**
 * A member's ratings, pulses and context tests, newest first: the member's own, or any member's for
 * the owner. Another member's data to a non-owner is FORBIDDEN.
 */
export async function listPov(
  deps: PovDeps,
  actor: PovActor,
  input: { memberId?: string } = {},
): Promise<OwnPov> {
  const who = await requirePovMember(deps.db, actor);
  const target = input.memberId ?? who.memberId;
  if (target !== who.memberId && who.role !== 'owner') throw forbidden();
  return withWorkspace(deps.db, actor, async (tx) => {
    const ratings = await tx
      .select()
      .from(preparednessRating)
      .where(
        and(
          eq(preparednessRating.workspaceId, actor.workspaceId),
          eq(preparednessRating.memberId, target),
          // A prompt shown and not answered is not a rating to show.
          sql`(${preparednessRating.rating} is not null or ${preparednessRating.skippedAt} is not null)`,
        ),
      )
      .orderBy(desc(preparednessRating.createdAt));
    const pulses = await tx
      .select()
      .from(loadPulse)
      .where(and(eq(loadPulse.workspaceId, actor.workspaceId), eq(loadPulse.memberId, target)))
      .orderBy(desc(loadPulse.isoWeek));
    const tests = await tx
      .select()
      .from(contextTestResult)
      .where(
        and(
          eq(contextTestResult.workspaceId, actor.workspaceId),
          eq(contextTestResult.memberId, target),
        ),
      )
      .orderBy(desc(contextTestResult.startedAt));
    return {
      ratings: ratings.map((r) => ({
        id: r.id,
        appearanceId: r.appearanceId,
        rating: r.rating,
        skipped: r.skippedAt !== null,
        baseline: r.baseline,
        note: r.note,
        createdAt: r.createdAt,
      })),
      pulses: pulses.map((p) => ({
        id: p.id,
        isoWeek: p.isoWeek,
        demand: p.demand,
        worry: p.worry,
        effort: p.effort,
        dismissed: p.dismissedAt !== null,
        baseline: p.baseline,
      })),
      contextTests: tests.map((t) => ({
        id: t.id,
        matterId: t.matterId,
        elapsedMs: t.elapsedMs,
        startedAt: t.startedAt,
      })),
    };
  });
}

/** Delete one of the actor's own ratings. NOT_FOUND when it is not theirs (or not in the workspace). */
export async function deleteOwnRating(
  deps: PovDeps,
  actor: PovActor,
  input: { ratingId: string },
): Promise<void> {
  const who = await requirePovMember(deps.db, actor);
  const gone = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .delete(preparednessRating)
      .where(
        and(
          eq(preparednessRating.workspaceId, actor.workspaceId),
          eq(preparednessRating.id, input.ratingId),
          eq(preparednessRating.memberId, who.memberId),
        ),
      )
      .returning({ id: preparednessRating.id }),
  );
  if (gone.length === 0) throw notFound('Rating not found');
}

export interface PovAggregate {
  preparedness: { count: number; average: number | null; baselineAverage: number | null };
  load: { count: number; demand: number | null; worry: number | null; effort: number | null };
  contextTest: { count: number; averageElapsedMs: number | null };
}

const round = (value: string | null): number | null =>
  value === null ? null : Math.round(Number(value) * 100) / 100;

/** Counts and averages for the workspace; owner and advocates only. No member is identified. */
export async function povAggregate(deps: PovDeps, actor: PovActor): Promise<PovAggregate> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role !== 'owner' && who.role !== 'advocate') throw forbidden();
  return withWorkspace(deps.db, actor, async (tx) => {
    const ws = actor.workspaceId;
    const [prep] = await tx
      .select({
        n: count(),
        avg: avg(preparednessRating.rating),
        base: sql<string | null>`avg(${preparednessRating.rating}) filter (where ${preparednessRating.baseline})`,
      })
      .from(preparednessRating)
      .where(and(eq(preparednessRating.workspaceId, ws), isNotNull(preparednessRating.rating)));
    const [pulse] = await tx
      .select({
        n: count(),
        demand: avg(loadPulse.demand),
        worry: avg(loadPulse.worry),
        effort: avg(loadPulse.effort),
      })
      .from(loadPulse)
      .where(and(eq(loadPulse.workspaceId, ws), isNotNull(loadPulse.demand)));
    const [ctx] = await tx
      .select({ n: count(), avg: avg(contextTestResult.elapsedMs) })
      .from(contextTestResult)
      .where(and(eq(contextTestResult.workspaceId, ws), isNotNull(contextTestResult.elapsedMs)));
    return {
      preparedness: {
        count: prep?.n ?? 0,
        average: round(prep?.avg ?? null),
        baselineAverage: round(prep?.base ?? null),
      },
      load: {
        count: pulse?.n ?? 0,
        demand: round(pulse?.demand ?? null),
        worry: round(pulse?.worry ?? null),
        effort: round(pulse?.effort ?? null),
      },
      contextTest: { count: ctx?.n ?? 0, averageElapsedMs: round(ctx?.avg ?? null) },
    };
  });
}

export const POV_REPORT_HEADER = 'kind,member_id,period,baseline,a,b,c,elapsed_ms';

/**
 * The pilot report as CSV text, for an owner to download by hand: ids, numbers and weeks only.
 * Returned to the caller and never sent anywhere.
 */
export async function buildPovReport(deps: PovDeps, actor: PovActor): Promise<string> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role !== 'owner') throw forbidden();
  const rows = await withWorkspace(deps.db, actor, async (tx) => {
    const ws = actor.workspaceId;
    const ratings = await tx
      .select()
      .from(preparednessRating)
      .where(and(eq(preparednessRating.workspaceId, ws), isNotNull(preparednessRating.rating)));
    const pulses = await tx
      .select()
      .from(loadPulse)
      .where(and(eq(loadPulse.workspaceId, ws), isNotNull(loadPulse.demand)));
    const tests = await tx
      .select()
      .from(contextTestResult)
      .where(and(eq(contextTestResult.workspaceId, ws), isNotNull(contextTestResult.elapsedMs)));
    return { ratings, pulses, tests };
  });
  const lines = [POV_REPORT_HEADER];
  for (const r of rows.ratings)
    lines.push(
      ['preparedness', r.memberId, r.createdAt.toISOString().slice(0, 10), r.baseline, r.rating, '', '', ''].join(','),
    );
  for (const p of rows.pulses)
    lines.push(['load', p.memberId, p.isoWeek, p.baseline, p.demand, p.worry, p.effort, ''].join(','));
  for (const t of rows.tests)
    lines.push(
      ['context_test', t.memberId, t.startedAt.toISOString().slice(0, 10), '', '', '', '', t.elapsedMs].join(','),
    );
  return `${lines.join('\r\n')}\r\n`;
}

/** Guard used by the instruments for a malformed id that would reach SQL. */
export function requireUuidInput(value: string, what: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw invalid(`${what} is not a valid id`);
}
