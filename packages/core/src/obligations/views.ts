// Read models of the obligation surface (#68): the queue with the names and quote a row shows,
// the registry defects and the certified copies the Defects and Copies tabs list, and the matters
// and members the filters and the reassign menu offer. All run in the actor's workspace scope and
// keep to matters the actor may read (`visibleMatters`), like `queryQueue`; nothing here writes.
import { can } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import type { QueueQuery } from '@causedeck/validators/obligation';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { activeMember } from '../shared/membership.ts';

import {
  inObligationScope,
  visibleMatters,
  type ObligationActor,
  type ObligationDeps,
  type ObligationRow,
  type ObligationScope,
} from './context.ts';
import { queryQueue, type QueueResult } from './queue.ts';

const {
  anchor,
  certifiedCopy,
  defect,
  matter,
  matterRestriction,
  member,
  obligation,
  proceeding,
  user,
} = schema;

/** A queue row with what the screen shows besides the row itself. */
export interface ObligationView extends ObligationRow {
  matterTitle: string;
  /** `WP 1234/2026`; null until the proceeding has a number (or when there is none). */
  caseNumber: string | null;
  ownerName: string | null;
  /** The quote of the source line the obligation was read from. */
  sourceQuote: string | null;
}

export type QueueViewResult = { [G in keyof QueueResult]: ObligationView[] };

export interface DefectView {
  id: string;
  obligationId: string;
  matterId: string;
  matterTitle: string;
  caseNumber: string | null;
  description: string;
  raisedOn: string;
  cureBy: string;
  curedOn: string | null;
  proceedingState: (typeof proceeding.$inferSelect)['state'];
}

export interface CertifiedCopyView {
  id: string;
  obligationId: string;
  matterId: string;
  matterTitle: string;
  caseNumber: string | null;
  status: (typeof certifiedCopy.$inferSelect)['status'];
  appliedOn: string;
  readyOn: string | null;
  collectedOn: string | null;
  /** The follow-up date of the copy's open obligation, if it is still open. */
  nextDue: string | null;
}

export interface ObligationOptions {
  matters: { id: string; title: string }[];
  members: { id: string; name: string }[];
}

const canRead = (scope: ObligationScope) =>
  can(scope.actor, 'obligation.read', undefined, scope.settings).allow;

/** `WP 1234/2026`, or null when the proceeding has no number yet. */
export function caseNumberOf(p: {
  caseTypeCode: string | null;
  number: string | null;
  year: number | null;
}): string | null {
  if (p.number === null || p.caseTypeCode === null) return null;
  return `${p.caseTypeCode} ${p.number}${p.year === null ? '' : `/${String(p.year)}`}`;
}

const emptyView = (): QueueViewResult => ({
  overdue: [],
  today: [],
  this_week: [],
  later: [],
  undated: [],
});

/** `queryQueue` plus the matter title, case number, owner name and source quote of each row. */
export async function queryQueueView(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: QueueQuery = {},
): Promise<QueueViewResult> {
  const queue = await queryQueue(deps, actor, input);
  const rows = Object.values(queue).flat();
  if (rows.length === 0) return emptyView();
  const extras = await inObligationScope(deps, actor, async (scope) => {
    const found = await scope.tx
      .select({
        id: obligation.id,
        matterTitle: matter.title,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        ownerName: user.name,
        quote: anchor.quote,
      })
      .from(obligation)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, obligation.workspaceId), eq(matter.id, obligation.matterId)),
      )
      .leftJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, obligation.workspaceId),
          eq(proceeding.id, obligation.proceedingId),
        ),
      )
      .leftJoin(
        member,
        and(
          eq(member.organizationId, obligation.workspaceId),
          eq(member.id, obligation.ownerMemberId),
        ),
      )
      .leftJoin(user, eq(user.id, member.userId))
      .leftJoin(
        anchor,
        and(eq(anchor.workspaceId, obligation.workspaceId), eq(anchor.id, obligation.anchorId)),
      )
      .where(
        and(
          eq(obligation.workspaceId, scope.actor.workspaceId),
          inArray(
            obligation.id,
            rows.map((r) => r.id),
          ),
        ),
      );
    return new Map(found.map((f) => [f.id, f]));
  });
  const out = emptyView();
  for (const group of Object.keys(queue) as (keyof QueueResult)[]) {
    out[group] = queue[group].map((row) => {
      const x = extras.get(row.id);
      return {
        ...row,
        matterTitle: x?.matterTitle ?? '',
        caseNumber:
          x === undefined
            ? null
            : caseNumberOf({ caseTypeCode: x.caseTypeCode, number: x.number, year: x.year }),
        ownerName: x?.ownerName ?? null,
        sourceQuote: x?.quote ?? null,
      };
    });
  }
  return out;
}

