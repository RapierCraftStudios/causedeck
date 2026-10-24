// Issue tags and judgment alerts (#497, D-048, D-004). `matter_issue_tag` rows are proposed (AI,
// `proposeTags`) or added by the lawyer (`addTag`) and drive alerts only once confirmed.
// `scanJudgments` runs for one workspace: it matches the corpus judgments added since `since`
// against the confirmed tags of its non-sensitive matters (statute and section, `matchJudgmentToTags`),
// writes one `judgment_alert` per matter and judgment (unique, so a re-run changes nothing) and
// notifies each active member who may read the matter (`judgment.alert`, dedupe key
// `judgment-alert:<matter>:<judgment>`). A sensitive matter never alerts. `listRelevantJudgments`
// keeps only alerts whose judgment `verifyCitation` resolves, so no citation is shown that does
// not resolve to the corpus. Nothing here sends, files or advises.
import { isRole } from '@causedeck/auth';
import { can, type Action, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import {
  ISSUE_MAX_TAGS,
  matchJudgmentToTags,
  normaliseSection,
  normaliseStatute,
  type ProposedIssueTag,
} from '@causedeck/intelligence';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';

import { verifyCitation } from '../citations/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

const { judgment, judgmentAlert, matter, matterIssueTag, member, organization } = schema;

/** Corpus judgments matched per workspace and run; the rest wait for the next run. */
export const SCAN_MAX_JUDGMENTS = 200;
/** How far back a scan looks for judgments when no `since` is given (covers missed runs). */
export const SCAN_LOOKBACK_DAYS = 7;

export interface ResearchActor {
  workspaceId: string;
  userId: string;
}

export interface IssueTagRow {
  id: string;
  matterId: string;
  statute: string;
  section: string;
  issue: string | null;
  status: schema.IssueTagStatus;
  source: schema.IssueTagSource;
  confidence: number | null;
}

export interface RelevantJudgment {
  alertId: string;
  judgmentId: string;
  /** The canonical neutral citation, as `verifyCitation` resolved it. */
  citation: string;
  court: string;
  judgmentDate: string | null;
  sourceUrl: string;
  /** The page of the judgment the tagged section is cited on. */
  pageNo: number;
  statute: string;
  section: string;
  createdAt: Date;
}

const matterNotFound = () => notFound('Matter not found');

/** The user id owning the matter, for a junior's "matters they own" visibility. */
const matterOwnerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;

/** Whether `reader` may read the matter: a row exists that the visibility predicate lets through. */
async function mayReadMatter(
  tx: Transaction,
  reader: Actor,
  settings: PolicySettings,
  matterId: string,
): Promise<boolean> {
  if (!can(reader, 'matter.read', undefined, settings).allow) return false;
  const rows = await tx
    .select({ id: matter.id })
    .from(matter)
    .where(
      and(
        eq(matter.workspaceId, reader.workspaceId),
        eq(matter.id, matterId),
        matterVisibilityPredicate(reader, matter.id, { settings, ownerUserId: matterOwnerUserId }),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Run `fn` as the actor's active membership; NOT_FOUND unless the matter is readable by them. */
async function asMatterMember<T>(
  db: Queryable,
  actor: ResearchActor,
  matterId: string,
  action: Extract<Action, 'matter.read' | 'matter.write'>,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId) || !isUuid(matterId)) throw matterNotFound();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw matterNotFound();
  }
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw matterNotFound();
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    const reader: Actor = { ...actor, role };
    if (!(await mayReadMatter(tx, reader, settings, matterId))) throw matterNotFound();
    if (action === 'matter.write' && !can(reader, 'matter.write', undefined, settings).allow) {
      throw forbidden('You cannot change this matter');
    }
    return fn(tx);
  });
}

const tagColumns = {
  id: matterIssueTag.id,
  matterId: matterIssueTag.matterId,
  statute: matterIssueTag.statute,
  section: matterIssueTag.section,
  issue: matterIssueTag.issue,
  status: matterIssueTag.status,
  source: matterIssueTag.source,
  confidence: matterIssueTag.confidence,
};

function toTagRow(row: Omit<IssueTagRow, 'confidence'> & { confidence: string | null }): IssueTagRow {
  return { ...row, confidence: row.confidence === null ? null : Number(row.confidence) };
}

