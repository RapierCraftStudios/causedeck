// Apply a confirmed bootstrap import plan (#57 part 3, #549): matters, proceedings, listings,
// hearings, orders, obligations and document attachments are written through the matter-graph
// services in chunked savepoints, each fact stamped `import` provenance (confirmed, or corrected
// when the lawyer edited it). Idempotent by (batchId, planHash). Every matter writes one L3
// activity under a shared cascade group (rooted at a batch activity) so `undoImportBatch` can
// reverse the whole batch within 7 days. A plan matter that names a proceeding the workspace already
// has is offered as a merge, never created twice; one that touches a sensitive matter is excluded
// unless the lawyer includes it. Only counts are logged.
import { createHash } from 'node:crypto';

import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { ORDER_TYPES } from '@causedeck/validators/matter-graph';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import {
  confirmNextDate,
  createMatter,
  createProceeding,
  findDuplicateProceedings,
  proposeNextDate,
  type GraphActor,
  type MatterGraphDeps,
  type ProceedingRow,
} from '../matter-graph/index.ts';
import { conflict, invalid, notFound } from '../shared/errors.ts';

import {
  batchCostPaise,
  documentPageCounts,
  recordBatchUsage,
  splitByOcrAllowance,
} from './entitlements.ts';
import type {
  ApplyDecisions,
  ApplyDuplicate,
  ApplyResult,
  ImportPlan,
  PlanMatter,
  PlanProceeding,
} from './plan-types.ts';

export const IMPORT_UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CHUNK = 25;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ApplyDeps extends MatterGraphDeps {
  /** Counts only: never row content. */
  log?: (event: string, counts: Record<string, number>) => void;
}

/** What `undoImportBatch` needs to reverse one matter's writes. */
export interface MatterUndoPayload {
  matterId: string;
  matterCreated: boolean;
  proceedingIds: string[];
  listingIds: string[];
  hearingIds: string[];
  orderIds: string[];
  obligationIds: string[];
  documents: { id: string; unreadBySystem: boolean }[];
}

