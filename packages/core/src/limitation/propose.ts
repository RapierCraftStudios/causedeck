// Compute and confirm (#940). `computeLimitation` stores a `proposed` computation (an L2 proposal:
// the rule id and table version and the inputs are kept beside the result) and creates no
// obligation. `confirmLimitation` is a person's act: it creates the `rule` obligation through the
// dedicated `createRuleObligation` path, with provenance `limitation rule <id> v<n>`.
import { schema } from '@causedeck/db';
import { ComputationInput, ComputationResult } from '@causedeck/validators/limitation';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { record, type AuditAction } from '../audit/index.ts';
import { createRuleObligation } from '../obligations/index.ts';
import { conflict, notFound } from '../shared/errors.ts';

import { computeExpiry } from './engine.ts';
import { findReviewedRule } from './rules.ts';
import {
  parseInput,
  withLimitation,
  type LimitationActor,
  type LimitationDeps,
  type LimitationScope,
} from './scope.ts';

const { limitationComputation, matter } = schema;

const ConfirmInput = z.strictObject({ computationId: z.uuid() });
const ListInput = z.strictObject({ matterId: z.uuid().optional() });

export interface ComputationView {
  id: string;
  matterId: string;
  expiresOn: string;
  status: string;
  /** Present for junior and up; a clerk or viewer sees due dates only. */
  ruleId?: string;
  ruleCode?: string;
  ruleVersion?: string;
  startDate?: string;
  excludedDays?: number;
  notes?: string[];
}

async function audit(
  scope: LimitationScope,
  action: AuditAction,
  id: string,
  metadata: Record<string, string | number | boolean>,
): Promise<void> {
  await record(
    {
      db: scope.tx,
      workspaceId: scope.actor.workspaceId,
      actor: { userId: scope.actor.userId, kind: 'user' },
    },
    { action, target: { kind: 'limitation_computation', id }, metadata },
  );
}

/** Compute the last day to file under a reviewed rule; stored as a proposal, nothing is scheduled. */
export async function computeLimitation(
  deps: LimitationDeps,
  actor: LimitationActor,
  input: unknown,
): Promise<ComputationView> {
  const data = parseInput(ComputationInput, input);
  return withLimitation(deps, actor, 'write', async (scope) => {
    const [found] = await scope.tx
      .select({ id: matter.id })
      .from(matter)
      .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.id, data.matterId)))
      .limit(1);
    if (found === undefined) throw notFound('Matter not found');
    const rule = await findReviewedRule(scope, data.ruleCode);
    const expiresOn = computeExpiry(
      data.startDate,
      rule.periodValue,
      rule.periodUnit as 'days' | 'months' | 'years',
      data.excludedDays,
    );
    const result = ComputationResult.parse({
      ruleCode: rule.code,
      startDate: data.startDate,
      expiresOn,
      status: 'proposed',
      notes: rule.condonable ? ['Delay may be condoned on application.'] : [],
    });
    const [row] = await scope.tx
      .insert(limitationComputation)
      .values({
        workspaceId: actor.workspaceId,
        matterId: data.matterId,
        ruleId: rule.id,
        input: { ...data, ruleId: rule.id, ruleVersion: rule.tableVersion },
        result,
        startDate: data.startDate,
        expiresOn,
        status: 'proposed',
        createdBy: actor.userId,
      })
      .returning();
    if (row === undefined) throw new Error('computeLimitation: insert returned no row');
    await audit(scope, 'limitation.computed', row.id, {
      ruleVersion: rule.tableVersion,
      excludedDays: data.excludedDays,
    });
    return {
      id: row.id,
      matterId: row.matterId,
      expiresOn,
      status: row.status,
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleVersion: rule.tableVersion,
      startDate: data.startDate,
      excludedDays: data.excludedDays,
      notes: result.notes,
    };
  });
}

