// The automation engine (#47, ADR 0021): the only place where "the system acted" is decided. Every
// source hands it `ProposalDraft`s; `submitProposals` validates each one, routes it with
// `decideLevel`, applies L3 drafts at once (in the same transaction, as an `activity` with a 7-day
// undo) and leaves the rest as proposals that change nothing until a person accepts them. No draft
// is dropped silently: an invalid, unanchored, low-confidence, ambiguous or not-yet-enabled draft
// becomes a "Needs you" card with its reason, and a refused one is reported back. The engine has
// no send, file, pay or advise path, and no fifth level (`scripts/check-no-l5.ts`).
import { schema, type Transaction } from '@causedeck/db';
import {
  ProposalDraftSchema,
  PROPOSAL_KINDS,
  type ParsedProposalDraft,
  type ProposalKind,
} from '@causedeck/validators/proposal-draft';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { conflict, invalid, notFound, WorkspaceError } from '../shared/errors.ts';

import { auditAutomation, readAiCall } from './audit.ts';
import { inAutomationScope, requireCan } from './context.ts';
import { decideLevel, patternOf, type Decision } from './decide.ts';
import { SensitiveAiRefusedError } from './errors.ts';
import { handlerFor } from './handlers/index.ts';
import { UNDO_WINDOW_MS, type AutomationLevel } from './levels.ts';
import { loadAskFirst } from './preferences.ts';
import { loadThresholds } from './thresholds.ts';
import type {
  ActivityRow,
  AppliedContext,
  HandlerProvenance,
  HandlerScope,
  ProposalRow,
} from './types.ts';

const { activity, matter, proceeding, proposal } = schema;

/** What happened to one submitted draft. */
export interface SubmitItem {
  index: number;
  status: 'applied' | 'proposed' | 'needs_you' | 'superseded' | 'duplicate' | 'refused';
  level: AutomationLevel | null;
  proposalId: string | null;
  activityId: string | null;
  /** Why it is a card, a duplicate, superseded or refused. */
  reason: string | null;
}

export interface SubmitResult {
  items: SubmitItem[];
}

/** Proposals unanswered for this long expire. */
export const PROPOSAL_EXPIRY_DAYS = 30;

// ---------------------------------------------------------------------------------------------
// Keys, provenance and diffs.

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256 of kind + payload + capture: the same draft is never proposed twice. */
export function idempotencyKey(
  kind: string,
  payload: unknown,
  captureId: string | null | undefined,
): string {
  return createHash('sha256')
    .update(`${kind}\n${canonicalJson(payload)}\n${captureId ?? ''}`)
    .digest('hex');
}

interface DraftMeta {
  source: ParsedProposalDraft['source'];
  patternKey: string;
  match: ParsedProposalDraft['match'] | null;
  duplicate: ParsedProposalDraft['duplicate'] | null;
  ambiguous: boolean;
}

function metaOf(draft: ParsedProposalDraft): DraftMeta {
  return {
    source: draft.source,
    patternKey: patternOf(draft),
    match: draft.match ?? null,
    duplicate: draft.duplicate ?? null,
    ambiguous: draft.ambiguous === true,
  };
}

function provenanceOf(
  meta: DraftMeta,
  captureId: string | null,
  anchors: unknown[],
  confidence: string | null,
  confirmationState: HandlerProvenance['confirmationState'],
): HandlerProvenance {
  const { source } = meta;
  const sourceType: HandlerProvenance['sourceType'] =
    source.type === 'ai'
      ? 'ai'
      : source.type === 'manual'
        ? 'manual'
        : source.input === 'list'
          ? 'adapter'
          : captureId !== null
            ? 'capture'
            : 'system';
  const anchor = anchors.find((a): a is string => typeof a === 'string') ?? null;
  return {
    sourceType,
    sourceRef: source.ref ?? (captureId === null ? 'automation' : `capture:${captureId}`),
    anchorId: anchor,
    confidence,
    confirmationState,
  };
}

const toConfidence = (value: number | null | undefined): string | null =>
  value == null ? null : value.toFixed(3);