/** The cascade group (and root activity id) of a batch: derived, so a repeated apply finds it. */
export function importGroupId(batchId: string): string {
  const h = createHash('sha256').update(`import-batch:${batchId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Stable JSON: object keys sorted, so the same plan and decisions always hash the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashPlan(plan: ImportPlan, decisions: ApplyDecisions): string {
  return createHash('sha256').update(stable({ plan, decisions })).digest('hex');
}

function parentsFirst(items: readonly PlanProceeding[]): PlanProceeding[] {
  const byKey = new Map(items.map((p) => [p.key, p]));
  const out: PlanProceeding[] = [];
  const seen = new Set<string>();
  const visit = (p: PlanProceeding): void => {
    if (seen.has(p.key)) return;
    seen.add(p.key);
    const parent = p.parentKey === null ? undefined : byKey.get(p.parentKey);
    if (parent !== undefined) visit(parent);
    out.push(p);
  };
  items.forEach(visit);
  return out;
}

interface Prepared {
  matter: PlanMatter;
  corrected: boolean;
  targetMatterId: string | null;
  existing: Map<string, ProceedingRow>;
}

const emptyCreated = (): ApplyResult['created'] => ({
  matters: 0,
  proceedings: 0,
  listings: 0,
  hearings: 0,
  orders: 0,
  obligations: 0,
  documents: 0,
});

/**
 * Apply the stored plan of `batchId` with the lawyer's `decisions`. The same plan and decisions
 * again return the first result and write nothing; a different plan on an applied batch is a
 * CONFLICT. A blocking issue the decisions do not resolve is VALIDATION.
 */
export async function applyImportPlan(
  deps: ApplyDeps,
  actor: GraphActor,
  input: { batchId: string; decisions?: ApplyDecisions },
): Promise<ApplyResult> {
  const { workspaceId, userId } = actor;
  const { batchId } = input;
  const decisions = input.decisions ?? {};
  const events: Parameters<MatterGraphDeps['events']['emit']>[0][] = [];
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const { importBatch, importPlan, activity } = schema;
    const now = (deps.now ?? (() => new Date()))();
    const gdeps: MatterGraphDeps = { ...deps, db: tx, events: { emit: (e) => events.push(e) } };
    const [batch] = await tx
      .select()
      .from(importBatch)
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)))
      .for('update');
    if (batch === undefined) throw notFound('Import batch not found');
    const [stored] = await tx
      .select({ plan: importPlan.plan })
      .from(importPlan)
      .where(and(eq(importPlan.workspaceId, workspaceId), eq(importPlan.batchId, batchId)));
    if (stored === undefined) throw conflict('This batch has no plan to apply');
    const plan = stored.plan as unknown as ImportPlan;
    const planHash = hashPlan(plan, decisions);
    const groupId = importGroupId(batchId);
    if (batch.status === 'applied') {
      if (batch.planHash !== planHash) throw conflict('This batch was applied with another plan');
      const [root] = await tx
        .select({ source: activity.source })
        .from(activity)
        .where(and(eq(activity.workspaceId, workspaceId), eq(activity.id, groupId)));
      const first = (root?.source as { result?: ApplyResult } | undefined)?.result;
      if (first === undefined) throw conflict('The first result of this batch is missing');
      return first;
    }
    if (batch.status !== 'ready') throw conflict('Only a batch that is ready can be applied');

    const out: ApplyResult = {
      batchId,
      planHash,
      rootActivityId: groupId,
      created: emptyCreated(),
      duplicates: [],
      excluded: [],
      sensitiveDocumentIds: [],
      attachedUnreadDocumentIds: [],
      unresolvedProceedingKeys: [],
      costPaise: 0,
    };
    const resolved = decisions.resolvedDates ?? {};
    const chosen = plan.matters.filter((m) => {
      if ((decisions.matters?.[m.tempId]?.action ?? 'apply') === 'skip') {
        out.excluded.push({ matterTempId: m.tempId, reason: 'skipped' });
        return false;
      }
      return true;
    });
    for (const m of chosen) {
      const open = m.issues.find(
        (i) =>
          i.blocking && (i.proceedingKey === undefined || resolved[i.proceedingKey] === undefined),
      );
      if (open !== undefined) throw invalid('Resolve the blocking issues before applying');
    }

    // Documents of the batch's captures: where they sit now, and which are still unread.
    const captureIds = [
      ...new Set(plan.matters.flatMap((m) => m.sources.flatMap((s) => s.captureId ?? []))),
    ];
    const docs = await loadDocuments(tx, workspaceId, captureIds);
    const sensitiveIds = await sensitiveMatters(tx, workspaceId, [
      ...new Set(docs.flatMap((d) => d.matterId ?? [])),
    ]);
    const unread = docs.filter((d) => d.textStatus === 'pending' && d.matterId === null);
    const pages = await documentPageCounts(
      tx,
      workspaceId,
      unread.map((d) => d.id),
    );
    const allowance = await splitByOcrAllowance(
      { db: tx, workspaceId, now: () => now },
      unread.map((d) => ({ id: d.id, pages: pages.get(d.id) ?? 1 })),
    );
    const attachOnly = new Set(allowance.attachOnly);

    // Duplicates and sensitive matters are settled before anything is written.
    const prepared: Prepared[] = [];
    for (const m of chosen) {
      const decision = decisions.matters?.[m.tempId];
      const existing = new Map<string, ProceedingRow>();
      for (const p of m.proceedings) {
        const forumId = await forumOf(tx, workspaceId, p.forumCode);
        if (p.caseType === null || forumId === null) continue;
        const [dup] = await findDuplicateProceedings(gdeps, actor, {
          identity: {
            forumId,
            caseType: p.caseType,
            ...(p.caseNumber === null ? {} : { number: p.caseNumber }),
            ...(p.caseYear === null ? {} : { year: p.caseYear }),
            ...(p.cnr === null ? {} : { cnr: p.cnr }),
          },
          limit: 1,
        });
        if (dup !== undefined) existing.set(p.key, dup);
      }
      const dupMatters = new Set([...existing.values()].map((row) => row.matterId));
      for (const id of await sensitiveMatters(tx, workspaceId, [...dupMatters])) {
        sensitiveIds.add(id);
      }
      const touched = [...dupMatters, ...docs.filter(inMatter(m)).flatMap((d) => d.matterId ?? [])];
      const sensitive = touched.some((id) => sensitiveIds.has(id));
      for (const d of docs.filter(inMatter(m))) {
        if (d.matterId !== null && sensitiveIds.has(d.matterId))
          out.sensitiveDocumentIds.push(d.id);
      }
      if (sensitive && !(decisions.includeSensitive ?? []).includes(m.tempId)) {
        out.excluded.push({ matterTempId: m.tempId, reason: 'sensitive' });
        continue;
      }
      let targetMatterId: string | null = null;
      if (existing.size > 0) {
        if (decision?.action !== 'merge') {
          for (const [key, row] of existing) {
            out.duplicates.push(duplicateOf(m, key, row, sensitiveIds.has(row.matterId)));
          }
          continue;
        }
        targetMatterId = decision.mergeIntoMatterId ?? ([...dupMatters][0] as string);
        if (!dupMatters.has(targetMatterId)) throw invalid('mergeIntoMatterId is not a duplicate');
      }
      prepared.push({
        matter: m,
        corrected: decision?.corrected === true,
        targetMatterId,
        existing,
      });
    }
    out.sensitiveDocumentIds = [...new Set(out.sensitiveDocumentIds)];

    await tx.insert(activity).values({
      id: groupId,
      workspaceId,
      kind: 'import_batch',
      level: 'L3',
      actor: 'user',
      actorUserId: userId,
      summary: 'Applied a bootstrap import',
      entityRefs: { batchId },
      undoPayload: { batchId },
      undoExpiresAt: new Date(now.getTime() + IMPORT_UNDO_WINDOW_MS),
      cascadeGroupId: groupId,
      source: { input: 'import', type: 'import', ref: batchId },
      createdAt: now,
    });
    for (let i = 0; i < prepared.length; i += CHUNK) {
      await tx.transaction(async (sp) => {
        const cdeps: MatterGraphDeps = { ...gdeps, db: sp };
        for (const item of prepared.slice(i, i + CHUNK)) {
          await writeMatter(
            { sp, cdeps, actor, batchId, groupId, now, resolved, plan, out, docs, attachOnly },
            item,
          );
        }
      });
    }
    out.attachedUnreadDocumentIds = [...attachOnly].filter((id) =>
      prepared.some((p) => docs.some((d) => d.id === id && inMatter(p.matter)(d))),
    );
    out.costPaise = await batchCostPaise(tx, workspaceId, captureIds);
    await recordBatchUsage({ db: tx, workspaceId, now: () => now }, batchId);
    await tx
      .update(activity)
      .set({
        source: {
          input: 'import',
          type: 'import',
          ref: batchId,
          planHash,
          costPaise: out.costPaise,
          result: out,
        },
      })
      .where(and(eq(activity.workspaceId, workspaceId), eq(activity.id, groupId)));
    await tx
      .update(importBatch)
      .set({ status: 'applied', planHash, appliedAt: now, updatedAt: now })
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)));
    deps.log?.('import.applied', {
      matters: out.created.matters,
      proceedings: out.created.proceedings,
      duplicates: out.duplicates.length,
      excluded: out.excluded.length,
    });
    return out;
  });
  for (const event of events) deps.events.emit(event);
  return result;
}

interface DocRow {
  id: string;
  matterId: string | null;
  captureId: string | null;
  textStatus: string;
}

const inMatter = (m: PlanMatter) => {
  const captures = new Set(m.sources.flatMap((s) => s.captureId ?? []));
  return (d: DocRow): boolean => d.captureId !== null && captures.has(d.captureId);
};

const duplicateOf = (
  m: PlanMatter,
  proceedingKey: string,
  row: ProceedingRow,
  sensitive: boolean,
): ApplyDuplicate => ({
  matterTempId: m.tempId,
  proceedingKey,
  existingProceedingId: row.id,
  existingMatterId: row.matterId,
  sensitive,
});

async function loadDocuments(
  tx: Transaction,
  workspaceId: string,
  captureIds: string[],
): Promise<DocRow[]> {
  if (captureIds.length === 0) return [];
  const { document } = schema;
  const rows = await tx
    .select({
      id: document.id,
      matterId: document.matterId,
      captureId: document.sourceCaptureId,
      textStatus: document.textStatus,
    })
    .from(document)
    .where(
      and(eq(document.workspaceId, workspaceId), inArray(document.sourceCaptureId, captureIds)),
    )
    .orderBy(asc(document.createdAt), asc(document.id));
  return rows;
}

async function sensitiveMatters(
  tx: Transaction,
  workspaceId: string,
  matterIds: string[],
): Promise<Set<string>> {
  if (matterIds.length === 0) return new Set();
  const { matter } = schema;
  const rows = await tx
    .select({ id: matter.id, sensitive: matter.sensitive })
    .from(matter)
    .where(and(eq(matter.workspaceId, workspaceId), inArray(matter.id, matterIds)));
  return new Set(rows.filter((r) => r.sensitive).map((r) => r.id));
}

async function forumOf(
  tx: Transaction,
  workspaceId: string,
  code: string | null,
): Promise<string | null> {
  if (code === null) return null;
  const { forum } = schema;
  const [row] = await tx
    .select({ id: forum.id })
    .from(forum)
    .where(
      and(eq(forum.code, code), or(isNull(forum.workspaceId), eq(forum.workspaceId, workspaceId))),
    )
    .orderBy(asc(forum.workspaceId))
    .limit(1);
  return row?.id ?? null;
}

interface WriteContext {
  sp: Transaction;
  cdeps: MatterGraphDeps;
  actor: GraphActor;
  batchId: string;
  groupId: string;
  now: Date;
  resolved: Record<string, string>;
  plan: ImportPlan;
  out: ApplyResult;
  docs: DocRow[];
  attachOnly: Set<string>;
}

async function writeMatter(c: WriteContext, item: Prepared): Promise<void> {
  const { sp, cdeps, actor, batchId, out } = c;
  const { workspaceId, userId } = actor;
  const { listing, hearing, order, obligation, document, activity, proposal } = schema;
  const m = item.matter;
  const confidence = Math.min(1, Math.max(0, m.confidence)).toFixed(3);
  const provenance = {
    sourceType: 'import' as const,
    sourceRef: `import:${batchId}`,
    confidence,
    confirmationState: item.corrected ? ('corrected' as const) : ('confirmed' as const),
  };
  const undo: MatterUndoPayload = {
    matterId: item.targetMatterId ?? '',
    matterCreated: item.targetMatterId === null,
    proceedingIds: [],
    listingIds: [],
    hearingIds: [],
    orderIds: [],
    obligationIds: [],
    documents: [],
  };
  if (item.targetMatterId === null) {
    const row = await createMatter(cdeps, actor, { title: m.title });
    undo.matterId = row.id;
    out.created.matters += 1;
  }
  const matterId = undo.matterId;
  const ids = new Map<string, string>();
  for (const p of parentsFirst(m.proceedings)) {
    const existing = item.existing.get(p.key);
    if (existing !== undefined) {
      ids.set(p.key, existing.id);
      continue;
    }
    const forumId = await forumOf(sp, workspaceId, p.forumCode);
    if (p.caseType === null || forumId === null) {
      out.unresolvedProceedingKeys.push(p.key);
      continue;
    }
    const parentId = p.parentKey === null ? undefined : ids.get(p.parentKey);
    const row = await createProceeding(cdeps, actor, {
      matterId,
      forumId,
      caseType: p.caseType,
      ...(p.caseNumber === null ? {} : { number: p.caseNumber }),
      ...(p.caseYear === null ? {} : { year: p.caseYear }),
      ...(p.cnr === null ? {} : { cnr: p.cnr }),
      ...(parentId === undefined ? {} : { parentProceedingId: parentId }),
      provenance,
    });
    ids.set(p.key, row.id);
    undo.proceedingIds.push(row.id);
    out.created.proceedings += 1;
  }
  // Next dates: proposed, then confirmed by the lawyer's apply; a differing canonical date stays a conflict.
  for (const p of m.proceedings) {
    const proceedingId = ids.get(p.key);
    const date = c.resolved[p.key] ?? p.nextDate?.date ?? null;
    if (proceedingId === undefined || date === null) continue;
    const proposed = await proposeNextDate(cdeps, actor, {
      proceedingId,
      date,
      stageRaw: p.stage ?? '',
      provenance: { sourceType: 'import', sourceRef: provenance.sourceRef, confidence },
    });
    if (proposed.kind === 'conflict') {
      undo.listingIds.push(proposed.proposed.listingId);
      out.created.listings += 1;
    } else if (proposed.kind === 'proposal') {
      await confirmNextDate(cdeps, actor, { listingId: proposed.listingId });
      undo.listingIds.push(proposed.listingId);
      out.created.listings += 1;
    }
  }
  // History: a past date is a hearing (or an order when the source was an order record).
  const orderDocs = new Map<string, DocRow>();
  for (const d of c.docs)
    if (d.captureId !== null && !orderDocs.has(d.captureId)) orderDocs.set(d.captureId, d);
  for (const h of c.plan.history.filter((x) => x.matterTempId === m.tempId)) {
    const proceedingId = ids.get(h.proceedingKey);
    if (proceedingId === undefined) continue;
    const orderSource = h.sources.find((s) => s.kind === 'order_record');
    const [source] =
      orderSource === undefined
        ? []
        : await sp
            .select({ payload: proposal.payload, captureId: proposal.captureId })
            .from(proposal)
            .where(
              and(eq(proposal.workspaceId, workspaceId), eq(proposal.id, orderSource.proposalId)),
            );
    const payload = source?.payload ?? {};
    const documentId = source?.captureId == null ? undefined : orderDocs.get(source.captureId)?.id;
    const orderType = ORDER_TYPES.find((t) => t === payload['orderType']);
    if (documentId !== undefined && orderType !== undefined) {
      const nextDate =
        typeof payload['nextDate'] === 'string' && DAY.test(payload['nextDate'])
          ? payload['nextDate']
          : null;
      const directions = Array.isArray(payload['operativeDirections'])
        ? payload['operativeDirections']
        : [];
      const [row] = await sp
        .insert(order)
        .values({
          workspaceId,
          proceedingId,
          documentId,
          orderDate: h.date,
          orderType,
          nextDate,
          operativeDirections: directions.flatMap((d: unknown) => {
            const x = (d ?? {}) as { text?: unknown; anchorId?: unknown };
            return typeof x.text === 'string' && typeof x.anchorId === 'string'
              ? [{ text: x.text, anchorId: x.anchorId }]
              : [];
          }),
          ...provenance,
        })
        .returning({ id: order.id });
      if (row) {
        undo.orderIds.push(row.id);
        out.created.orders += 1;
      }
      continue;
    }
    const [past] = await sp
      .insert(listing)
      .values({
        workspaceId,
        proceedingId,
        listDate: h.date,
        listType: 'daily',
        stageRaw: '',
        ...provenance,
      })
      .returning({ id: listing.id });
    if (!past) continue;
    undo.listingIds.push(past.id);
    out.created.listings += 1;
    const [held] = await sp
      .insert(hearing)
      .values({ workspaceId, listingId: past.id, heldOn: h.date, ...provenance })
      .returning({ id: hearing.id });
    if (held) {
      undo.hearingIds.push(held.id);
      out.created.hearings += 1;
    }
  }
  // Obligations from directions whose dates the lawyer confirmed.
  for (const o of c.plan.obligations) {
    if (o.matterTempId !== m.tempId || o.dueDate === null) continue;
    const [row] = await sp
      .insert(obligation)
      .values({
        workspaceId,
        matterId,
        source: 'order_direction',
        description: o.title,
        dueDate: o.dueDate,
        status: 'open',
        ...provenance,
      })
      .returning({ id: obligation.id });
    if (row) {
      undo.obligationIds.push(row.id);
      out.created.obligations += 1;
    }
  }
  // Documents: attach those not on a matter yet; unread ones past the cap are never read.
  for (const d of c.docs.filter(inMatter(m))) {
    if (d.matterId !== null) continue;
    const skip = c.attachOnly.has(d.id);
    await sp
      .update(document)
      .set({
        matterId,
        ...(skip ? { textStatus: 'skipped' as const, textSkippedReason: 'plan_limit' } : {}),
        updatedAt: c.now,
      })
      .where(and(eq(document.workspaceId, workspaceId), eq(document.id, d.id)));
    undo.documents.push({ id: d.id, unreadBySystem: skip });
    out.created.documents += 1;
  }
  await sp.insert(activity).values({
    workspaceId,
    kind: 'import_matter',
    level: 'L3',
    actor: 'user',
    actorUserId: userId,
    summary:
      item.targetMatterId === null ? 'Imported a matter' : 'Imported into an existing matter',
    entityRefs: {
      matterId,
      proceedingIds: undo.proceedingIds,
      documentIds: undo.documents.map((d) => d.id),
    },
    undoPayload: { ...undo },
    undoExpiresAt: new Date(c.now.getTime() + IMPORT_UNDO_WINDOW_MS),
    parentActivityId: c.groupId,
    cascadeGroupId: c.groupId,
    confidence,
    source: { input: 'import', type: 'import', ref: batchId },
    createdAt: c.now,
  });
}
