// Roster services (#387, part 3 of #39; ADR 0017). `confirmRosterImport` turns the lawyer's
// reviewed roster (#385 preview, #391 review grid) into the forum's active version in one
// transaction: benches the roster names by judges are found or created (judges normalised by
// `normaliseJudgeName`), the previous active roster is closed at the new start and marked
// `superseded`, and the new one is written `active` with its provenance (source document, importing
// member, `confirmation_state` `confirmed`). Any failure rolls the whole confirmation back. A
// version is immutable once active: `supersede` only ends it, and no service edits its entries.
// `getRosterAt` and `resolveBenchForHall` answer "which roster / bench on day D" from the active or
// superseded roster whose `[effective_from, effective_to)` contains D, so historic days resolve too.
// Writes need `matter.write` (as custom forums do); reads run in the given workspace's scope, so RLS
// limits rosters to it. Judges are compared only for equality within one forum to find a bench:
// nothing here aggregates by judge (PX-9, ME-6). No AI.
import { isRole } from '@causedeck/auth';
import { assertCan, ForbiddenError } from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import {
  ConfirmRosterImportInputSchema,
  GetRosterAtInputSchema,
  ListRostersInputSchema,
  ResolveBenchForHallInputSchema,
  SupersedeRosterInputSchema,
  type ConfirmRosterImportInput,
  type GetRosterAtInput,
  type ListRostersInput,
  type ResolveBenchForHallInput,
  type SupersedeRosterInput,
} from '@causedeck/validators/roster';
import { and, asc, desc, eq, gt, inArray, isNull, lte, max, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { ForumActor } from './forums.ts';
import { normaliseJudgeName } from './roster-import.ts';

const { bench, benchRoster, benchRosterEntry, courtHall, document, forum, member } = schema;

export type BenchRosterRow = typeof benchRoster.$inferSelect;
export type BenchRosterEntryRow = typeof benchRosterEntry.$inferSelect;
type BenchKind = typeof bench.$inferSelect.benchKind;

/** A roster version with its entries, ordered by hall number. */
export interface RosterWithEntries {
  roster: BenchRosterRow;
  entries: BenchRosterEntryRow[];
}

/** The bench sitting in a hall on a day, and the roster entry that says so. */
export interface ResolvedBench {
  rosterId: string;
  entryId: string;
  benchId: string;
  hallId: string | null;
  hallNo: string;
  portfolioText: string;
  portfolioRule: BenchRosterEntryRow['portfolioRule'];
}

/** Who is asking: the caller's role, if any, is replaced by the active membership's role. */
export type RosterActor = ForumActor;

const rosterNotFound = () => notFound('Roster not found');

function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

/** Postgres unique (23505) and exclusion (23P01) violations: a concurrent confirmation won. */
function rosterConflict(error: unknown): unknown {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  if (code === '23505' || code === '23P01') {
    return conflict('Another roster for this forum was confirmed at the same time');
  }
  return error;
}

/**
 * Runs `fn` in the actor's workspace once it holds `matter.write`: NOT_FOUND for a malformed id, a
 * non-member or a call from another workspace's scope, FORBIDDEN without the permission.
 */
async function asRosterWriter<T>(
  db: Queryable,
  actor: RosterActor,
  denied: string,
  fn: (tx: Transaction, memberId: string) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw rosterNotFound();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw rosterNotFound();
  }
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw rosterNotFound();
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    try {
      assertCan({ ...actor, role }, 'matter.write', { kind: 'roster', workspaceId }, { settings });
    } catch (error) {
      if (error instanceof ForbiddenError) throw forbidden(denied);
      throw error;
    }
    const [self] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
      .limit(1);
    if (self === undefined) throw rosterNotFound();
    try {
      return await fn(tx, self.id);
    } catch (error) {
      throw rosterConflict(error);
    }
  });
}