/** The keys of `after` that differ from `before`, with both values. */
function payloadDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (canonicalJson(before[key]) !== canonicalJson(after[key])) {
      diff[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return diff;
}

function reasonOf(error: unknown): string {
  if (error instanceof WorkspaceError) return error.message;
  return 'The change could not be applied';
}

/** A savepoint scope: the same actor and deps over the nested transaction. */
function nested(scope: HandlerScope, sp: Transaction): HandlerScope {
  return { ...scope, tx: sp, deps: { ...scope.deps, db: sp } };
}

// ---------------------------------------------------------------------------------------------
// Applying.

interface ApplyInput {
  row: ProposalRow;
  level: AutomationLevel;
  /** The person who accepted, for an L2 accept; null when the system applied it. */
  acceptedBy: string | null;
  payload: Record<string, unknown>;
  parent: { id: string; cascadeGroupId: string | null } | null;
}

/** Run the kind's handler for `row` and write its activity; returns the activity. */
async function applyProposal(scope: HandlerScope, input: ApplyInput): Promise<ActivityRow> {
  const { row, level, acceptedBy } = input;
  const { workspaceId } = scope.actor;
  const kind = row.kind as ProposalKind;
  const handler = handlerFor(kind);
  const meta = row.meta as unknown as DraftMeta;
  const validated = handler.validate(input.payload);
  if ((meta as Partial<DraftMeta>).source === undefined) {
    throw invalid('This card has no source to apply; dismiss it');
  }
  const provenance = provenanceOf(
    meta,
    row.captureId,
    row.anchors,
    row.confidence,
    acceptedBy === null ? 'auto_applied' : 'confirmed',
  );
  const ctx: AppliedContext<unknown> = {
    payload: validated,
    provenance,
    level,
    proposalId: row.id,
    entityRefs: row.entityRefs,
    captureId: row.captureId,
  };
  const result = await handler.apply(scope, ctx);
  const now = scope.now();
  const activityId = randomUUID();
  const aiSource =
    row.aiCallId === null ? null : await readAiCall(scope.tx, workspaceId, row.aiCallId);
  const [created] = await scope.tx
    .insert(activity)
    .values({
      id: activityId,
      workspaceId,
      captureId: row.captureId,
      proposalId: row.id,
      kind,
      level,
      actor: acceptedBy === null ? 'system' : 'user',
      actorUserId: acceptedBy ?? scope.actor.userId,
      summary: result.summary,
      entityRefs: result.entityRefs,
      undoPayload: result.undoPayload,
      undoExpiresAt: new Date(now.getTime() + UNDO_WINDOW_MS),
      parentActivityId: input.parent?.id ?? null,
      cascadeGroupId: input.parent?.cascadeGroupId ?? input.parent?.id ?? activityId,
      confirmedAt: acceptedBy === null ? null : now,
      confirmedBy: acceptedBy,
      confidence: row.confidence,
      source: {
        input: meta.source.input,
        type: meta.source.type,
        ref: meta.source.ref ?? null,
        patternKey: meta.patternKey,
        ...(aiSource === null ? {} : { aiCall: aiSource }),
      },
      createdAt: now,
    })
    .returning();
  if (!created) throw new Error('applyProposal: activity insert returned no row');
  await scope.tx
    .update(proposal)
    .set({
      matterId: result.matterId ?? row.matterId,
      proceedingId: result.proceedingId ?? row.proceedingId,
    })
    .where(and(eq(proposal.workspaceId, workspaceId), eq(proposal.id, row.id)));
  return created;
}

// ---------------------------------------------------------------------------------------------
// Submitting.

interface SubmitState {
  thresholds: Map<string, number>;
  askFirst: Set<ProposalKind>;
  existing: Map<string, { id: string; status: string }>;
  sensitiveMatters: Set<string>;
  proceedingMatter: Map<string, string>;
  /** The first L3 `document_attach` of each capture, the root its later L3 activities cascade from. */
  rootByCapture: Map<string, { id: string; cascadeGroupId: string | null }>;
}

function candidateIds(draft: ParsedProposalDraft): { matters: string[]; proceedings: string[] } {
  const matters = new Set<string>();
  const proceedings = new Set<string>();
  const take = (value: unknown, into: Set<string>) => {
    if (typeof value === 'string' && z.uuid().safeParse(value).success) into.add(value);
  };
  take(draft.matterId, matters);
  take(draft.payload['matterId'], matters);
  take(draft.proceedingId, proceedings);
  take(draft.payload['proceedingId'], proceedings);
  return { matters: [...matters], proceedings: [...proceedings] };
}

async function loadState(
  scope: HandlerScope,
  parsed: readonly (ParsedProposalDraft | null)[],
  keys: readonly string[],
): Promise<SubmitState> {
  const { tx } = scope;
  const { workspaceId, userId } = scope.actor;
  const drafts = parsed.filter((d): d is ParsedProposalDraft => d !== null);
  const matters = new Set<string>();
  const proceedings = new Set<string>();
  for (const draft of drafts) {
    const ids = candidateIds(draft);
    ids.matters.forEach((id) => matters.add(id));
    ids.proceedings.forEach((id) => proceedings.add(id));
  }
  const proceedingMatter = new Map<string, string>();
  if (proceedings.size > 0) {
    const rows = await tx
      .select({ id: proceeding.id, matterId: proceeding.matterId })
      .from(proceeding)
      .where(
        and(eq(proceeding.workspaceId, workspaceId), inArray(proceeding.id, [...proceedings])),
      );
    for (const row of rows) {
      proceedingMatter.set(row.id, row.matterId);
      matters.add(row.matterId);
    }
  }
  const sensitiveMatters = new Set<string>();
  if (matters.size > 0) {
    const rows = await tx
      .select({ id: matter.id })
      .from(matter)
      .where(
        and(
          eq(matter.workspaceId, workspaceId),
          eq(matter.sensitive, true),
          inArray(matter.id, [...matters]),
        ),
      );
    for (const row of rows) sensitiveMatters.add(row.id);
  }
  const existing = new Map<string, { id: string; status: string }>();
  if (keys.length > 0) {
    const rows = await tx
      .select({ id: proposal.id, key: proposal.idempotencyKey, status: proposal.status })
      .from(proposal)
      .where(
        and(eq(proposal.workspaceId, workspaceId), inArray(proposal.idempotencyKey, [...keys])),
      );
    for (const row of rows) existing.set(row.key, { id: row.id, status: row.status });
  }
  return {
    thresholds: await loadThresholds(tx, workspaceId),
    askFirst: await loadAskFirst(tx, workspaceId, userId),
    existing,
    sensitiveMatters,
    proceedingMatter,
    rootByCapture: new Map(),
  };
}

/** The matter a draft lands on, when it names one (directly or through a proceeding). */
function resolveMatter(draft: ParsedProposalDraft, state: SubmitState): string | null {
  const ids = candidateIds(draft);
  if (ids.matters[0] !== undefined) return ids.matters[0];
  const viaProceeding =
    ids.proceedings[0] === undefined ? undefined : state.proceedingMatter.get(ids.proceedings[0]);
  return viaProceeding ?? null;
}

function isSensitive(draft: ParsedProposalDraft, state: SubmitState): boolean {
  const ids = candidateIds(draft);
  return (
    ids.matters.some((id) => state.sensitiveMatters.has(id)) ||
    ids.proceedings.some((id) => {
      const owner = state.proceedingMatter.get(id);
      return owner !== undefined && state.sensitiveMatters.has(owner);
    })
  );
}

interface NewProposal {
  captureId: string | null;
  kind: string;
  level: AutomationLevel;
  status?: 'proposed' | 'superseded';
  payload: Record<string, unknown>;
  anchors: unknown[];
  confidence: string | null;
  matterId: string | null;
  proceedingId: string | null;
  key: string;
  needsYou: string | null;
  entityRefs?: Record<string, unknown>;
  meta: Record<string, unknown>;
  aiCallId: string | null;
  resolutionReason?: string;
}

/** Insert a proposal; null when the idempotency key is already taken (a concurrent submit). */
async function insertProposal(scope: HandlerScope, p: NewProposal): Promise<ProposalRow | null> {
  const [row] = await scope.tx
    .insert(proposal)
    .values({
      workspaceId: scope.actor.workspaceId,
      captureId: p.captureId,
      kind: p.kind,
      level: p.level,
      status: p.status ?? 'proposed',
      payload: p.payload,
      anchors: p.anchors,
      confidence: p.confidence,
      matterId: p.matterId,
      proceedingId: p.proceedingId,
      idempotencyKey: p.key,
      needsYou: p.needsYou !== null,
      needsYouReason: p.needsYou,
      entityRefs: p.entityRefs ?? {},
      meta: p.meta,
      aiCallId: p.aiCallId,
      ...(p.status === 'superseded'
        ? { resolvedAt: scope.now(), resolutionReason: p.resolutionReason ?? null }
        : {}),
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

function item(
  index: number,
  status: SubmitItem['status'],
  level: AutomationLevel | null,
  extra: Partial<Pick<SubmitItem, 'proposalId' | 'activityId' | 'reason'>> = {},
): SubmitItem {
  return {
    index,
    status,
    level,
    proposalId: extra.proposalId ?? null,
    activityId: extra.activityId ?? null,
    reason: extra.reason ?? null,
  };
}

async function submitInvalid(
  scope: HandlerScope,
  state: SubmitState,
  index: number,
  raw: unknown,
  reason: string,
): Promise<SubmitItem> {
  const rawKind = (raw as { kind?: unknown } | null)?.kind;
  const kind =
    typeof rawKind === 'string' && (PROPOSAL_KINDS as readonly string[]).includes(rawKind)
      ? rawKind
      : 'unknown';
  const key = idempotencyKey('invalid', raw, null);
  const known = state.existing.get(key);
  if (known)
    return item(index, 'duplicate', null, { proposalId: known.id, reason: 'already submitted' });
  const row = await insertProposal(scope, {
    captureId: null,
    kind,
    level: 'L2',
    payload: { rejected: raw ?? null },
    anchors: [],
    confidence: null,
    matterId: null,
    proceedingId: null,
    key,
    needsYou: `invalid draft: ${reason}`,
    meta: {},
    aiCallId: null,
  });
  if (row) state.existing.set(key, { id: row.id, status: row.status });
  return item(index, 'needs_you', 'L2', {
    proposalId: row?.id ?? null,
    reason: `invalid draft: ${reason}`,
  });
}

async function submitOne(
  scope: HandlerScope,
  state: SubmitState,
  index: number,
  draft: ParsedProposalDraft,
): Promise<SubmitItem> {
  const kind = draft.kind;
  const captureId = draft.captureId ?? null;
  const key = idempotencyKey(kind, draft.payload, captureId);
  const known = state.existing.get(key);
  if (known) {
    const reason =
      known.status === 'dismissed' ? 'dismissed earlier; not proposed again' : 'already submitted';
    return item(index, 'duplicate', null, { proposalId: known.id, reason });
  }
  if (draft.source.type === 'ai' && isSensitive(draft, state)) {
    return item(index, 'refused', null, { reason: new SensitiveAiRefusedError().message });
  }
  const handler = handlerFor(kind);
  const meta = metaOf(draft);
  const base = {
    captureId,
    kind,
    anchors: draft.anchors,
    confidence: toConfidence(draft.confidence),
    matterId: resolveMatter(draft, state),
    proceedingId: candidateIds(draft).proceedings[0] ?? null,
    key,
    meta: meta as unknown as Record<string, unknown>,
    aiCallId: draft.source.aiCallId ?? null,
  };
  const decision: Decision = decideLevel(draft, state);
  const card = async (needsYou: string): Promise<SubmitItem> => {
    const row = await insertProposal(scope, {
      ...base,
      level: decision.level === 'L4' ? 'L4' : 'L2',
      payload: draft.payload,
      needsYou,
    });
    if (row) state.existing.set(key, { id: row.id, status: row.status });
    const level: AutomationLevel = row === null ? 'L2' : row.level;
    return item(index, 'needs_you', level, {
      proposalId: row?.id ?? null,
      reason: needsYou,
    });
  };

  if (!handler.enabled) return card(`not enabled yet: ${kind}`);
  let payload: unknown;
  try {
    payload = handler.validate(draft.payload);
  } catch (error) {
    return card(`invalid payload: ${reasonOf(error)}`);
  }

  if (decision.level === 'L3') {
    const parent = captureId === null ? null : (state.rootByCapture.get(captureId) ?? null);
    try {
      const applied = await scope.tx.transaction(async (sp) => {
        const inner = nested(scope, sp);
        const row = await insertProposal(inner, {
          ...base,
          level: 'L3',
          payload: draft.payload,
          needsYou: null,
        });
        if (row === null) return null;
        const created = await applyProposal(inner, {
          row,
          level: 'L3',
          acceptedBy: null,
          payload: draft.payload,
          parent: kind === 'document_attach' || kind === 'duplicate_merge' ? null : parent,
        });
        await sp
          .update(proposal)
          .set({ status: 'accepted', resolvedAt: scope.now() })
          .where(and(eq(proposal.workspaceId, scope.actor.workspaceId), eq(proposal.id, row.id)));
        await auditAutomation(
          inner,
          'automation.applied',
          { kind: 'activity', id: created.id },
          { proposalId: row.id, kind, level: 'L3' },
          'system',
        );
        return { row, created };
      });
      if (applied === null) return item(index, 'duplicate', null, { reason: 'already submitted' });
      state.existing.set(key, { id: applied.row.id, status: 'accepted' });
      if (
        captureId !== null &&
        (kind === 'document_attach' || kind === 'duplicate_merge') &&
        !state.rootByCapture.has(captureId)
      ) {
        state.rootByCapture.set(captureId, {
          id: applied.created.id,
          cascadeGroupId: applied.created.cascadeGroupId,
        });
      }
      return item(index, 'applied', 'L3', {
        proposalId: applied.row.id,
        activityId: applied.created.id,
      });
    } catch (error) {
      // The savepoint rolled back the proposal and any partial change; keep it as a card.
      return card(`could not be applied: ${reasonOf(error)}`);
    }
  }

  // L2 (or L4): a proposal that changes nothing until a person accepts it.
  let entityRefs: Record<string, unknown> = {};
  let supersede: string | undefined;
  if (decision.level === 'L2' && handler.stage) {
    const provenance = provenanceOf(meta, captureId, draft.anchors, base.confidence, 'proposed');
    try {
      const staged = await scope.tx.transaction(
        async (sp) =>
          (await handler.stage?.(nested(scope, sp), payload, provenance)) ?? { entityRefs: {} },
      );
      entityRefs = staged.entityRefs;
      supersede = staged.supersede;
    } catch (error) {
      return card(`could not be staged: ${reasonOf(error)}`);
    }
  }
  const row = await insertProposal(scope, {
    ...base,
    level: decision.level,
    payload: draft.payload,
    needsYou: decision.needsYou,
    entityRefs,
    ...(supersede === undefined
      ? {}
      : { status: 'superseded' as const, resolutionReason: supersede }),
  });
  if (row === null) return item(index, 'duplicate', null, { reason: 'already submitted' });
  state.existing.set(key, { id: row.id, status: row.status });
  if (supersede !== undefined) {
    return item(index, 'superseded', decision.level, { proposalId: row.id, reason: supersede });
  }
  return decision.needsYou === null
    ? item(index, 'proposed', decision.level, { proposalId: row.id, reason: decision.reason })
    : item(index, 'needs_you', decision.level, { proposalId: row.id, reason: decision.needsYou });
}

/**
 * Submit drafts from a source. Each is validated with `ProposalDraftSchema` and routed by
 * `decideLevel`: L3 drafts are applied in this transaction with an `activity` (and its undo), the
 * rest wait as `proposed` proposals linked to their capture. Every draft gets an item in the
 * result; none is dropped silently.
 */
export async function submitProposals(
  deps: MatterGraphDeps,
  actor: GraphActor,
  drafts: readonly unknown[],
): Promise<SubmitResult> {
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot submit proposals');
    const parsed = drafts.map((raw) => ProposalDraftSchema.safeParse(raw));
    const valid = parsed.map((p) => (p.success ? p.data : null));
    const keys = valid.map((d, i) =>
      d === null
        ? idempotencyKey('invalid', drafts[i], null)
        : idempotencyKey(d.kind, d.payload, d.captureId ?? null),
    );
    const state = await loadState(scope, valid, keys);
    const items: SubmitItem[] = [];
    for (const [index, result] of parsed.entries()) {
      if (!result.success) {
        const issue = result.error.issues[0];
        const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        items.push(
          await submitInvalid(
            scope,
            state,
            index,
            drafts[index],
            `${where}${issue?.message ?? 'invalid'}`,
          ),
        );
      } else {
        items.push(await submitOne(scope, state, index, result.data));
      }
    }
    const count = (status: SubmitItem['status']) => items.filter((i) => i.status === status).length;
    await auditAutomation(scope, 'automation.submitted', undefined, {
      count: items.length,
      applied: count('applied'),
      proposed: count('proposed'),
      needsYou: count('needs_you'),
      duplicates: count('duplicate'),
      refused: count('refused'),
    });
    return { items };
  });
}

// ---------------------------------------------------------------------------------------------
// Resolving a proposal.

const ProposalIdInput = z.strictObject({ proposalId: z.uuid() });
const EditInput = z.strictObject({
  proposalId: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
});
const DismissInput = z.strictObject({
  proposalId: z.uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});

function parse<S extends z.ZodType>(inputSchema: S, input: unknown): z.output<S> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  return parsed.data;
}

async function loadOpenProposal(scope: HandlerScope, proposalId: string): Promise<ProposalRow> {
  const [row] = await scope.tx
    .select()
    .from(proposal)
    .where(and(eq(proposal.workspaceId, scope.actor.workspaceId), eq(proposal.id, proposalId)))
    .limit(1)
    .for('update');
  if (row === undefined) throw notFound('Proposal not found');
  if (row.status !== 'proposed') throw conflict('This proposal was already resolved');
  return row;
}

export interface Resolved {
  proposal: ProposalRow;
  activity: ActivityRow;
}

async function resolveAccept(
  deps: MatterGraphDeps,
  actor: GraphActor,
  proposalId: string,
  edited: Record<string, unknown> | null,
): Promise<Resolved> {
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot accept proposals');
    const row = await loadOpenProposal(scope, proposalId);
    const handler = handlerFor(row.kind as ProposalKind);
    const payload = handler.validate(edited ?? row.payload) as Record<string, unknown>;
    const created = await applyProposal(scope, {
      row,
      level: 'L2',
      acceptedBy: scope.actor.userId,
      payload,
      parent: null,
    });
    const diff = edited === null ? null : payloadDiff(row.payload, payload);
    const [updated] = await scope.tx
      .update(proposal)
      .set({
        status: edited === null ? 'accepted' : 'edited',
        resolvedBy: scope.actor.userId,
        resolvedAt: scope.now(),
        ...(edited === null ? {} : { payload, editDiff: diff }),
      })
      .where(and(eq(proposal.workspaceId, scope.actor.workspaceId), eq(proposal.id, row.id)))
      .returning();
    if (!updated) throw new Error('resolveAccept: update returned no row');
    await auditAutomation(
      scope,
      'automation.accepted',
      { kind: 'proposal', id: row.id },
      { proposalId: row.id, activityId: created.id, kind: row.kind, edited: edited !== null },
    );
    return { proposal: updated, activity: created };
  });
}

