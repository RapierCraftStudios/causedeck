// Memory proposals (#72, ADR 0037). Nothing here writes `memory_item`: every service files a
// `memory_proposal` (status `proposed`) that a person confirms in `confirm.ts`. A member who paused
// all memory gets no proposal at all, and a key or value that describes a judge or a bench is
// rejected (R13). A repeated-edit pattern is counted in an `observing` proposal row, which turns
// `proposed` on the third distinct output and is never shown while it is still being counted.
import { createHash } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import {
  assertNotBench,
  DISMISSED_PROPOSAL_REST_DAYS,
  EDIT_PATTERN_THRESHOLD,
  MemoryCorrectionInput,
  MemoryEditObservation,
  MemoryGuardError,
  MemoryProposalInput,
  isMemoryKey,
  layerOfKey,
  type MemoryProposal,
  type MemoryValue,
} from '@causedeck/validators';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { invalid } from '../shared/errors.ts';

import {
  assertClientOrContact,
  assertMatterExists,
  canWriteMemory,
  inScope,
  nowOf,
  opener,
  requireRole,
  sealValue,
  type MemoryActor,
  type MemoryDeps,
} from './scope.ts';

const { memoryProposal, memoryItem, memoryPause } = schema;

export type ProposalRow = typeof memoryProposal.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A bench-describing key or value becomes a VALIDATION error with the guard's message. */
export function guard(key: string, value: MemoryValue): void {
  try {
    assertNotBench(key, value);
  } catch (error) {
    if (error instanceof MemoryGuardError) throw invalid(error.message);
    throw error;
  }
}

/** Parse with a zod schema; the first issue becomes a VALIDATION error. */
export function parseMemoryInput<S extends z.ZodType>(inputSchema: S, input: unknown): z.output<S> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

export async function isPausedAll(
  tx: Transaction,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: memoryPause.id })
    .from(memoryPause)
    .where(and(eq(memoryPause.workspaceId, workspaceId), eq(memoryPause.userId, userId)));
  return row !== undefined;
}

export function toProposal(
  row: ProposalRow,
  open: (ciphertext: string) => MemoryValue,
): MemoryProposal {
  return {
    id: row.id,
    layer: row.layer,
    key: row.key,
    scope: row.scope,
    matterId: row.matterId,
    personId: row.personId,
    proposedValue: open(row.proposedValueCiphertext),
    evidence: row.evidence,
    status: row.status === 'observing' ? 'proposed' : row.status,
    proposedAt: row.proposedAt,
    decidedAt: row.decidedAt,
  };
}

const patternKeyOf = (...parts: string[]): string =>
  createHash('sha256')
    .update(parts.map((p) => p.trim().toLowerCase()).join('\u0000'))
    .digest('hex')
    .slice(0, 40);