/** The bench of `forumId` with exactly these judges and kind, catalogue or the workspace's own. */
async function findOrCreateBench(
  tx: Transaction,
  workspaceId: string,
  forumId: string,
  judges: readonly string[],
  benchKind: BenchKind,
): Promise<string> {
  const list = sql`array[${sql.join(
    judges.map((judge) => sql`${judge}`),
    sql`, `,
  )}]::text[]`;
  const [found] = await tx
    .select({ id: bench.id })
    .from(bench)
    .where(
      and(
        eq(bench.forumId, forumId),
        eq(bench.benchKind, benchKind),
        sql`${bench.judges} = ${list}`,
      ),
    )
    // A catalogue bench before the workspace's own, then the oldest.
    .orderBy(sql`${bench.workspaceId} is not null`, asc(bench.createdAt), asc(bench.id))
    .limit(1);
  if (found !== undefined) return found.id;
  const [created] = await tx
    .insert(bench)
    .values({ workspaceId, forumId, judges: [...judges], benchKind })
    .returning({ id: bench.id });
  if (created === undefined) throw new Error('confirmRosterImport: bench insert returned no row');
  return created.id;
}

async function entriesOf(tx: Transaction, rosterId: string): Promise<BenchRosterEntryRow[]> {
  return tx
    .select()
    .from(benchRosterEntry)
    .where(eq(benchRosterEntry.rosterId, rosterId))
    .orderBy(asc(benchRosterEntry.hallNo), asc(benchRosterEntry.id));
}

/**
 * Confirm a reviewed roster as the forum's active version from `effectiveFrom`. Requires
 * `matter.write`. In one transaction: benches named by judges are found or created, the forum's
 * current active roster (if any) is closed at `effectiveFrom` and marked `superseded`, and the new
 * roster is written `active` (next version, source document, importing member, `confirmed`) with
 * all its entries. `VALIDATION` for a malformed input, a hall or bench of another forum;
 * `NOT_FOUND` for an unknown forum or document; `CONFLICT` when `effectiveFrom` does not follow the
 * current roster's start or a later active roster exists. Nothing is written unless all of it is.
 */
