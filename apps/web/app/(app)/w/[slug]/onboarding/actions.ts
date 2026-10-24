'use server';
// Zero-entry onboarding server actions (#501, D-048). Each goes through `workspaceAction`
// (lib/workspace-action.ts): strict zod input, `requireSession`, membership and the policy action
// asserted by `guard`. Discovery searches the courts for the member's identifiers through the
// governed fetcher and stages what carries them as proposals on an import batch; the existing import
// actions then build, confirm and apply the plan, so nothing reaches the matter graph before the
// confirm grid. A name-only identity comes back as samples to confirm. The funnel steps are recorded
// without ever failing the action, and only counts are logged.
import type { DiscoveryOutcome } from '@causedeck/core/onboarding';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { logger } from '../../../../../src/health.ts';
import { webStatusFetcher } from '../../../../../lib/case-watch/fetcher.ts';
import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

const Discover = WorkspaceScoped.extend({
  sourceIds: z.array(z.string().min(1).max(120)).min(1).max(10),
  enrolmentNumbers: z.array(z.string().trim().min(1).max(60)).max(20),
  names: z.array(z.string().trim().min(1).max(120)).max(20),
  windowDays: z.number().int().min(30).max(90).optional(),
  batchId: z.uuid().optional(),
  confirmedMatchKeys: z.array(z.string().min(1).max(300)).max(200).optional(),
}).strict();
const Progress = WorkspaceScoped.extend({ batchId: z.uuid() }).strict();
const Step = WorkspaceScoped.extend({
  step: z.enum(['confirm_grid_done', 'first_court_day_view']),
  /** Matters discovered and matters confirmed, for the discovered-against-confirmed log. */
  discovered: z.number().int().min(0).max(100000).optional(),
  confirmed: z.number().int().min(0).max(100000).optional(),
}).strict();

export interface DiscoveryProgressView {
  batchId: string;
  status: string;
  files: number;
  matchedRows: number;
}

/** Record a funnel step; measurement never fails the action it observes. */
async function record(
  userId: string,
  step: 'identifiers_entered' | 'discovery_found' | 'confirm_grid_done' | 'first_court_day_view',
): Promise<void> {
  try {
    const [{ db }, { recordActivation }] = await Promise.all([
      import('@causedeck/core/runtime'),
      import('@causedeck/core/activation'),
    ]);
    await recordActivation(db, { userId, step });
  } catch {
    // dropped: the member proceeds
  }
}

const discover = workspaceAction(
  Discover,
  async (input, ctx): Promise<DiscoveryOutcome> => {
    const { discoverAdvocateCases } = await import('@causedeck/core/onboarding');
    await record(ctx.userId, 'identifiers_entered');
    const outcome = await discoverAdvocateCases(
      {
        db: ctx.tx,
        fetcher: webStatusFetcher(ctx.tx).fetcher,
        log: (event, counts) => logger.info({ ...counts }, event),
      },
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      {
        sourceIds: input.sourceIds,
        enrolmentNumbers: input.enrolmentNumbers,
        names: input.names,
        ...(input.windowDays === undefined ? {} : { windowDays: input.windowDays }),
        ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
        ...(input.confirmedMatchKeys === undefined
          ? {}
          : { confirmedMatchKeys: input.confirmedMatchKeys }),
      },
    );
    if (outcome.status !== 'nothing_found') await record(ctx.userId, 'discovery_found');
    revalidatePath('/w/[slug]/onboarding', 'page');
    return outcome;
  },
  { action: 'matter.write' },
);

const progress = workspaceAction(
  Progress,
  async ({ batchId }, ctx): Promise<DiscoveryProgressView> => {
    const { getImportProgress } = await import('@causedeck/core/import');
    const view = await getImportProgress(
      { db: ctx.tx },
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      batchId,
    );
    return { batchId, status: view.status, files: view.total, matchedRows: view.matchedRows };
  },
  { action: 'matter.read' },
);

const step = workspaceAction(
  Step,
  async ({ step: name, discovered, confirmed }, ctx): Promise<{ recorded: true }> => {
    if (discovered !== undefined && confirmed !== undefined) {
      logger.info({ discovered, confirmed }, 'onboarding.discovered_vs_confirmed');
    }
    await record(ctx.userId, name);
    return { recorded: true };
  },
  { action: 'matter.read' },
);

export async function discoverAdvocateCasesAction(raw: unknown): Promise<Result<DiscoveryOutcome>> {
  return discover(raw);
}

export async function discoveryProgressAction(
  raw: unknown,
): Promise<Result<DiscoveryProgressView>> {
  return progress(raw);
}

export async function recordOnboardingStepAction(
  raw: unknown,
): Promise<Result<{ recorded: true }>> {
  return step(raw);
}