/** The matter's issue tags, proposed first, then by statute and section. */
export async function listTags(
  db: Queryable,
  actor: ResearchActor,
  matterId: string,
): Promise<IssueTagRow[]> {
  return asMatterMember(db, actor, matterId, 'matter.read', async (tx) => {
    const rows = await tx
      .select(tagColumns)
      .from(matterIssueTag)
      .where(
        and(eq(matterIssueTag.workspaceId, actor.workspaceId), eq(matterIssueTag.matterId, matterId)),
      )
      .orderBy(
        sql`case ${matterIssueTag.status} when 'proposed' then 0 when 'confirmed' then 1 else 2 end`,
        asc(matterIssueTag.statute),
        asc(matterIssueTag.section),
      );
    return rows.map(toTagRow);
  });
}

/** The lawyer adds a tag themselves: it is confirmed at once. An existing tag is confirmed. */
export async function addTag(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; statute: string; section?: string; issue?: string | null },
): Promise<IssueTagRow> {
  const statute = normaliseStatute(input.statute);
  if (statute === '') throw invalid('Enter a statute');
  const section = normaliseSection(input.section ?? '');
  const issue = input.issue?.trim() ? input.issue.trim().slice(0, 500) : null;
  return asMatterMember(db, actor, input.matterId, 'matter.write', async (tx) => {
    const [row] = await tx
      .insert(matterIssueTag)
      .values({
        workspaceId: actor.workspaceId,
        matterId: input.matterId,
        statute,
        section,
        issue,
        status: 'confirmed',
        source: 'manual',
      })
      .onConflictDoUpdate({
        target: [
          matterIssueTag.workspaceId,
          matterIssueTag.matterId,
          matterIssueTag.statute,
          matterIssueTag.section,
        ],
        set: {
          status: 'confirmed',
          issue: sql`coalesce(${issue}, ${matterIssueTag.issue})`,
          updatedAt: new Date(),
        },
      })
      .returning(tagColumns);
    if (row === undefined) throw new Error('matter issue tag upsert returned no row');
    return toTagRow(row);
  });
}

/**
 * Store AI proposals (`extractIssueTags`) as `proposed`. A tag the matter already has, in any
 * status, is left as it is, so a dismissed tag does not come back. Returns the tags stored.
 */
export async function proposeTags(
  db: Queryable,
  actor: ResearchActor,
  matterId: string,
  tags: readonly ProposedIssueTag[],
): Promise<IssueTagRow[]> {
  const values = tags.slice(0, ISSUE_MAX_TAGS).flatMap((tag) => {
    const statute = normaliseStatute(tag.statute);
    if (statute === '') return [];
    return [
      {
        workspaceId: actor.workspaceId,
        matterId,
        statute,
        section: normaliseSection(tag.section),
        issue: tag.issue,
        status: 'proposed' as const,
        source: 'ai' as const,
        confidence: tag.confidence.toFixed(3),
      },
    ];
  });
  return asMatterMember(db, actor, matterId, 'matter.write', async (tx) => {
    if (values.length === 0) return [];
    const rows = await tx
      .insert(matterIssueTag)
      .values(values)
      .onConflictDoNothing()
      .returning(tagColumns);
    return rows.map(toTagRow);
  });
}

async function setTagStatus(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; tagId: string },
  status: Extract<schema.IssueTagStatus, 'confirmed' | 'dismissed'>,
): Promise<IssueTagRow> {
  return asMatterMember(db, actor, input.matterId, 'matter.write', async (tx) => {
    if (!isUuid(input.tagId)) throw notFound('Tag not found');
    const [row] = await tx
      .update(matterIssueTag)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(matterIssueTag.workspaceId, actor.workspaceId),
          eq(matterIssueTag.matterId, input.matterId),
          eq(matterIssueTag.id, input.tagId),
        ),
      )
      .returning(tagColumns);
    if (row === undefined) throw notFound('Tag not found');
    return toTagRow(row);
  });
}

/** The lawyer confirms a tag: from now on a judgment citing it alerts the matter's advocates. */
export function confirmTag(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; tagId: string },
): Promise<IssueTagRow> {
  return setTagStatus(db, actor, input, 'confirmed');
}

