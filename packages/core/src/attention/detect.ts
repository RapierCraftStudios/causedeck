// `detectAttention` (#70): rule-based, explainable stale-matter flags. One fixed set of batched
// queries (matters, proceedings, listings with their hearings, order and obligation activity,
// snoozes), however many matters there are; the rules (`rules.ts`) are pure. Detection only reads:
// it never writes a matter, listing, hearing or obligation, and sends nothing. A matter that is
// disposed, archived or merged is never scanned. A dismissal ("intentionally dormant") holds until
// the matter gets an event newer than it; a snooze holds through its end day. A junior sees flags of
// the matters they may read (assigned, listed or owned), a clerk gets date-only evidence, a viewer
// reads. Only the workspace's own graph is read (RLS).
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import {
  ATTENTION_RULES,
  ATTENTION_STALE_DAYS_DEFAULT,
  AttentionQuery,
  type AttentionFlag,
} from '@causedeck/validators/attention';
import { and, eq, inArray, max, sql, type SQL } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { activeMember } from '../shared/membership.ts';
import { localDay } from '../obligations/index.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import {
  evaluateRules,
  type ListingFact,
  type MatterFacts,
  type RuleContext,
  type RuleHit,
} from './rules.ts';

const {
  matter,
  member,
  proceeding,
  listing,
  hearing,
  order,
  obligation,
  obligationEvent,
  attentionSnooze,
  workspaceSettings,
} = schema;

export interface AttentionDeps {
  db: Database | Transaction;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The clock; the system clock when omitted. */
  now?: () => Date;
  /** The workspace's time zone for "today"; IST when omitted. */
  timeZone?: string;
}

export interface AttentionActor {
  workspaceId: string;
  userId: string;
}

export interface AttentionScope {
  tx: Transaction;
  actor: Actor;
  memberId: string;
  settings: PolicySettings;
  now: Date;
}

/** Run `fn` in the actor's workspace scope with the resolved role and member. */
export async function inAttentionScope<T>(
  deps: AttentionDeps,
  actor: AttentionActor,
  fn: (scope: AttentionScope) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw notFound('Matter not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw forbidden('Call made from inside another workspace');
  }
  return withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Matter not found');
    const [self] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId), activeMember))
      .limit(1);
    if (self === undefined) throw notFound('Matter not found');
    const settings = deps.settings ?? toPolicySettings(await getRoleSettings(tx, workspaceId));
    return fn({
      tx,
      actor: { workspaceId, userId, role },
      memberId: self.id,
      settings,
      now: deps.now?.() ?? new Date(),
    });
  });
}

/** The workspace's stale threshold in days (the default when it has no settings row). */
export async function loadStaleDays(tx: Transaction, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ days: workspaceSettings.attentionStaleDays })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row?.days ?? ATTENTION_STALE_DAYS_DEFAULT;
}

interface SnoozeFact {
  rule: string | null;
  until: string | null;
  dismissed: boolean;
  createdAt: Date;
}

const later = (a: Date | null, b: Date | null | undefined): Date | null =>
  b === null || b === undefined ? a : a === null || b.getTime() > a.getTime() ? b : a;

/** True when an active snooze or a still-valid dismissal covers `rule` on the matter. */
export function isSilenced(
  snoozes: readonly SnoozeFact[],
  rule: string,
  today: string,
  lastEventAt: Date | null,
): boolean {
  return snoozes.some((s) => {
    if (s.rule !== null && s.rule !== rule) return false;
    if (s.dismissed) return lastEventAt === null || lastEventAt.getTime() <= s.createdAt.getTime();
    return s.until !== null && s.until >= today;
  });
}

interface LoadOptions {
  workspaceId: string;
  today: string;
  staleDays: number;
  /** SQL keeping the matters the reader may see; none for a workspace-wide system scan. */
  visible?: SQL;
  matterId?: string;
  rules?: readonly string[];
  redact: boolean;
}