/** Confirm a proposed computation: creates the `rule` obligation and marks it confirmed. */
export async function confirmLimitation(
  deps: LimitationDeps,
  actor: LimitationActor,
  input: unknown,
): Promise<{ computationId: string; obligationId: string; dueDate: string }> {
  const data = parseInput(ConfirmInput, input);
  return withLimitation(deps, actor, 'write', async (scope) => {
    const [row] = await scope.tx
      .select()
      .from(limitationComputation)
      .where(
        and(
          eq(limitationComputation.workspaceId, actor.workspaceId),
          eq(limitationComputation.id, data.computationId),
        ),
      )
      .limit(1)
      .for('update');
    if (row === undefined) throw notFound('Limitation computation not found');
    if (row.status !== 'proposed') throw conflict('This computation is already decided');
    const rule = await findRuleRow(scope, row.ruleId);
    const created = await createRuleObligation(
      scope.tx,
      { workspaceId: actor.workspaceId, userId: actor.userId },
      {
        matterId: row.matterId,
        description: `Limitation: ${rule.title}`,
        dueDate: row.expiresOn,
        basis: rule.citation ?? rule.statute,
        ownerMemberId: scope.memberId,
        provenance: {
          sourceType: 'system',
          sourceRef: `limitation rule ${rule.id} v${rule.tableVersion}`,
          confirmationState: 'confirmed',
        },
      },
      scope.now,
    );
    await scope.tx
      .update(limitationComputation)
      .set({ status: 'confirmed', updatedAt: scope.now })
      .where(
        and(
          eq(limitationComputation.workspaceId, actor.workspaceId),
          eq(limitationComputation.id, row.id),
        ),
      );
    await audit(scope, 'limitation.confirmed', row.id, {
      obligationId: created.id,
      ruleVersion: rule.tableVersion,
    });
    return { computationId: row.id, obligationId: created.id, dueDate: row.expiresOn };
  });
}

async function findRuleRow(scope: LimitationScope, ruleId: string) {
  const { limitationRule } = schema;
  const [rule] = await scope.tx
    .select()
    .from(limitationRule)
    .where(eq(limitationRule.id, ruleId))
    .limit(1);
  if (rule === undefined) throw notFound('Limitation rule not found');
  return rule;
}

/**
 * The computations of the workspace, newest first. Junior and up see the rule and inputs and the
 * proposals; a clerk or viewer sees the confirmed due dates only.
 */
export async function listLimitations(
  deps: LimitationDeps,
  actor: LimitationActor,
  input: unknown = {},
): Promise<ComputationView[]> {
  const data = parseInput(ListInput, input);
  return withLimitation(deps, actor, 'read', async (scope) => {
    const rows = await scope.tx
      .select()
      .from(limitationComputation)
      .where(
        and(
          eq(limitationComputation.workspaceId, actor.workspaceId),
          ...(data.matterId === undefined
            ? []
            : [eq(limitationComputation.matterId, data.matterId)]),
        ),
      )
      .orderBy(desc(limitationComputation.createdAt));
    return rows
      .filter((r) => scope.canSeeRules || r.status === 'confirmed')
      .map((r): ComputationView => {
        const base = { id: r.id, matterId: r.matterId, expiresOn: r.expiresOn, status: r.status };
        if (!scope.canSeeRules) return base;
        // The stored input also carries the rule id and table version the engine added, which the
        // strict `ComputationInput` rejects: read those two apart from the rest.
        const { ruleId, ruleVersion, ...rest } = r.input as Record<string, unknown>;
        const meta = { ruleId, ruleVersion } as { ruleId?: string; ruleVersion?: string };
        const stored = ComputationInput.partial().safeParse(rest);
        return {
          ...base,
          ...(meta.ruleId === undefined ? {} : { ruleId: meta.ruleId }),
          ...(meta.ruleVersion === undefined ? {} : { ruleVersion: meta.ruleVersion }),
          startDate: r.startDate,
          ...(stored.success && stored.data.ruleCode !== undefined
            ? { ruleCode: stored.data.ruleCode }
            : {}),
          ...(stored.success && stored.data.excludedDays !== undefined
            ? { excludedDays: stored.data.excludedDays }
            : {}),
        };
      });
  });
}