/** Accept a proposal as it stands: run its handler, write an L2 activity by the accepting user. */
export async function acceptProposal(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { proposalId: string },
): Promise<Resolved> {
  const data = parse(ProposalIdInput, input);
  return resolveAccept(deps, actor, data.proposalId, null);
}

/** Accept a proposal with the person's corrections; the edit diff is kept on the proposal. */
export async function editAndAccept(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { proposalId: string; payload: Record<string, unknown> },
): Promise<Resolved> {
  const data = parse(EditInput, input);
  return resolveAccept(deps, actor, data.proposalId, data.payload);
}

/** Dismiss a proposal with an optional reason; the same draft is never proposed again. */
export async function dismissProposal(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { proposalId: string; reason?: string },
): Promise<ProposalRow> {
  const data = parse(DismissInput, input);
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot dismiss proposals');
    const row = await loadOpenProposal(scope, data.proposalId);
    const [updated] = await scope.tx
      .update(proposal)
      .set({
        status: 'dismissed',
        resolvedBy: scope.actor.userId,
        resolvedAt: scope.now(),
        resolutionReason: data.reason ?? null,
      })
      .where(and(eq(proposal.workspaceId, scope.actor.workspaceId), eq(proposal.id, row.id)))
      .returning();
    if (!updated) throw new Error('dismissProposal: update returned no row');
    await auditAutomation(
      scope,
      'automation.dismissed',
      { kind: 'proposal', id: row.id },
      {
        proposalId: row.id,
        kind: row.kind,
      },
    );
    return updated;
  });
}

