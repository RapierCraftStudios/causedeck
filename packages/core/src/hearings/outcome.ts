// The hearing outcome (#62, PRD EX-3). `getOutcomeProposal` assembles what the confirmation screen
// shows from the hearing, the proceeding's open voice proposals (linked by proceeding + held-on date,
// the proposal table has no hearing id) and the stored transcript. `confirmOutcome` applies what the
// lawyer decided in one transaction: the hearing, the canonical next date (only through the
// matter-graph services, L2: a date is never set without a human resolution), the confirmed
// obligations and tasks, the proposals they resolve and the audit event. Nothing is applied
// automatically and a rolled-back call emits nothing.
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import {
  ManualOutcomeInput,
  OutcomeConfirmation,
  nextDateRejection,
  type OutcomeProposal,
} from '@causedeck/validators/hearing-outcome';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../audit/index.ts';
import {
  chooseNextDateSource,
  confirmNextDate,
  crossWorkspace,
  getCanonicalNextDate,
  proposeNextDate,
  type GraphEvent,
  type MatterGraphDeps,
} from '../matter-graph/index.ts';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

const { anchor, appearance, document, hearing, listing, matter, matterRestriction, member } =
  schema;
const { obligation, proceeding, proposal, task } = schema;

/** Emitted once a confirmed outcome has committed; `notifyUserId` is the owner of a delegated appearance. */
export interface HearingOutcomeConfirmedEvent {
  type: 'hearing.outcome_confirmed';
  workspaceId: string;
  actorUserId: string;
  matterId: string;
  proceedingId: string;
  hearingId: string;
  sensitive: boolean;
  notifyUserId: string | null;
}

export type HearingEvent = HearingOutcomeConfirmedEvent;

export interface HearingEvents {
  emit(event: HearingEvent | GraphEvent): void;
}

export interface HearingDeps {
  db: Database | Transaction;
  events: HearingEvents;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  now?: () => Date;
}

export interface HearingActor {
  workspaceId: string;
  userId: string;
}

export interface ConfirmedOutcome {
  hearingId: string;
  /** The canonical next date after the call, if the lawyer resolved one. */
  nextDate: string | null;
  obligationIds: string[];
  taskIds: string[];
}

const HearingRef = z.strictObject({ hearingId: z.uuid() });
const LANGUAGES = ['en', 'ta', 'kn'] as const;

function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

interface Scope {
  tx: Transaction;
  actor: Actor;
  settings: PolicySettings;
  events: (HearingEvent | GraphEvent)[];
}

async function inScope<T>(
  deps: HearingDeps,
  actor: HearingActor,
  fn: (scope: Scope) => Promise<T>,
): Promise<T> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Hearing not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw crossWorkspace();
  }
  const events: Scope['events'] = [];
  const { workspaceId, userId } = actor;
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Hearing not found');
    const settings = deps.settings ?? toPolicySettings(await getRoleSettings(tx, workspaceId));
    return fn({ tx, actor: { workspaceId, userId, role }, settings, events });
  });
  for (const event of events) deps.events.emit(event);
  return result;
}

interface Loaded {
  hearing: typeof hearing.$inferSelect;
  proceedingId: string;
  matterId: string;
  sensitive: boolean;
  ownerUserId: string | null;
  /**
   * The actor the matter policy sees: a member who appeared at this hearing is assigned to its matter,
   * so a delegated junior passes the matter-graph services' reads too, not only this file's check.
   */
  actor: Scope['actor'];
}

