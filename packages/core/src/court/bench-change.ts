// Bench-change alerts (#389, part 4 of #39; ADR 0017). `detectBenchChanges` compares a confirmed
// roster R with the forum's previous confirmed roster P (the latest start before R's) and writes one
// `bench_change_alert` per proceeding whose bench R changes:
//   - `hall`: the proceeding has a listing in R's period (on or after its `effective_from`) in a hall
//     whose R entry names another bench than P's entry for that hall (none when P lacks the hall);
//   - `portfolio`: the proceeding (not disposed) matches the structured `portfolioRule` of another
//     bench under R than under P. Case types and the year range are compared; proceedings carry no
//     subject tags, so `subjectTags` is not evaluated, and several matching benches resolve to none.
// The hall reason wins when both apply. The first roster of a forum is the baseline: no alerts.
// The unique (proceeding, roster) key makes a re-run write nothing, notify nobody and emit nothing.
// Benches are compared by id only: judges are never read, grouped, counted or ranked (PX-9, ME-6).
//
// Once the detection commits, every created alert emits `bench.changed` through the injected
// `CourtEvents` port (for the court-day reminders, #64), and each active member is notified through
// `notify()` (#23, category `reminder.hearing`) about the alerts on matters they may read: a
// counts-only title ("2 matters have a bench change from 05 Oct"), with party names in the body only
// when they turned on `notification_setting.bench_alert_party_names`. No AI.
import { isRole } from '@causedeck/auth';
import {
  assertCan,
  can,
  ForbiddenError,
  type Actor,
  type PolicySettings,
} from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import { notify, type NotifyContext } from '@causedeck/notifications';
import {
  DetectBenchChangesInputSchema,
  DismissBenchChangeAlertInputSchema,
  ListBenchChangeAlertsInputSchema,
  type DetectBenchChangesInput,
  type DismissBenchChangeAlertInput,
  type ListBenchChangeAlertsInput,
} from '@causedeck/validators/roster';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { CourtEvents, CourtEvent } from './events.ts';
import type { BenchRosterEntryRow, RosterActor } from './rosters.ts';

const {
  benchChangeAlert,
  benchRoster,
  benchRosterEntry,
  listing,
  matter,
  member,
  notificationSetting,
  organization,
  proceeding,
} = schema;

export type BenchChangeAlertRow = typeof benchChangeAlert.$inferSelect;
type BenchChangeReason = BenchChangeAlertRow['reason'];

/** What `detectBenchChanges` is given besides the actor and the input. */
export interface BenchChangeDeps {
  events: CourtEvents;
  /** Sends one `notification.deliver` job (`NotifyContext.enqueueDelivery`). */
  enqueueDelivery: NotifyContext['enqueueDelivery'];
}

const alertNotFound = () => notFound('Bench-change alert not found');
const rosterNotFound = () => notFound('Roster not found');

/** The longest notification body `notify()` accepts. */
const BODY_MAX = 2000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

interface CourtScope {
  tx: Transaction;
  actor: Actor;
  settings: PolicySettings;
}

/**
 * Runs `fn` in the actor's workspace once it holds `action`: NOT_FOUND for a malformed id, a
 * non-member or a call from another workspace's scope, FORBIDDEN without the permission.
 */
async function asCourtMember<T>(
  db: Queryable,
  actor: RosterActor,
  action: 'matter.read' | 'matter.write',
  denied: string,
  notFoundError: () => Error,
  fn: (scope: CourtScope) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw notFoundError();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw notFoundError();
  }
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFoundError();
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    const resolved: Actor = { ...actor, role };
    try {
      assertCan(resolved, action, { kind: 'roster', workspaceId }, { settings });
    } catch (error) {
      if (error instanceof ForbiddenError) throw forbidden(denied);
      throw error;
    }
    return fn({ tx, actor: resolved, settings });
  });
}

/** The user id owning the proceeding's matter, for a junior's "matters they own" visibility. */
const proceedingOwnerUserId = sql`(select ${member.userId} from ${matter} join ${member} on ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId} where ${matter.workspaceId} = ${proceeding.workspaceId} and ${matter.id} = ${proceeding.matterId})`;

/** Rows whose proceeding's matter `actor` may read. */
function proceedingVisible(actor: Actor, settings: PolicySettings): SQL {
  return matterVisibilityPredicate(actor, proceeding.matterId, {
    settings,
    ownerUserId: proceedingOwnerUserId,
  });
}

/** A case type compared as stored: upper-case, no dots, whitespace, hyphens or underscores. */
const caseTypeKey = (raw: string) => raw.toUpperCase().replace(/[.\s\-_]/g, '');