/** A dismissed proposal with this pattern, decided inside the rest window, blocks a new one. */
async function dismissedRecently(
  tx: Transaction,
  actor: MemoryActor,
  patternKey: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - DISMISSED_PROPOSAL_REST_DAYS * DAY_MS);
  const [row] = await tx
    .select({ id: memoryProposal.id })
    .from(memoryProposal)
    .where(
      and(
        eq(memoryProposal.workspaceId, actor.workspaceId),
        eq(memoryProposal.ownerUserId, actor.userId),
        eq(memoryProposal.patternKey, patternKey),
        eq(memoryProposal.status, 'dismissed'),
        gt(memoryProposal.decidedAt, since),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function checkTargets(
  tx: Transaction,
  actor: MemoryActor,
  input: { matterId?: string | null | undefined; personId?: string | null | undefined },
): Promise<void> {
  if (input.matterId) await assertMatterExists(tx, actor.workspaceId, input.matterId);
  if (input.personId) await assertClientOrContact(tx, actor.workspaceId, input.personId);
}

async function requireWriter(deps: MemoryDeps, actor: MemoryActor): Promise<void> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw invalid('This role cannot propose memory');
}

/**
 * File a proposal for the actor to confirm. Returns null when the actor paused all memory.
 * Writes `memory_proposal` only.
 */
export async function proposeMemory(
  deps: MemoryDeps,
  actor: MemoryActor,
  input: unknown,
  options: { patternKey?: string } = {},
): Promise<MemoryProposal | null> {
  const parsed = parseMemoryInput(MemoryProposalInput, input);
  if (!isMemoryKey(parsed.key)) throw invalid('Not a registered memory key');
  const layer = layerOfKey(parsed.key);
  guard(parsed.key, parsed.value);
  await requireWriter(deps, actor);
  const sealed = await sealValue(deps, actor.workspaceId, parsed.value);
  return inScope(deps, actor, async (tx) => {
    if (await isPausedAll(tx, actor.workspaceId, actor.userId)) return null;
    await checkTargets(tx, actor, parsed);
    const [row] = await tx
      .insert(memoryProposal)
      .values({
        workspaceId: actor.workspaceId,
        layer,
        key: parsed.key,
        scope: parsed.scope,
        matterId: parsed.matterId ?? null,
        personId: parsed.personId ?? null,
        ownerUserId: actor.userId,
        proposedValueCiphertext: sealed,
        evidence: parsed.evidence,
        patternKey: options.patternKey ?? null,
        sourceType: parsed.sourceType,
        sourceRef: parsed.sourceRef ?? null,
        anchorId: parsed.anchorId ?? null,
        confidence: parsed.confidence == null ? null : parsed.confidence.toFixed(3),
        proposedAt: nowOf(deps),
      })
      .returning();
    if (!row) throw new Error('memory proposal insert returned no row');
    return toProposal(row, await opener(deps, actor.workspaceId));
  });
}

/**
 * Count one observed edit. The third distinct output carrying the same edit becomes one proposal
 * with evidence ("You added carry vakalat copy to the last 3 outputs. Save?"); a dismissed one
 * rests for 60 days. Returns the proposal when this call created it, otherwise null.
 */
export async function proposeFromEdit(
  deps: MemoryDeps,
  actor: MemoryActor,
  observation: unknown,
): Promise<MemoryProposal | null> {
  const obs = parseMemoryInput(MemoryEditObservation, observation);
  if (!isMemoryKey(obs.key)) throw invalid('Not a registered memory key');
  const layer = layerOfKey(obs.key);
  const value = obs.pattern;
  guard(obs.key, value);
  await requireWriter(deps, actor);
  const patternKey = patternKeyOf('edit', obs.key, obs.scope, obs.matterId ?? '', value);
  const now = nowOf(deps);
  const sealed = await sealValue(deps, actor.workspaceId, value);
  return inScope(deps, actor, async (tx) => {
    if (await isPausedAll(tx, actor.workspaceId, actor.userId)) return null;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`memory-edit:${actor.workspaceId}:${actor.userId}:${patternKey}`}))`,
    );
    if (await dismissedRecently(tx, actor, patternKey, now)) return null;
    const [latest] = await tx
      .select()
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.patternKey, patternKey),
          inArray(memoryProposal.status, ['observing', 'proposed']),
        ),
      )
      .orderBy(desc(memoryProposal.proposedAt))
      .limit(1);
    // Already proposed and waiting for the lawyer: do not propose it twice.
    if (latest?.status === 'proposed') return null;
    await checkTargets(tx, actor, obs);

    const seen = new Set<string>(
      Array.isArray(latest?.evidence['outputIds'])
        ? (latest.evidence['outputIds'] as string[])
        : [],
    );
    seen.add(obs.outputId);
    const outputIds = [...seen];
    const reached = outputIds.length >= EDIT_PATTERN_THRESHOLD;
    const evidence = {
      outputIds,
      count: outputIds.length,
      pattern: value,
      ...(reached
        ? { prompt: `You added ${value} to the last ${String(outputIds.length)} outputs. Save?` }
        : {}),
    };
    const status = reached ? 'proposed' : 'observing';
    let row: ProposalRow | undefined;
    if (latest) {
      [row] = await tx
        .update(memoryProposal)
        .set({ evidence, status, ...(reached ? { proposedAt: now } : {}) })
        .where(
          and(eq(memoryProposal.workspaceId, actor.workspaceId), eq(memoryProposal.id, latest.id)),
        )
        .returning();
    } else {
      [row] = await tx
        .insert(memoryProposal)
        .values({
          workspaceId: actor.workspaceId,
          layer,
          key: obs.key,
          scope: obs.scope,
          matterId: obs.matterId ?? null,
          personId: null,
          ownerUserId: actor.userId,
          proposedValueCiphertext: sealed,
          evidence,
          patternKey,
          sourceType: 'edit',
          status,
          proposedAt: now,
        })
        .returning();
    }
    if (!row) throw new Error('memory proposal write returned no row');
    return reached ? toProposal(row, await opener(deps, actor.workspaceId)) : null;
  });
}

const normalise = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * An M7 alias proposal from a correction ("Rajan" = "M. Rajan s/o Murugan"). Returns null when
 * the actor paused all memory, when the same alias is already saved or proposed, or when one was
 * dismissed in the last 60 days.
 */
export async function proposeFromCorrection(
  deps: MemoryDeps,
  actor: MemoryActor,
  correction: unknown,
): Promise<MemoryProposal | null> {
  const input = parseMemoryInput(MemoryCorrectionInput, correction);
  const key = input.target === 'party' ? 'M7.party_alias' : 'M7.matter_alias';
  const value = { alias: input.alias, canonical: input.canonical };
  guard(key, value);
  await requireWriter(deps, actor);
  const patternKey = patternKeyOf('alias', key, input.alias, input.canonical);
  const now = nowOf(deps);
  return inScope(deps, actor, async (tx) => {
    if (await isPausedAll(tx, actor.workspaceId, actor.userId)) return null;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`memory-alias:${actor.workspaceId}:${actor.userId}:${patternKey}`}))`,
    );
    if (await dismissedRecently(tx, actor, patternKey, now)) return null;
    const [pending] = await tx
      .select({ id: memoryProposal.id })
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.ownerUserId, actor.userId),
          eq(memoryProposal.patternKey, patternKey),
          eq(memoryProposal.status, 'proposed'),
        ),
      )
      .limit(1);
    if (pending) return null;
    // Dedupe against saved aliases of the same key the actor can see.
    const saved = await tx
      .select({ value: memoryItem.valueCiphertext })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.workspaceId, actor.workspaceId),
          eq(memoryItem.key, key),
          eq(memoryItem.ownerUserId, actor.userId),
          eq(memoryItem.status, 'active'),
        ),
      );
    const open = await opener(deps, actor.workspaceId);
    for (const { value: ciphertext } of saved) {
      if (ciphertext === null) continue;
      const existing = open(ciphertext);
      if (
        typeof existing === 'object' &&
        !Array.isArray(existing) &&
        normalise(String(existing['alias'] ?? '')) === normalise(input.alias) &&
        normalise(String(existing['canonical'] ?? '')) === normalise(input.canonical)
      ) {
        return null;
      }
    }
    const sealed = await sealValue(deps, actor.workspaceId, value);
    const [row] = await tx
      .insert(memoryProposal)
      .values({
        workspaceId: actor.workspaceId,
        layer: 'M7',
        key,
        scope: 'user',
        ownerUserId: actor.userId,
        proposedValueCiphertext: sealed,
        evidence: { target: input.target },
        patternKey,
        sourceType: 'correction',
        proposedAt: now,
      })
      .returning();
    if (!row) throw new Error('memory proposal insert returned no row');
    return toProposal(row, open);
  });
}