/** Open defects first by cure-by date, then the cured ones, newest first. */
export async function listDefects(
  deps: ObligationDeps,
  actor: ObligationActor,
): Promise<DefectView[]> {
  return inObligationScope(deps, actor, async (scope) => {
    if (!canRead(scope)) return [];
    const rows = await scope.tx
      .select({
        d: defect,
        matterId: matter.id,
        matterTitle: matter.title,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        state: proceeding.state,
      })
      .from(defect)
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, defect.workspaceId),
          eq(proceeding.id, defect.proceedingId),
        ),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .leftJoin(
        matterRestriction,
        and(
          eq(matterRestriction.workspaceId, matter.workspaceId),
          eq(matterRestriction.matterId, matter.id),
        ),
      )
      .where(and(eq(defect.workspaceId, scope.actor.workspaceId), visibleMatters(scope)))
      .orderBy(asc(defect.curedOn), asc(defect.cureBy), asc(defect.id))
      .limit(200);
    return rows.map((r) => ({
      id: r.d.id,
      obligationId: r.d.obligationId,
      matterId: r.matterId,
      matterTitle: r.matterTitle,
      caseNumber: caseNumberOf(r),
      description: r.d.description,
      raisedOn: r.d.raisedOn,
      cureBy: r.d.cureBy,
      curedOn: r.d.curedOn,
      proceedingState: r.state,
    }));
  });
}

/** Copies still in flight first (applied, then ready), collected ones last. */
export async function listCertifiedCopies(
  deps: ObligationDeps,
  actor: ObligationActor,
): Promise<CertifiedCopyView[]> {
  return inObligationScope(deps, actor, async (scope) => {
    if (!canRead(scope)) return [];
    const rows = await scope.tx
      .select({
        c: certifiedCopy,
        matterId: matter.id,
        matterTitle: matter.title,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        dueDate: obligation.dueDate,
        obligationStatus: obligation.status,
      })
      .from(certifiedCopy)
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, certifiedCopy.workspaceId),
          eq(proceeding.id, certifiedCopy.proceedingId),
        ),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .innerJoin(
        obligation,
        and(
          eq(obligation.workspaceId, certifiedCopy.workspaceId),
          eq(obligation.id, certifiedCopy.obligationId),
        ),
      )
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .leftJoin(
        matterRestriction,
        and(
          eq(matterRestriction.workspaceId, matter.workspaceId),
          eq(matterRestriction.matterId, matter.id),
        ),
      )
      .where(and(eq(certifiedCopy.workspaceId, scope.actor.workspaceId), visibleMatters(scope)))
      .orderBy(asc(isNull(certifiedCopy.collectedOn)), desc(certifiedCopy.appliedOn))
      .limit(200);
    return rows.map((r) => ({
      id: r.c.id,
      obligationId: r.c.obligationId,
      matterId: r.matterId,
      matterTitle: r.matterTitle,
      caseNumber: caseNumberOf(r),
      status: r.c.status,
      appliedOn: r.c.appliedOn,
      readyOn: r.c.readyOn,
      collectedOn: r.c.collectedOn,
      nextDue: r.obligationStatus === 'open' ? r.dueDate : null,
    }));
  });
}

/** The matters the actor may read and the active members: the filters and the reassign menu. */
export async function obligationOptions(
  deps: ObligationDeps,
  actor: ObligationActor,
): Promise<ObligationOptions> {
  return inObligationScope(deps, actor, async (scope) => {
    if (!canRead(scope)) return { matters: [], members: [] };
    const matters = await scope.tx
      .select({ id: matter.id, title: matter.title })
      .from(matter)
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .leftJoin(
        matterRestriction,
        and(
          eq(matterRestriction.workspaceId, matter.workspaceId),
          eq(matterRestriction.matterId, matter.id),
        ),
      )
      .where(and(eq(matter.workspaceId, scope.actor.workspaceId), visibleMatters(scope)))
      .orderBy(asc(matter.title))
      .limit(200);
    const members = await scope.tx
      .select({ id: member.id, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, scope.actor.workspaceId), activeMember))
      .orderBy(asc(user.name));
    return { matters, members };
  });
}