/** The lawyer dismisses a tag: it no longer alerts and is not proposed again. */
export function dismissTag(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; tagId: string },
): Promise<IssueTagRow> {
  return setTagStatus(db, actor, input, 'dismissed');
}

/**
 * The matter's judgment alerts, newest first, each re-verified: a row whose judgment
 * `verifyCitation` does not resolve to that same corpus record is left out (D-004).
 */
export async function listRelevantJudgments(
  db: Queryable,
  actor: ResearchActor,
  matterId: string,
): Promise<RelevantJudgment[]> {
  return asMatterMember(db, actor, matterId, 'matter.read', async (tx) => {
    const rows = await tx
      .select({
        alertId: judgmentAlert.id,
        judgmentId: judgmentAlert.judgmentId,
        pageNo: judgmentAlert.pageNo,
        createdAt: judgmentAlert.createdAt,
        statute: matterIssueTag.statute,
        section: matterIssueTag.section,
        neutralCitation: judgment.neutralCitation,
      })
      .from(judgmentAlert)
      .innerJoin(
        matterIssueTag,
        and(
          eq(matterIssueTag.workspaceId, judgmentAlert.workspaceId),
          eq(matterIssueTag.id, judgmentAlert.tagId),
        ),
      )
      .innerJoin(judgment, eq(judgment.id, judgmentAlert.judgmentId))
      .where(
        and(eq(judgmentAlert.workspaceId, actor.workspaceId), eq(judgmentAlert.matterId, matterId)),
      )
      .orderBy(desc(judgmentAlert.createdAt), asc(judgmentAlert.id));
    const shown: RelevantJudgment[] = [];
    for (const row of rows) {
      if (row.neutralCitation === null) continue;
      const verified = await verifyCitation(row.neutralCitation, { db: tx });
      if (verified.status !== 'VERIFIED' || verified.judgmentId !== row.judgmentId) continue;
      shown.push({
        alertId: row.alertId,
        judgmentId: row.judgmentId,
        citation: verified.citation,
        court: verified.court,
        judgmentDate: verified.judgmentDate,
        sourceUrl: verified.sourceUrl,
        pageNo: row.pageNo,
        statute: row.statute,
        section: row.section,
        createdAt: row.createdAt,
      });
    }
    return shown;
  });
}

// --- scan ------------------------------------------------------------------------------------

export interface ScanDeps {
  db: Queryable;
  /** `NotifyContext.enqueueDelivery`: sends one `notification.deliver` job. */
  enqueueDelivery: (job: DeliveryJob) => Promise<unknown>;
  now?: () => Date;
}

export interface ScanReport {
  judgments: number;
  alerts: number;
  notified: number;
}

interface PendingNotice {
  userId: string;
  matterId: string;
  judgmentId: string;
  title: string;
  body: string;
}

const LOWER_WORDS = new Set(['and', 'of', 'the']);