/** Whether every structured key of `rule` the proceeding can be checked against matches it. */
export function portfolioRuleMatches(
  rule: BenchRosterEntryRow['portfolioRule'],
  target: { caseTypeCode: string; year: number | null },
): boolean {
  if (rule === null) return false;
  const { caseTypes, yearFrom, yearTo } = rule;
  // `subjectTags` cannot be checked (proceedings carry none): a rule needs a case type or a year.
  if (caseTypes === undefined && yearFrom === undefined && yearTo === undefined) return false;
  if (caseTypes !== undefined) {
    const code = caseTypeKey(target.caseTypeCode);
    if (!caseTypes.some((type) => caseTypeKey(type) === code)) return false;
  }
  if (yearFrom !== undefined && (target.year === null || target.year < yearFrom)) return false;
  if (yearTo !== undefined && (target.year === null || target.year > yearTo)) return false;
  return true;
}

/** The single bench whose portfolio takes the proceeding, or null for none or several. */
function portfolioBench(
  entries: readonly BenchRosterEntryRow[],
  target: { caseTypeCode: string; year: number | null },
): string | null {
  const benches = new Set(
    entries.filter((e) => portfolioRuleMatches(e.portfolioRule, target)).map((e) => e.benchId),
  );
  return benches.size === 1 ? ([...benches][0] ?? null) : null;
}

/** The bench each linked hall's entry names (the first entry by hall number for a hall). */
function benchByHall(entries: readonly BenchRosterEntryRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.hallId !== null && !map.has(entry.hallId)) map.set(entry.hallId, entry.benchId);
  }
  return map;
}

async function entriesOf(tx: Transaction, rosterId: string): Promise<BenchRosterEntryRow[]> {
  return tx
    .select()
    .from(benchRosterEntry)
    .where(eq(benchRosterEntry.rosterId, rosterId))
    .orderBy(asc(benchRosterEntry.hallNo), asc(benchRosterEntry.id));
}