/** The batched query set and the rules: every flag of the visible live matters. */
export async function loadFlags(tx: Transaction, o: LoadOptions): Promise<AttentionFlag[]> {
  const matterRows = await tx
    .select({
      id: matter.id,
      title: matter.title,
      openedAt: matter.openedAt,
      updatedAt: matter.updatedAt,
    })
    .from(matter)
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .where(
      and(
        eq(matter.workspaceId, o.workspaceId),
        eq(matter.status, 'active'),
        sql`${matter.mergedIntoMatterId} is null`,
        o.matterId === undefined ? undefined : eq(matter.id, o.matterId),
        o.visible,
      ),
    );
  if (matterRows.length === 0) return [];
  const ids = matterRows.map((m) => m.id);

  const [proceedings, listings, orders, obligations, obligationEvents, snoozes] = await Promise.all(
    [
      tx
        .select({ id: proceeding.id, matterId: proceeding.matterId, state: proceeding.state })
        .from(proceeding)
        .where(and(eq(proceeding.workspaceId, o.workspaceId), inArray(proceeding.matterId, ids))),
      tx
        .select({
          id: listing.id,
          matterId: proceeding.matterId,
          proceedingId: listing.proceedingId,
          listDate: listing.listDate,
          stageRaw: listing.stageRaw,
          outcome: hearing.outcome,
          nextDateConfirmed: hearing.nextDateConfirmed,
          hearingAt: hearing.updatedAt,
          listingAt: listing.updatedAt,
        })
        .from(listing)
        .innerJoin(
          proceeding,
          and(
            eq(proceeding.workspaceId, listing.workspaceId),
            eq(proceeding.id, listing.proceedingId),
          ),
        )
        .leftJoin(
          hearing,
          and(eq(hearing.workspaceId, listing.workspaceId), eq(hearing.listingId, listing.id)),
        )
        .where(and(eq(listing.workspaceId, o.workspaceId), inArray(proceeding.matterId, ids))),
      tx
        .select({ matterId: proceeding.matterId, at: max(order.updatedAt) })
        .from(order)
        .innerJoin(
          proceeding,
          and(eq(proceeding.workspaceId, order.workspaceId), eq(proceeding.id, order.proceedingId)),
        )
        .where(and(eq(order.workspaceId, o.workspaceId), inArray(proceeding.matterId, ids)))
        .groupBy(proceeding.matterId),
      tx
        .select({
          id: obligation.id,
          matterId: obligation.matterId,
          status: obligation.status,
          dueDate: obligation.dueDate,
          ownerMemberId: obligation.ownerMemberId,
          updatedAt: obligation.updatedAt,
        })
        .from(obligation)
        .where(and(eq(obligation.workspaceId, o.workspaceId), inArray(obligation.matterId, ids))),
      tx
        .select({ matterId: obligation.matterId, at: max(obligationEvent.at) })
        .from(obligationEvent)
        .innerJoin(
          obligation,
          and(
            eq(obligation.workspaceId, obligationEvent.workspaceId),
            eq(obligation.id, obligationEvent.obligationId),
          ),
        )
        .where(
          and(eq(obligationEvent.workspaceId, o.workspaceId), inArray(obligation.matterId, ids)),
        )
        .groupBy(obligation.matterId),
      tx
        .select({
          matterId: attentionSnooze.matterId,
          rule: attentionSnooze.rule,
          until: attentionSnooze.until,
          dismissed: attentionSnooze.dismissed,
          createdAt: attentionSnooze.createdAt,
        })
        .from(attentionSnooze)
        .where(
          and(
            eq(attentionSnooze.workspaceId, o.workspaceId),
            inArray(attentionSnooze.matterId, ids),
          ),
        ),
    ],
  );

  const byMatter = <T extends { matterId: string }>(rows: readonly T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.matterId, [...(map.get(row.matterId) ?? []), row]);
    return map;
  };
  const proceedingsBy = byMatter(proceedings);
  const listingsBy = byMatter(listings);
  const obligationsBy = byMatter(obligations);
  const snoozesBy = byMatter(snoozes);
  const orderAt = new Map(orders.map((r) => [r.matterId, r.at]));
  const eventAt = new Map(obligationEvents.map((r) => [r.matterId, r.at]));
  const ctx: RuleContext = { today: o.today, staleDays: o.staleDays };
  const wanted = o.rules === undefined ? null : new Set(o.rules);

  const flags: AttentionFlag[] = [];
  for (const m of matterRows) {
    const rows = listingsBy.get(m.id) ?? [];
    let lastEventAt = later(null, m.updatedAt);
    lastEventAt = later(lastEventAt, orderAt.get(m.id));
    lastEventAt = later(lastEventAt, eventAt.get(m.id));
    for (const r of rows) lastEventAt = later(later(lastEventAt, r.hearingAt), r.listingAt);
    const mine = obligationsBy.get(m.id) ?? [];
    for (const ob of mine) lastEventAt = later(lastEventAt, ob.updatedAt);

    const livePs = new Set(
      (proceedingsBy.get(m.id) ?? []).filter((p) => p.state !== 'disposed').map((p) => p.id),
    );
    const byListing = new Map<string, ListingFact>();
    const upcoming: string[] = [];
    for (const r of rows) {
      if (livePs.has(r.proceedingId)) {
        if (r.listDate >= o.today) upcoming.push(r.listDate);
        if (r.nextDateConfirmed !== null && r.nextDateConfirmed >= o.today) {
          upcoming.push(r.nextDateConfirmed);
        }
      }
      const seen = byListing.get(r.id);
      const hasOutcome = r.outcome !== null || r.nextDateConfirmed !== null;
      byListing.set(r.id, {
        id: r.id,
        proceedingId: r.proceedingId,
        listDate: r.listDate,
        stageRaw: r.stageRaw,
        hasOutcome: hasOutcome || seen?.hasOutcome === true,
      });
    }
    const facts: MatterFacts = {
      matterId: m.id,
      title: m.title,
      lastEventAt,
      openedAt: m.openedAt,
      proceedings: (proceedingsBy.get(m.id) ?? []).map((p) => ({ id: p.id, state: p.state })),
      upcomingDates: upcoming,
      listings: [...byListing.values()],
      obligations: mine
        .filter((ob) => ob.status === 'open')
        .map((ob) => ({ id: ob.id, dueDate: ob.dueDate, ownerMemberId: ob.ownerMemberId })),
    };
    const mySnoozes = snoozesBy.get(m.id) ?? [];
    for (const hit of evaluateRules(facts, ctx)) {
      if (wanted !== null && !wanted.has(hit.rule)) continue;
      if (isSilenced(mySnoozes, hit.rule, o.today, lastEventAt)) continue;
      flags.push(toFlag(m.id, m.title, hit, o.redact));
    }
  }
  const rank = (rule: string) => ATTENTION_RULES.indexOf(rule as (typeof ATTENTION_RULES)[number]);
  return flags.sort(
    (a, b) =>
      rank(a.rule) - rank(b.rule) || a.since.localeCompare(b.since) || a.key.localeCompare(b.key),
  );
}

