// The per-user "ask me first" dial (#47): `automation_preference(kind, ask_first)`. With it on, a
// kind that would be applied unasked (L3) is a proposal (L2) for that user. It only ever lowers a level.
import { schema, type Transaction } from '@causedeck/db';
import { PROPOSAL_KINDS, type ProposalKind } from '@causedeck/validators/proposal-draft';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { invalid } from '../shared/errors.ts';

import { inAutomationScope } from './context.ts';

const { automationPreference } = schema;

const SetAskFirstInput = z.strictObject({
  kind: z.enum(PROPOSAL_KINDS),
  askFirst: z.boolean(),
});

/** The kinds `userId` wants to be asked about first. */
export async function loadAskFirst(
  tx: Transaction,
  workspaceId: string,
  userId: string,
): Promise<Set<ProposalKind>> {
  const rows = await tx
    .select({ kind: automationPreference.kind })
    .from(automationPreference)
    .where(
      and(
        eq(automationPreference.workspaceId, workspaceId),
        eq(automationPreference.userId, userId),
        eq(automationPreference.askFirst, true),
      ),
    );
  return new Set(rows.map((row) => row.kind as ProposalKind));
}

/** Turn "ask me first" on or off for the acting user and one kind of change. */
export async function setAskFirst(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { kind: ProposalKind; askFirst: boolean },
): Promise<{ kind: ProposalKind; askFirst: boolean }> {
  const parsed = SetAskFirstInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { kind, askFirst } = parsed.data;
  return inAutomationScope(deps, actor, async ({ tx }) => {
    await tx
      .insert(automationPreference)
      .values({ workspaceId: actor.workspaceId, userId: actor.userId, kind, askFirst })
      .onConflictDoUpdate({
        target: [
          automationPreference.workspaceId,
          automationPreference.userId,
          automationPreference.kind,
        ],
        set: { askFirst, updatedAt: new Date() },
      });
    return { kind, askFirst };
  });
}

/** The acting user's "ask me first" kinds. */
export async function getAskFirst(
  deps: MatterGraphDeps,
  actor: GraphActor,
): Promise<ProposalKind[]> {
  return inAutomationScope(deps, actor, async ({ tx }) => [
    ...(await loadAskFirst(tx, actor.workspaceId, actor.userId)),
  ]);
}