export async function confirmRosterImport(
  db: Queryable,
  actor: RosterActor,
  input: ConfirmRosterImportInput,
): Promise<RosterWithEntries> {
  const data = parse(ConfirmRosterImportInputSchema, input);
  const { workspaceId } = actor;
  return asRosterWriter(db, actor, 'You cannot confirm a roster', async (tx, memberId) => {
    const [visibleForum] = await tx
      .select({ id: forum.id })
      .from(forum)
      .where(eq(forum.id, data.forumId))
      .limit(1);
    if (visibleForum === undefined) throw notFound('Forum not found');
    if (data.sourceDocumentId !== undefined) {
      const [doc] = await tx
        .select({ id: document.id })
        .from(document)
        .where(eq(document.id, data.sourceDocumentId))
        .limit(1);
      if (doc === undefined) throw notFound('Document not found');
    }

    // Lock the forum's active rosters so two confirmations cannot both supersede the same one.
    const active = await tx
      .select()
      .from(benchRoster)
      .where(
        and(
          eq(benchRoster.workspaceId, workspaceId),
          eq(benchRoster.forumId, data.forumId),
          eq(benchRoster.status, 'active'),
        ),
      )
      .orderBy(desc(benchRoster.effectiveFrom))
      .for('update');
    if (active.some((r) => r.effectiveFrom >= data.effectiveFrom)) {
      throw conflict('A roster for this forum already starts on or after this date');
    }

    // Halls and benches of the forum, resolved before anything is written.
    const halls = await tx
      .select({ id: courtHall.id, hallNo: courtHall.hallNo })
      .from(courtHall)
      .where(eq(courtHall.forumId, data.forumId));
    const hallIds = new Set(halls.map((h) => h.id));
    const hallByNo = new Map(halls.map((h) => [h.hallNo.trim(), h.id]));
    const givenBenches = data.entries.flatMap((e) => (e.benchId === undefined ? [] : [e.benchId]));
    const forumBenches =
      givenBenches.length === 0
        ? new Set<string>()
        : new Set(
            (
              await tx
                .select({ id: bench.id })
                .from(bench)
                .where(and(eq(bench.forumId, data.forumId), inArray(bench.id, givenBenches)))
            ).map((b) => b.id),
          );
    const benchFor = new Map<string, string>();
    const rows: Omit<typeof benchRosterEntry.$inferInsert, 'workspaceId' | 'rosterId'>[] = [];
    for (const entry of data.entries) {
      const hallNo = entry.hallNo;
      let hallId: string | null;
      if (entry.hallId !== undefined) {
        if (!hallIds.has(entry.hallId)) throw invalid(`Hall ${hallNo} is not a hall of this forum`);
        hallId = entry.hallId;
      } else {
        hallId = hallByNo.get(hallNo) ?? null;
      }
      let benchId: string;
      if (entry.benchId !== undefined) {
        if (!forumBenches.has(entry.benchId)) {
          throw invalid(`The bench for hall ${hallNo} is not a bench of this forum`);
        }
        benchId = entry.benchId;
      } else {
        const judges = (entry.judges ?? []).map((judge) => normaliseJudgeName(judge).name);
        if (judges.some((judge) => judge === ''))
          throw invalid(`A judge of hall ${hallNo} is blank`);
        const benchKind: BenchKind =
          entry.benchKind ?? (judges.length === 1 ? 'single' : 'division');
        const key = JSON.stringify([benchKind, judges]);
        const known = benchFor.get(key);
        benchId =
          known ?? (await findOrCreateBench(tx, workspaceId, data.forumId, judges, benchKind));
        benchFor.set(key, benchId);
      }
      rows.push({
        hallId,
        hallNo,
        benchId,
        portfolioText: entry.portfolioText,
        portfolioRule: entry.portfolioRule ?? null,
      });
    }

    const now = new Date();
    // Every earlier active version ends by the new start (one that already ended keeps its end).
    for (const previous of active) {
      const effectiveTo =
        previous.effectiveTo !== null && previous.effectiveTo <= data.effectiveFrom
          ? previous.effectiveTo
          : data.effectiveFrom;
      await tx
        .update(benchRoster)
        .set({ status: 'superseded', effectiveTo, updatedAt: now })
        .where(eq(benchRoster.id, previous.id));
    }
    const [latest] = await tx
      .select({ version: max(benchRoster.version) })
      .from(benchRoster)
      .where(and(eq(benchRoster.workspaceId, workspaceId), eq(benchRoster.forumId, data.forumId)));
    const [roster] = await tx
      .insert(benchRoster)
      .values({
        workspaceId,
        forumId: data.forumId,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        status: 'active',
        version: (latest?.version ?? 0) + 1,
        sourceDocumentId: data.sourceDocumentId ?? null,
        importedBy: memberId,
        note: data.note ?? null,
        confirmationState: 'confirmed',
      })
      .returning();
    if (roster === undefined) throw new Error('confirmRosterImport: roster insert returned no row');
    await tx
      .insert(benchRosterEntry)
      .values(rows.map((row) => ({ ...row, workspaceId, rosterId: roster.id })));
    return { roster, entries: await entriesOf(tx, roster.id) };
  });
}

/**
 * End an active roster where a newer one takes over: its `effective_to` becomes `effectiveFrom`
 * and its status `superseded`; its entries are left as they are. Requires `matter.write`.
 * `NOT_FOUND` for an unknown roster, `CONFLICT` unless it is active, `VALIDATION` when the date is
 * not inside its period.
 */
export async function supersede(
  db: Queryable,
  actor: RosterActor,
  input: SupersedeRosterInput,
): Promise<BenchRosterRow> {
  const data = parse(SupersedeRosterInputSchema, input);
  return asRosterWriter(db, actor, 'You cannot supersede a roster', async (tx) => {
    const [roster] = await tx
      .select()
      .from(benchRoster)
      .where(eq(benchRoster.id, data.rosterId))
      .for('update');
    if (roster === undefined) throw rosterNotFound();
    if (roster.status !== 'active') throw conflict('Only an active roster can be superseded');
    if (
      data.effectiveFrom <= roster.effectiveFrom ||
      (roster.effectiveTo !== null && data.effectiveFrom > roster.effectiveTo)
    ) {
      throw invalid('The new roster must start within the current roster’s period');
    }
    const [row] = await tx
      .update(benchRoster)
      .set({ status: 'superseded', effectiveTo: data.effectiveFrom, updatedAt: new Date() })
      .where(eq(benchRoster.id, roster.id))
      .returning();
    if (row === undefined) throw rosterNotFound();
    return row;
  });
}