/** The hearing with its matter, or NOT_FOUND (also when the actor may not read the matter); FORBIDDEN to write without rights. */
async function load(
  scope: Scope,
  hearingId: string,
  action: 'matter.read' | 'matter.write',
): Promise<Loaded> {
  const { tx, actor, settings } = scope;
  const [row] = await tx
    .select({
      hearing,
      proceedingId: listing.proceedingId,
      matterId: proceeding.matterId,
      sensitive: matter.sensitive,
      ownerUserId: member.userId,
      allowUserIds: matterRestriction.allowedUserIds,
    })
    .from(hearing)
    .innerJoin(
      listing,
      and(eq(listing.workspaceId, hearing.workspaceId), eq(listing.id, hearing.listingId)),
    )
    .innerJoin(
      proceeding,
      and(eq(proceeding.workspaceId, listing.workspaceId), eq(proceeding.id, listing.proceedingId)),
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
    .where(and(eq(hearing.workspaceId, actor.workspaceId), eq(hearing.id, hearingId)))
    .limit(1);
  if (row === undefined) throw notFound('Hearing not found');
  // A member who appeared at this hearing is assigned to its matter for this screen.
  const [appeared] = await tx
    .select({ id: appearance.id })
    .from(appearance)
    .innerJoin(
      member,
      and(eq(member.organizationId, appearance.workspaceId), eq(member.id, appearance.memberId)),
    )
    .where(
      and(
        eq(appearance.workspaceId, actor.workspaceId),
        eq(appearance.hearingId, hearingId),
        eq(member.userId, actor.userId),
      ),
    )
    .limit(1);
  const policyActor =
    appeared === undefined ? actor : { ...actor, assignedMatterIds: new Set([row.matterId]) };
  const resource = {
    kind: 'matter' as const,
    workspaceId: actor.workspaceId,
    matterId: row.matterId,
    ...(row.allowUserIds === null ? {} : { restricted: { allowUserIds: row.allowUserIds } }),
    ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
  };
  if (!can(policyActor, 'matter.read', resource, settings).allow)
    throw notFound('Hearing not found');
  if (action === 'matter.write' && !can(policyActor, action, resource, settings).allow) {
    throw forbidden('You cannot confirm this outcome');
  }
  return {
    hearing: row.hearing,
    proceedingId: row.proceedingId,
    matterId: row.matterId,
    sensitive: row.sensitive,
    ownerUserId: row.ownerUserId,
    actor: policyActor,
  };
}

type ProposalRow = typeof proposal.$inferSelect;

/** The proceeding's open proposals for this hearing: its `hearing_outcome` draft and that capture's drafts. */
async function openProposals(scope: Scope, loaded: Loaded): Promise<ProposalRow[]> {
  const { tx, actor } = scope;
  const open = await tx
    .select()
    .from(proposal)
    .where(
      and(
        eq(proposal.workspaceId, actor.workspaceId),
        eq(proposal.proceedingId, loaded.proceedingId),
        eq(proposal.status, 'proposed'),
        inArray(proposal.kind, [
          'hearing_outcome',
          'next_date',
          'obligation_from_direction',
          'task',
        ]),
      ),
    )
    .orderBy(desc(proposal.createdAt));
  const heldOn = loaded.hearing.heldOn;
  const captureIds = new Set(
    open
      .filter((p) => p.kind === 'hearing_outcome' && p.payload['hearingDate'] === heldOn)
      .map((p) => p.captureId),
  );
  return open.filter((p) => captureIds.has(p.captureId));
}

const anchorIds = (p: ProposalRow): string[] =>
  p.anchors.filter((a): a is string => typeof a === 'string');

/** Dates the anchored proposals carry: the only ones a `proposal` next date may take. */
const anchoredDates = (proposals: readonly ProposalRow[]): string[] =>
  proposals.flatMap((p) => {
    const date = p.payload['date'];
    return p.kind === 'next_date' && typeof date === 'string' && anchorIds(p).length > 0
      ? [date]
      : [];
  });

const text = (payload: ProposalRow['payload'], key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
};

/**
 * What the confirmation screen reads. Needs `matter.read`; the strategy text (outcome, reason, stage,
 * obligations, tasks) only for roles with `strategy.read`. No open proposal is `processing`, an
 * unanchored or low-confidence one is `needs_you` (its unanchored fields stay blank).
 */
export async function getOutcomeProposal(
  deps: HearingDeps,
  actor: HearingActor,
  input: { hearingId: string },
): Promise<OutcomeProposal> {
  const { hearingId } = parse(HearingRef, input);
  return inScope(deps, actor, async (scope) => {
    const { tx, settings } = scope;
    const loaded = await load(scope, hearingId, 'matter.read');
    const who = loaded.actor;
    const proposals = await openProposals(scope, loaded);
    const confirmed = loaded.hearing.confirmationState === 'confirmed';
    const strategy = can(who, 'strategy.read', undefined, settings).allow;
    const anchorsById = new Map<string, { documentId: string; quote: string | null }>();
    const ids = [...new Set(proposals.flatMap(anchorIds))];
    if (ids.length > 0) {
      const rows = await tx
        .select({ id: anchor.id, documentId: anchor.documentId, quote: anchor.quote })
        .from(anchor)
        .where(and(eq(anchor.workspaceId, who.workspaceId), inArray(anchor.id, ids)));
      for (const row of rows) anchorsById.set(row.id, row);
    }
    const line = <T>(p: ProposalRow | undefined, value: T | null) => {
      const anchorId = p === undefined ? undefined : anchorIds(p)[0];
      if (value === null || anchorId === undefined) return undefined;
      return {
        value,
        anchorId,
        quote: anchorsById.get(anchorId)?.quote ?? null,
        source: 'voice' as const,
      };
    };
    const outcomeDraft = proposals.find((p) => p.kind === 'hearing_outcome');
    const dateDraft = proposals.find((p) => p.kind === 'next_date');
    const summary = line(outcomeDraft, text(outcomeDraft?.payload ?? {}, 'outcome'));
    const reason = line(outcomeDraft, text(outcomeDraft?.payload ?? {}, 'adjournmentReason'));
    const stage = line(outcomeDraft, text(outcomeDraft?.payload ?? {}, 'stageAfter'));
    const date = line(dateDraft, text(dateDraft?.payload ?? {}, 'date'));
    const firstAnchor = ids.map((id) => anchorsById.get(id)).find((a) => a !== undefined);
    let language: (typeof LANGUAGES)[number] = 'en';
    if (firstAnchor !== undefined) {
      const [doc] = await tx
        .select({ language: document.language })
        .from(document)
        .where(
          and(eq(document.workspaceId, who.workspaceId), eq(document.id, firstAnchor.documentId)),
        )
        .limit(1);
      const found = LANGUAGES.find((l) => l === doc?.language);
      if (found !== undefined) language = found;
    }
    const canonical = await getCanonicalNextDate(deps, who, { proceedingId: loaded.proceedingId });
    const proposedListingId = dateDraft?.entityRefs['listingId'];
    const clash =
      canonical !== null &&
      canonical.confirmationState === 'confirmed' &&
      date !== undefined &&
      canonical.listDate !== date.value
        ? {
            currentListingId: canonical.id,
            currentDate: canonical.listDate,
            currentSource: canonical.sourceType,
            proposedListingId: typeof proposedListingId === 'string' ? proposedListingId : null,
            proposedDate: date.value,
          }
        : null;
    const state: OutcomeProposal['state'] =
      proposals.length === 0
        ? confirmed
          ? 'empty'
          : 'processing'
        : proposals.some((p) => p.needsYou)
          ? 'needs_you'
          : 'ready';
    return {
      hearingId,
      matterId: loaded.matterId,
      proceedingId: loaded.proceedingId,
      heldOn: loaded.hearing.heldOn,
      state,
      ...(strategy && summary !== undefined ? { summary } : {}),
      ...(strategy && reason !== undefined ? { adjournmentReason: reason } : {}),
      ...(date === undefined ? {} : { nextDate: date }),
      ...(strategy && stage !== undefined ? { stageAfter: stage } : {}),
      conflict: clash,
      obligations: strategy
        ? proposals
            .filter((p) => p.kind === 'obligation_from_direction')
            .map((p) => ({
              proposalId: p.id,
              description: text(p.payload, 'description') ?? '',
              dueDate: text(p.payload, 'dueDate'),
              basis: text(p.payload, 'basis'),
              anchorId: anchorIds(p)[0] ?? null,
              quote: anchorsById.get(anchorIds(p)[0] ?? '')?.quote ?? null,
              ownerMemberId: null,
            }))
            .filter((o) => o.description !== '')
        : [],
      tasks: strategy
        ? proposals
            .filter((p) => p.kind === 'task')
            .map((p) => ({
              proposalId: p.id,
              title: text(p.payload, 'title') ?? '',
              anchorId: anchorIds(p)[0] ?? null,
              quote: anchorsById.get(anchorIds(p)[0] ?? '')?.quote ?? null,
            }))
            .filter((t) => t.title !== '')
        : [],
      transcriptRef:
        firstAnchor === undefined ? null : { documentId: firstAnchor.documentId, language },
      language,
      confirmed,
    };
  });
}

/** The graph deps for a nested call: this transaction, with events held until the scope resolves. */
function graphDeps(deps: HearingDeps, scope: Scope): MatterGraphDeps {
  return {
    db: scope.tx,
    events: { emit: (event) => scope.events.push(event) },
    settings: scope.settings,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };
}

/**
 * Apply what the lawyer decided about a hearing, all or nothing. Needs `matter.write`. The next date
 * needs an explicit resolution; a `proposal` date must be one the anchored proposals carry. A proposed
 * date that differs from the confirmed canonical one is a conflict and needs `conflictChoice`: the
 * canonical date stays until it is chosen. Undecided proposals stay open; dismissals record a reason.
 */
export async function confirmOutcome(
  deps: HearingDeps,
  actor: HearingActor,
  input: OutcomeConfirmation,
): Promise<ConfirmedOutcome> {
  const data = parse(OutcomeConfirmation, input);
  return inScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    const loaded = await load(scope, data.hearingId, 'matter.write');
    const who = loaded.actor;
    if (loaded.hearing.confirmationState === 'confirmed') {
      throw conflict('This hearing outcome is already confirmed');
    }
    const proposals = await openProposals(scope, loaded);
    const byId = new Map(proposals.map((p) => [p.id, p]));
    const rejection = nextDateRejection(data.nextDate, anchoredDates(proposals));
    if (rejection !== null) throw invalid(`nextDate: ${rejection}`);
    const graph = graphDeps(deps, scope);
    const now = (deps.now ?? (() => new Date()))();
    const dateDraft = proposals.find((p) => p.kind === 'next_date');

    // The canonical next date, only through the matter-graph services.
    let nextDate: string | null = null;
    let conflictChoice: string | null = null;
    const proposedDate = data.nextDate.kind === 'date' ? data.nextDate.date : null;
    if (data.nextDate.kind === 'date') {
      const fromProposal = data.nextDate.source === 'proposal';
      const staged = await proposeNextDate(graph, who, {
        proceedingId: loaded.proceedingId,
        date: data.nextDate.date,
        provenance: {
          sourceType: fromProposal ? 'capture' : 'manual',
          ...(fromProposal && dateDraft !== undefined && anchorIds(dateDraft)[0] !== undefined
            ? { anchorId: anchorIds(dateDraft)[0] }
            : {}),
        },
      });
      if (staged.kind === 'proposal') {
        nextDate = (await confirmNextDate(graph, who, { listingId: staged.listingId })).listDate;
      } else if (staged.kind === 'noop') {
        const current = await getCanonicalNextDate(graph, who, {
          proceedingId: loaded.proceedingId,
        });
        if (current === null) throw new Error('confirmOutcome: noop without a canonical date');
        nextDate = (await confirmNextDate(graph, who, { listingId: current.id })).listDate;
      } else {
        if (data.conflictChoice === undefined) {
          throw invalid('conflictChoice: Choose which next date to keep');
        }
        conflictChoice = data.conflictChoice;
        const chosen = await chooseNextDateSource(graph, who, {
          currentListingId: staged.current.listingId,
          proposedListingId: staged.proposed.listingId,
          choice: data.conflictChoice,
        });
        nextDate = chosen.listDate;
      }
    }

    await tx
      .update(hearing)
      .set({
        outcome: data.outcome,
        adjournmentReason: data.adjournmentReason ?? null,
        stageAfterRaw: data.stageAfter ?? null,
        nextDateProposed: proposedDate,
        nextDateConfirmed: nextDate,
        confirmationState: 'confirmed',
        updatedAt: now,
      })
      .where(and(eq(hearing.workspaceId, workspaceId), eq(hearing.id, data.hearingId)));

    const resolve = async (
      p: ProposalRow,
      status: 'accepted' | 'edited' | 'dismissed',
      reason: string | null,
    ) => {
      await tx
        .update(proposal)
        .set({ status, resolvedBy: userId, resolvedAt: now, resolutionReason: reason })
        .where(and(eq(proposal.workspaceId, workspaceId), eq(proposal.id, p.id)));
    };
    const draftOf = (
      proposalId: string | null,
      kind: ProposalRow['kind'],
    ): ProposalRow | undefined => {
      if (proposalId === null) return undefined;
      const found = byId.get(proposalId);
      if (found === undefined || found.kind !== kind) {
        throw invalid('proposalId: This proposal is not open for this hearing');
      }
      return found;
    };

    const obligationIds: string[] = [];
    for (const decision of data.obligations) {
      const draft = draftOf(decision.proposalId, 'obligation_from_direction');
      if (decision.action === 'dismiss') {
        if (draft !== undefined) await resolve(draft, 'dismissed', decision.reason ?? null);
        continue;
      }
      const edited = decision.action === 'edit';
      const description = decision.description ?? text(draft?.payload ?? {}, 'description');
      if (description === null) throw invalid('description: Describe the obligation');
      const anchorId = draft === undefined ? undefined : anchorIds(draft)[0];
      const [row] = await tx
        .insert(obligation)
        .values({
          workspaceId,
          matterId: loaded.matterId,
          proceedingId: loaded.proceedingId,
          source: draft === undefined ? 'internal' : 'order_direction',
          description,
          dueDate:
            decision.dueDate !== undefined
              ? decision.dueDate
              : text(draft?.payload ?? {}, 'dueDate'),
          basis: text(draft?.payload ?? {}, 'basis'),
          ownerMemberId: decision.ownerMemberId ?? null,
          status: 'open',
          sourceType: draft === undefined ? 'manual' : 'capture',
          ...(anchorId === undefined ? {} : { anchorId }),
          confirmationState: edited ? 'corrected' : 'confirmed',
        })
        .returning({ id: obligation.id });
      if (row === undefined) throw new Error('confirmOutcome: obligation insert returned no row');
      obligationIds.push(row.id);
      if (draft !== undefined) await resolve(draft, edited ? 'edited' : 'accepted', null);
    }

    const taskIds: string[] = [];
    for (const decision of data.tasks) {
      const draft = draftOf(decision.proposalId, 'task');
      if (decision.action === 'dismiss') {
        if (draft !== undefined) await resolve(draft, 'dismissed', decision.reason ?? null);
        continue;
      }
      const edited = decision.action === 'edit';
      const title = decision.title ?? text(draft?.payload ?? {}, 'title');
      if (title === null) throw invalid('title: Name the task');
      const anchorId = draft === undefined ? undefined : anchorIds(draft)[0];
      const [row] = await tx
        .insert(task)
        .values({
          workspaceId,
          matterId: loaded.matterId,
          proceedingId: loaded.proceedingId,
          title,
          dueDate: decision.dueDate ?? null,
          status: 'open',
          sourceType: draft === undefined ? 'manual' : 'capture',
          ...(anchorId === undefined ? {} : { anchorId }),
          confirmationState: edited ? 'corrected' : 'confirmed',
        })
        .returning({ id: task.id });
      if (row === undefined) throw new Error('confirmOutcome: task insert returned no row');
      taskIds.push(row.id);
      if (draft !== undefined) await resolve(draft, edited ? 'edited' : 'accepted', null);
    }

    // The outcome and next-date drafts are settled by this confirmation.
    for (const p of proposals) {
      if (p.kind === 'hearing_outcome') await resolve(p, 'accepted', null);
      if (p.kind === 'next_date') {
        await resolve(
          p,
          nextDate === proposedDate && proposedDate !== null ? 'accepted' : 'dismissed',
          null,
        );
      }
    }

    await record(
      { db: tx, workspaceId, actor: { userId, kind: 'user' } },
      {
        action: 'hearing.outcome_confirmed',
        target: { kind: 'hearing', id: data.hearingId },
        metadata: {
          proceedingId: loaded.proceedingId,
          nextDateKind: data.nextDate.kind,
          conflictChoice,
          obligations: obligationIds.length,
          tasks: taskIds.length,
          dismissed:
            data.obligations.filter((d) => d.action === 'dismiss').length +
            data.tasks.filter((d) => d.action === 'dismiss').length,
        },
      },
    );

    // A junior who appeared for the lawyer notifies the matter's owner.
    const [delegated] = await tx
      .select({ id: appearance.id })
      .from(appearance)
      .innerJoin(
        member,
        and(eq(member.organizationId, appearance.workspaceId), eq(member.id, appearance.memberId)),
      )
      .where(
        and(
          eq(appearance.workspaceId, workspaceId),
          eq(appearance.hearingId, data.hearingId),
          eq(appearance.capacity, 'for_other'),
          eq(member.userId, userId),
        ),
      )
      .limit(1);
    scope.events.push({
      type: 'hearing.outcome_confirmed',
      workspaceId,
      actorUserId: userId,
      matterId: loaded.matterId,
      proceedingId: loaded.proceedingId,
      hearingId: data.hearingId,
      sensitive: loaded.sensitive,
      notifyUserId:
        delegated !== undefined && loaded.ownerUserId !== null && loaded.ownerUserId !== userId
          ? loaded.ownerUserId
          : null,
    });
    return { hearingId: data.hearingId, nextDate, obligationIds, taskIds };
  });
}

/** The L0 path: a typed note and a next date with no voice note or proposals; the same confirm path. */
export function recordManualOutcome(
  deps: HearingDeps,
  actor: HearingActor,
  input: ManualOutcomeInput,
): Promise<ConfirmedOutcome> {
  const data = parse(ManualOutcomeInput, input);
  return confirmOutcome(deps, actor, { ...data, obligations: [], tasks: [] });
}