/**
 * Apply a stored proposal without asking, if `decideLevel` now says L3 (for instance a threshold
 * or the ask-first dial changed). Returns what happened; a proposal that is not L3 stays untouched.
 */
export async function applyAutomatically(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { proposalId: string },
): Promise<{ applied: boolean; level: AutomationLevel; activity: ActivityRow | null }> {
  const data = parse(ProposalIdInput, input);
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot apply proposals');
    const row = await loadOpenProposal(scope, data.proposalId);
    const meta = row.meta as unknown as DraftMeta;
    const draft = ProposalDraftSchema.safeParse({
      kind: row.kind,
      captureId: row.captureId,
      source: meta.source,
      payload: row.payload,
      anchors: row.anchors,
      confidence: row.confidence === null ? null : Number(row.confidence),
      match: meta.match,
      patternKey: meta.patternKey,
      ambiguous: meta.ambiguous,
      duplicate: meta.duplicate,
    });
    if (!draft.success) return { applied: false, level: row.level, activity: null };
    const decision = decideLevel(draft.data, {
      thresholds: await loadThresholds(scope.tx, scope.actor.workspaceId),
      askFirst: await loadAskFirst(scope.tx, scope.actor.workspaceId, scope.actor.userId),
    });
    if (decision.level !== 'L3' || row.kind === 'next_date') {
      return { applied: false, level: decision.level, activity: null };
    }
    const created = await applyProposal(scope, {
      row,
      level: 'L3',
      acceptedBy: null,
      payload: row.payload,
      parent: null,
    });
    await scope.tx
      .update(proposal)
      .set({ status: 'accepted', level: 'L3', resolvedAt: scope.now() })
      .where(and(eq(proposal.workspaceId, scope.actor.workspaceId), eq(proposal.id, row.id)));
    await auditAutomation(
      scope,
      'automation.applied',
      { kind: 'activity', id: created.id },
      { proposalId: row.id, kind: row.kind, level: 'L3' },
      'system',
    );
    return { applied: true, level: 'L3', activity: created };
  });
}

/** Expire proposals nobody answered within `PROPOSAL_EXPIRY_DAYS` (or before `before`). */
export async function expireProposals(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { before?: Date } = {},
): Promise<{ expired: number }> {
  return inAutomationScope(deps, actor, async (scope) => {
    requireCan(scope, 'matter.write', 'You cannot expire proposals');
    const cutoff =
      input.before ?? new Date(scope.now().getTime() - PROPOSAL_EXPIRY_DAYS * 86_400_000);
    const rows = await scope.tx
      .update(proposal)
      .set({ status: 'expired', resolvedAt: scope.now(), resolutionReason: 'unanswered' })
      .where(
        and(
          eq(proposal.workspaceId, scope.actor.workspaceId),
          eq(proposal.status, 'proposed'),
          lt(proposal.createdAt, cutoff),
        ),
      )
      .returning({ id: proposal.id });
    await auditAutomation(scope, 'automation.expired', undefined, { count: rows.length });
    return { expired: rows.length };
  });
}