/** A confirmed roster of `forumId` whose `[effective_from, effective_to)` contains `on`. */
function coversDay(workspaceId: string, forumId: string, on: string): SQL | undefined {
  return and(
    eq(benchRoster.workspaceId, workspaceId),
    eq(benchRoster.forumId, forumId),
    inArray(benchRoster.status, ['active', 'superseded']),
    lte(benchRoster.effectiveFrom, on),
    or(isNull(benchRoster.effectiveTo), gt(benchRoster.effectiveTo, on)),
  );
}

/** Active before superseded, then the latest start and version. */
const rosterPreference = [
  sql`${benchRoster.status} = 'active' desc`,
  desc(benchRoster.effectiveFrom),
  desc(benchRoster.version),
];

/** The statement `getRosterAt` runs to pick the roster (exported for the plan and budget test). */
export function rosterAtStatement(tx: Transaction, workspaceId: string, input: GetRosterAtInput) {
  return tx
    .select()
    .from(benchRoster)
    .where(coversDay(workspaceId, input.forumId, input.on))
    .orderBy(...rosterPreference)
    .limit(1);
}

/** The statement `resolveBenchForHall` runs (exported for the plan and budget test). */
export function benchForHallStatement(
  tx: Transaction,
  workspaceId: string,
  input: ResolveBenchForHallInput,
) {
  return tx
    .select({
      rosterId: benchRoster.id,
      entryId: benchRosterEntry.id,
      benchId: benchRosterEntry.benchId,
      hallId: benchRosterEntry.hallId,
      hallNo: benchRosterEntry.hallNo,
      portfolioText: benchRosterEntry.portfolioText,
      portfolioRule: benchRosterEntry.portfolioRule,
    })
    .from(benchRoster)
    .innerJoin(
      benchRosterEntry,
      and(
        eq(benchRosterEntry.workspaceId, benchRoster.workspaceId),
        eq(benchRosterEntry.rosterId, benchRoster.id),
      ),
    )
    .where(
      and(
        coversDay(workspaceId, input.forumId, input.on),
        input.hallId !== undefined
          ? eq(benchRosterEntry.hallId, input.hallId)
          : eq(sql`btrim(${benchRosterEntry.hallNo})`, (input.hallNo ?? '').trim()),
      ),
    )
    .orderBy(...rosterPreference, asc(benchRosterEntry.id))
    .limit(1);
}

/**
 * The forum's roster in force on `on` (active, or superseded for a historic day) with its entries,
 * or null when none covers that day.
 */
export async function getRosterAt(
  db: Queryable,
  workspaceId: string,
  input: GetRosterAtInput,
): Promise<RosterWithEntries | null> {
  const data = parse(GetRosterAtInputSchema, input);
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const [roster] = await rosterAtStatement(tx, workspaceId, data);
    if (roster === undefined) return null;
    return { roster, entries: await entriesOf(tx, roster.id) };
  });
}

/**
 * The bench sitting in a hall (by id or printed number) of the forum on `on`, from the roster in
 * force that day, or null when no roster covers the day or it does not list the hall.
 */
export async function resolveBenchForHall(
  db: Queryable,
  workspaceId: string,
  input: ResolveBenchForHallInput,
): Promise<ResolvedBench | null> {
  const data = parse(ResolveBenchForHallInputSchema, input);
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const [row] = await benchForHallStatement(tx, workspaceId, data);
    return row ?? null;
  });
}

/** The workspace's roster versions (no entries), by forum, newest start and version first. */
export async function listRosters(
  db: Queryable,
  workspaceId: string,
  input: ListRostersInput = {},
): Promise<BenchRosterRow[]> {
  const data = parse(ListRostersInputSchema, input);
  return withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .select()
      .from(benchRoster)
      .where(
        and(
          eq(benchRoster.workspaceId, workspaceId),
          data.forumId === undefined ? undefined : eq(benchRoster.forumId, data.forumId),
          data.status === undefined ? undefined : eq(benchRoster.status, data.status),
        ),
      )
      .orderBy(
        asc(benchRoster.forumId),
        desc(benchRoster.effectiveFrom),
        desc(benchRoster.version),
      ),
  );
}