function toFlag(
  matterId: string,
  matterTitle: string,
  hit: RuleHit,
  redact: boolean,
): AttentionFlag {
  return {
    key: `${matterId}:${hit.rule}:${hit.subjectId ?? '-'}`,
    matterId,
    matterTitle,
    rule: hit.rule,
    evidence: redact ? hit.redactedEvidence : hit.evidence,
    since: hit.since,
    suggestedAction: hit.suggestedAction,
    actionKind: hit.actionKind,
    subjectId: hit.subjectId,
  };
}

/** Every flag the actor may see, grouped by the order of the rules and oldest first. */
export async function detectAttention(
  deps: AttentionDeps,
  actor: AttentionActor,
  input: AttentionQuery = {},
): Promise<AttentionFlag[]> {
  const parsed = AttentionQuery.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  const query = parsed.data;
  return inAttentionScope(deps, actor, async (scope) => {
    if (
      !can(
        scope.actor,
        'matter.read',
        { kind: 'matter', workspaceId: actor.workspaceId },
        scope.settings,
      ).allow
    ) {
      return [];
    }
    const staleDays = await loadStaleDays(scope.tx, actor.workspaceId);
    return loadFlags(scope.tx, {
      workspaceId: actor.workspaceId,
      today: localDay(scope.now, deps.timeZone),
      staleDays,
      visible: matterVisibilityPredicate(scope.actor, matter.id, {
        settings: scope.settings,
        ownerUserId: member.userId,
      }),
      ...(query.matterId === undefined ? {} : { matterId: query.matterId }),
      ...(query.rules === undefined ? {} : { rules: query.rules }),
      redact: scope.actor.role === 'clerk',
    });
  });
}

/** The number of flags the actor may see: counts only (the digest and the matters-list badge). */
export async function countAttention(deps: AttentionDeps, actor: AttentionActor): Promise<number> {
  return (await detectAttention(deps, actor)).length;
}

/** Counts by rule for the whole workspace (the nightly scan): no person, no text. */
export async function scanWorkspaceAttention(
  deps: Pick<AttentionDeps, 'db' | 'now' | 'timeZone'>,
  workspaceId: string,
): Promise<Record<string, number>> {
  return withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const flags = await loadFlags(tx, {
      workspaceId,
      today: localDay(deps.now?.() ?? new Date(), deps.timeZone),
      staleDays: await loadStaleDays(tx, workspaceId),
      redact: true,
    });
    const counts: Record<string, number> = {};
    for (const flag of flags) counts[flag.rule] = (counts[flag.rule] ?? 0) + 1;
    return counts;
  });
}