/** `2026-10-05` → `05 Oct`, the same in every locale. */
export function benchChangeDay(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${day ?? ''} ${MONTHS[Number(month) - 1] ?? ''}`.trim();
}

/** The counts-only title: "2 matters have a bench change from 05 Oct". */
export function benchChangeTitle(matters: number, effectiveFrom: string): string {
  const subject = matters === 1 ? '1 matter has' : `${String(matters)} matters have`;
  return `${subject} a bench change from ${benchChangeDay(effectiveFrom)}`;
}

interface Change {
  oldBenchId: string | null;
  newBenchId: string;
  reason: BenchChangeReason;
}

interface PendingNotice {
  userId: string;
  title: string;
  body: string;
}

/**
 * Write the bench-change alerts roster `rosterId` causes (see the header), then emit `bench.changed`
 * per created alert and notify the members who may read the matters. Requires `matter.write`.
 * `NOT_FOUND` for an unknown roster; `CONFLICT` unless it is active or superseded. Returns only the
 * alerts this call created: a re-run returns none.
 */
export async function detectBenchChanges(
  db: Queryable,
  actor: RosterActor,
  input: DetectBenchChangesInput,
  deps: BenchChangeDeps,
): Promise<BenchChangeAlertRow[]> {
  const data = parse(DetectBenchChangesInputSchema, input);
  const { workspaceId } = actor;
  const outcome = await asCourtMember(
    db,
    actor,
    'matter.write',
    'You cannot check a roster for bench changes',
    rosterNotFound,
    async ({ tx }) => {
      const [roster] = await tx
        .select()
        .from(benchRoster)
        .where(eq(benchRoster.id, data.rosterId))
        .limit(1);
      if (roster === undefined) throw rosterNotFound();
      if (roster.status !== 'active' && roster.status !== 'superseded') {
        throw conflict('Only a confirmed roster can be checked for bench changes');
      }
      const [previous] = await tx
        .select()
        .from(benchRoster)
        .where(
          and(
            eq(benchRoster.workspaceId, workspaceId),
            eq(benchRoster.forumId, roster.forumId),
            inArray(benchRoster.status, ['active', 'superseded']),
            lt(benchRoster.effectiveFrom, roster.effectiveFrom),
          ),
        )
        .orderBy(desc(benchRoster.effectiveFrom), desc(benchRoster.version))
        .limit(1);
      if (previous === undefined) return null;

      const newEntries = await entriesOf(tx, roster.id);
      const oldEntries = await entriesOf(tx, previous.id);
      const changes = new Map<string, Change>();

      // Hall: a listing in R's period in a hall whose bench R changes.
      const newByHall = benchByHall(newEntries);
      const oldByHall = benchByHall(oldEntries);
      const listings = await tx
        .select({ proceedingId: listing.proceedingId, hallId: listing.hallId })
        .from(listing)
        .innerJoin(
          proceeding,
          and(
            eq(proceeding.workspaceId, listing.workspaceId),
            eq(proceeding.id, listing.proceedingId),
          ),
        )
        .where(
          and(
            eq(listing.workspaceId, workspaceId),
            eq(proceeding.forumId, roster.forumId),
            gte(listing.listDate, roster.effectiveFrom),
            roster.effectiveTo === null ? undefined : lt(listing.listDate, roster.effectiveTo),
            isNotNull(listing.hallId),
          ),
        )
        .orderBy(asc(listing.listDate), asc(listing.id));
      for (const row of listings) {
        if (changes.has(row.proceedingId) || row.hallId === null) continue;
        const newBenchId = newByHall.get(row.hallId);
        if (newBenchId === undefined) continue;
        const oldBenchId = oldByHall.get(row.hallId) ?? null;
        if (newBenchId !== oldBenchId) {
          changes.set(row.proceedingId, { oldBenchId, newBenchId, reason: 'hall' });
        }
      }

      // Portfolio: the proceeding's case type and year now map to another bench.
      const proceedings = await tx
        .select({ id: proceeding.id, caseTypeCode: proceeding.caseTypeCode, year: proceeding.year })
        .from(proceeding)
        .where(
          and(
            eq(proceeding.workspaceId, workspaceId),
            eq(proceeding.forumId, roster.forumId),
            ne(proceeding.state, 'disposed'),
          ),
        )
        .orderBy(asc(proceeding.id));
      for (const row of proceedings) {
        if (changes.has(row.id)) continue;
        const newBenchId = portfolioBench(newEntries, row);
        if (newBenchId === null) continue;
        const oldBenchId = portfolioBench(oldEntries, row);
        if (newBenchId !== oldBenchId) {
          changes.set(row.id, { oldBenchId, newBenchId, reason: 'portfolio' });
        }
      }

      if (changes.size === 0) return null;
      const created = await tx
        .insert(benchChangeAlert)
        .values(
          [...changes].map(([proceedingId, change]) => ({
            workspaceId,
            proceedingId,
            rosterId: roster.id,
            ...change,
          })),
        )
        .onConflictDoNothing({ target: [benchChangeAlert.proceedingId, benchChangeAlert.rosterId] })
        .returning();
      if (created.length === 0) return null;
      created.sort((a, b) => a.proceedingId.localeCompare(b.proceedingId));

      const createdIds = created.map((a) => a.proceedingId);
      const subjects = await tx
        .select({
          id: proceeding.id,
          matterId: proceeding.matterId,
          sensitive: matter.sensitive,
          petitioner: proceeding.titlePetitioner,
          respondent: proceeding.titleRespondent,
        })
        .from(proceeding)
        .innerJoin(
          matter,
          and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
        )
        .where(and(eq(proceeding.workspaceId, workspaceId), inArray(proceeding.id, createdIds)));
      const subjectOf = new Map(subjects.map((s) => [s.id, s]));

      const events: CourtEvent[] = created.map((alert) => ({
        type: 'bench.changed',
        workspaceId,
        actorUserId: actor.userId,
        matterId: subjectOf.get(alert.proceedingId)?.matterId ?? '',
        sensitive: subjectOf.get(alert.proceedingId)?.sensitive ?? false,
        proceedingId: alert.proceedingId,
        alertId: alert.id,
        rosterId: roster.id,
        forumId: roster.forumId,
        effectiveFrom: roster.effectiveFrom,
        oldBenchId: alert.oldBenchId,
        newBenchId: alert.newBenchId,
        reason: alert.reason,
      }));

      const notices = await noticesFor(
        tx,
        workspaceId,
        createdIds,
        roster.effectiveFrom,
        subjectOf,
      );
      const [org] = await tx
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, workspaceId))
        .limit(1);
      return { created, events, notices, slug: org?.slug ?? '', rosterId: roster.id };
    },
  );
  if (outcome === null) return [];

  for (const event of outcome.events) deps.events.emit(event);
  const notifyCtx = { db, workspaceId, enqueueDelivery: deps.enqueueDelivery };
  for (const notice of outcome.notices) {
    try {
      await notify(notifyCtx, {
        userId: notice.userId,
        category: 'reminder.hearing',
        title: notice.title,
        ...(notice.body === '' ? {} : { body: notice.body }),
        href: `/w/${outcome.slug}/courts`,
        dedupeKey: `bench-change:${outcome.rosterId}`,
      });
    } catch {
      // One member's failed notice (e.g. a delivery enqueue error) must not stop the others.
    }
  }
  return outcome.created;
}

/** One notice per active member who may read at least one changed matter. */
async function noticesFor(
  tx: Transaction,
  workspaceId: string,
  proceedingIds: readonly string[],
  effectiveFrom: string,
  subjectOf: ReadonlyMap<
    string,
    { matterId: string; petitioner: string | null; respondent: string | null }
  >,
): Promise<PendingNotice[]> {
  const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
  const members = await tx
    .select({
      userId: member.userId,
      role: member.role,
      partyNames: notificationSetting.benchAlertPartyNames,
    })
    .from(member)
    .leftJoin(
      notificationSetting,
      and(
        eq(notificationSetting.workspaceId, member.organizationId),
        eq(notificationSetting.userId, member.userId),
      ),
    )
    .where(and(eq(member.organizationId, workspaceId), eq(member.status, 'active')))
    .orderBy(asc(member.userId));
  const notices: PendingNotice[] = [];
  for (const m of members) {
    if (!isRole(m.role)) continue;
    const reader: Actor = { userId: m.userId, workspaceId, role: m.role };
    if (!can(reader, 'matter.read', undefined, settings).allow) continue;
    const visible = await tx
      .select({ id: proceeding.id })
      .from(proceeding)
      .where(
        and(
          eq(proceeding.workspaceId, workspaceId),
          inArray(proceeding.id, [...proceedingIds]),
          proceedingVisible(reader, settings),
        ),
      )
      .orderBy(asc(proceeding.id));
    if (visible.length === 0) continue;
    const seen = visible.flatMap((v) => {
      const subject = subjectOf.get(v.id);
      return subject === undefined ? [] : [subject];
    });
    const matters = new Set(seen.map((s) => s.matterId)).size;
    let body = '';
    if (m.partyNames === true) {
      const names = [
        ...new Set(
          seen.flatMap((s) =>
            s.petitioner === null && s.respondent === null
              ? []
              : [`${s.petitioner ?? '—'} v ${s.respondent ?? '—'}`],
          ),
        ),
      ];
      body = names.join('; ').slice(0, BODY_MAX);
    }
    notices.push({ userId: m.userId, title: benchChangeTitle(matters, effectiveFrom), body });
  }
  return notices;
}

/**
 * The workspace's bench-change alerts on matters the actor may read, newest first, narrowed by
 * status, roster or proceeding. Requires `matter.read`; NOT_FOUND for a non-member or a call from
 * another workspace's scope.
 */
export async function listAlerts(
  db: Queryable,
  actor: RosterActor,
  input: ListBenchChangeAlertsInput = {},
): Promise<BenchChangeAlertRow[]> {
  const data = parse(ListBenchChangeAlertsInputSchema, input);
  return asCourtMember(
    db,
    actor,
    'matter.read',
    'You cannot see bench-change alerts',
    alertNotFound,
    async ({ tx, actor: resolved, settings }) => {
      const rows = await tx
        .select({ alert: benchChangeAlert })
        .from(benchChangeAlert)
        .innerJoin(
          proceeding,
          and(
            eq(proceeding.workspaceId, benchChangeAlert.workspaceId),
            eq(proceeding.id, benchChangeAlert.proceedingId),
          ),
        )
        .where(
          and(
            eq(benchChangeAlert.workspaceId, resolved.workspaceId),
            data.status === undefined ? undefined : eq(benchChangeAlert.status, data.status),
            data.rosterId === undefined ? undefined : eq(benchChangeAlert.rosterId, data.rosterId),
            data.proceedingId === undefined
              ? undefined
              : eq(benchChangeAlert.proceedingId, data.proceedingId),
            proceedingVisible(resolved, settings),
          ),
        )
        .orderBy(desc(benchChangeAlert.createdAt), desc(benchChangeAlert.id));
      return rows.map((r) => r.alert);
    },
  );
}

/**
 * Dismiss an alert (idempotent). Requires `matter.write`; NOT_FOUND for an unknown alert or one on a
 * matter the actor may not read.
 */
export async function dismissAlert(
  db: Queryable,
  actor: RosterActor,
  input: DismissBenchChangeAlertInput,
): Promise<BenchChangeAlertRow> {
  const data = parse(DismissBenchChangeAlertInputSchema, input);
  return asCourtMember(
    db,
    actor,
    'matter.write',
    'You cannot dismiss a bench-change alert',
    alertNotFound,
    async ({ tx, actor: resolved, settings }) => {
      const [found] = await tx
        .select({ id: benchChangeAlert.id })
        .from(benchChangeAlert)
        .innerJoin(
          proceeding,
          and(
            eq(proceeding.workspaceId, benchChangeAlert.workspaceId),
            eq(proceeding.id, benchChangeAlert.proceedingId),
          ),
        )
        .where(
          and(
            eq(benchChangeAlert.workspaceId, resolved.workspaceId),
            eq(benchChangeAlert.id, data.alertId),
            proceedingVisible(resolved, settings),
          ),
        )
        .limit(1);
      if (found === undefined) throw alertNotFound();
      const [row] = await tx
        .update(benchChangeAlert)
        .set({ status: 'dismissed', updatedAt: new Date() })
        .where(eq(benchChangeAlert.id, found.id))
        .returning();
      if (row === undefined) throw alertNotFound();
      return row;
    },
  );
}