/** `arbitration and conciliation act` -> `Arbitration and Conciliation Act`. */
function statuteLabel(statute: string): string {
  return statute
    .split(' ')
    .map((word, i) =>
      i > 0 && LOWER_WORDS.has(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(' ');
}

/**
 * Match the corpus judgments added since `opts.since` to the workspace's confirmed tags, write the
 * alerts and notify the advocates. Idempotent: an alert exists once per matter and judgment, and
 * only newly written alerts notify. A failed notice does not stop the others.
 */
export async function scanJudgments(
  deps: ScanDeps,
  workspaceId: string,
  opts: { since?: Date } = {},
): Promise<ScanReport> {
  const report: ScanReport = { judgments: 0, alerts: 0, notified: 0 };
  if (!isUuid(workspaceId)) return report;
  const now = deps.now?.() ?? new Date();
  const since = opts.since ?? new Date(now.getTime() - SCAN_LOOKBACK_DAYS * 86_400_000);

  const outcome = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const tags = await tx
      .select({
        id: matterIssueTag.id,
        matterId: matterIssueTag.matterId,
        statute: matterIssueTag.statute,
        section: matterIssueTag.section,
      })
      .from(matterIssueTag)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, matterIssueTag.workspaceId), eq(matter.id, matterIssueTag.matterId)),
      )
      .where(
        and(
          eq(matterIssueTag.workspaceId, workspaceId),
          eq(matterIssueTag.status, 'confirmed'),
          eq(matter.sensitive, false),
        ),
      )
      .orderBy(asc(matterIssueTag.id));
    if (tags.length === 0) return null;
    const matterOf = new Map(tags.map((t) => [t.id, t.matterId]));

    const judgments = await tx
      .select({
        id: judgment.id,
        court: judgment.court,
        neutralCitation: judgment.neutralCitation,
        pageText: judgment.pageText,
      })
      .from(judgment)
      .where(and(isNotNull(judgment.neutralCitation), gte(judgment.createdAt, since)))
      .orderBy(asc(judgment.createdAt), asc(judgment.id))
      .limit(SCAN_MAX_JUDGMENTS);

    const created: { alertId: string; matterId: string; judgmentId: string; title: string; body: string }[] = [];
    for (const j of judgments) {
      if (j.neutralCitation === null) continue;
      // D-004: only a judgment that resolves to this very corpus record is alerted.
      const verified = await verifyCitation(j.neutralCitation, { db: tx });
      if (verified.status !== 'VERIFIED' || verified.judgmentId !== j.id) continue;
      const perMatter = new Map<string, { tagId: string; pageNo: number }>();
      for (const hit of matchJudgmentToTags(j.pageText, tags)) {
        const matterId = matterOf.get(hit.tagId);
        if (matterId !== undefined && !perMatter.has(matterId)) {
          perMatter.set(matterId, { tagId: hit.tagId, pageNo: hit.pageNo });
        }
      }
      for (const [matterId, hit] of perMatter) {
        const [row] = await tx
          .insert(judgmentAlert)
          .values({ workspaceId, matterId, tagId: hit.tagId, judgmentId: j.id, pageNo: hit.pageNo })
          .onConflictDoNothing()
          .returning({ id: judgmentAlert.id });
        if (row === undefined) continue;
        const tag = tags.find((t) => t.id === hit.tagId);
        const cited = `${tag?.section ? `s. ${tag.section} ` : ''}${statuteLabel(tag?.statute ?? '')}`;
        created.push({
          alertId: row.id,
          matterId,
          judgmentId: j.id,
          title: `New judgment cites ${cited}`,
          body: `${verified.citation} (${verified.court})`,
        });
      }
    }
    if (created.length === 0) return { scanned: judgments.length, created, notices: [], slug: '' };

    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    const members = await tx
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.status, 'active')))
      .orderBy(asc(member.userId));
    const notices: PendingNotice[] = [];
    for (const m of members) {
      if (!isRole(m.role)) continue;
      const reader: Actor = { userId: m.userId, workspaceId, role: m.role };
      for (const alert of created) {
        if (!(await mayReadMatter(tx, reader, settings, alert.matterId))) continue;
        notices.push({
          userId: m.userId,
          matterId: alert.matterId,
          judgmentId: alert.judgmentId,
          title: alert.title,
          body: alert.body,
        });
      }
    }
    const [org] = await tx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, workspaceId))
      .limit(1);
    return { scanned: judgments.length, created, notices, slug: org?.slug ?? '' };
  });
  if (outcome === null) return report;
  report.judgments = outcome.scanned;
  report.alerts = outcome.created.length;
  if (outcome.created.length === 0) return report;

  const notifyCtx = { db: deps.db, workspaceId, enqueueDelivery: deps.enqueueDelivery };
  for (const notice of outcome.notices) {
    try {
      await notify(notifyCtx, {
        userId: notice.userId,
        category: 'judgment.alert',
        title: notice.title,
        body: notice.body,
        href: `/w/${outcome.slug}/matters/${notice.matterId}/research`,
        dedupeKey: `judgment-alert:${notice.matterId}:${notice.judgmentId}`,
      });
      report.notified += 1;
    } catch {
      // One member's failed notice (e.g. a delivery enqueue error) must not stop the others.
    }
  }
  await withWorkspace(deps.db, { workspaceId }, (tx) =>
    tx
      .update(judgmentAlert)
      .set({ notifiedAt: now })
      .where(
        and(
          eq(judgmentAlert.workspaceId, workspaceId),
          inArray(
            judgmentAlert.id,
            outcome.created.map((a) => a.alertId),
          ),
        ),
      ),
  );
  return report;
}
