'use server';
// Onboarding wizard server actions (#92, `/onboarding`). `createWorkspaceAction` is the first step
// of both paths: it is not workspace-scoped (the workspace does not exist yet), so it uses
// `safeAction` with `requireSession`; the domain service makes the creator `owner`, and the wizard
// state starts in the same request (best effort: a failed start never loses the workspace, and the
// next step page starts it). Every later step goes through `workspaceAction` (strict zod input,
// session, membership): `completeOnboardingStepAction` saves one step's answer through the
// `@causedeck/core/onboarding` services (M1 profile, courts, chamber defaults) and then advances
// the saved step. Each is idempotent on (workspace, user, step), so a retry or a second tab is
// harmless. Telemetry carries step names only, never matter or personal content.
import { assertCan } from '@causedeck/auth/policy';
import { CreateWorkspaceInput } from '@causedeck/validators/workspace';
import { isStepOf, type OnboardingStep } from '@causedeck/validators/onboarding';
import { z } from 'zod';

import { logger } from '../../../src/health.ts';
import type { AppSession } from '../../../lib/auth.ts';
import { memoryDeps } from '../../../lib/memory/deps.ts';
import { ActionError, safeAction, type Result } from '../../../lib/safe-action.ts';
import { toActionError, WorkspaceScoped, workspaceAction } from '../../../lib/workspace-action.ts';

async function requireSession(): Promise<AppSession> {
  const auth = await import('../../../lib/auth.ts');
  return auth.requireSession();
}

const create = safeAction(
  CreateWorkspaceInput,
  async (input, ctx) => {
    const session = ctx.session as AppSession;
    const runtime = await import('@causedeck/core/runtime');
    try {
      const workspace = await runtime.createWorkspaceFor({ userId: session.user.id, input });
      // The funnel's `workspace_created` step (#509); measurement never fails the action.
      try {
        const { recordActivation } = await import('@causedeck/core/activation');
        await recordActivation(runtime.db, { userId: session.user.id, step: 'workspace_created' });
      } catch {
        // dropped: the workspace exists and the user proceeds
      }
      // Start the resumable wizard on the path the user chose. Idempotent, and never fatal.
      try {
        const { startOnboarding } = await import('@causedeck/core/onboarding');
        const scope = { workspaceId: workspace.id, userId: session.user.id };
        await runtime.inWorkspace(scope, (tx) => startOnboarding(tx, scope, { path: input.kind }));
      } catch (error) {
        logger.warn({ err: error }, 'onboarding: could not start the wizard state');
      }
      return { slug: workspace.slug };
    } catch (error) {
      throw toActionError(error);
    }
  },
  { getSession: requireSession },
);

// authz: public — any signed-in user may create a workspace (`requireSession` above); there is
// no workspace to authorize against yet.
export async function createWorkspaceAction(raw: unknown): Promise<Result<{ slug: string }>> {
  return create(raw);
}

const CompleteStep = WorkspaceScoped.extend({
  step: z.string().min(1).max(32),
  skipped: z.boolean().optional(),
  /** The step's answer; each step parses its own shape in the core service. */
  payload: z.unknown().optional(),
}).strict();

/** Steps only the chamber owner may complete (they change who can see what). */
const OWNER_STEPS: readonly OnboardingStep[] = ['invite', 'roles', 'delegation', 'brief-format'];

export interface CompletedOnboardingStep {
  path: 'solo' | 'chamber';
  /** The step to open next; `null` after `done`. */
  next: OnboardingStep | null;
}

const completeStep = workspaceAction(
  CompleteStep,
  async (input, ctx): Promise<CompletedOnboardingStep> => {
    const onboarding = await import('@causedeck/core/onboarding');
    const actor = { workspaceId: ctx.workspaceId, userId: ctx.userId };
    const current = await onboarding.getOnboardingState(ctx.tx, actor);
    if (current === null) throw new ActionError('NOT_FOUND', '');
    const { path } = current;
    if (!isStepOf(path, input.step) || input.step === 'workspace') {
      throw new ActionError('VALIDATION', '');
    }
    const step = input.step;
    // A chamber's later steps are the owner's: a non-owner is denied before anything is saved.
    if (path === 'chamber' && OWNER_STEPS.includes(step)) assertCan(ctx.actor, 'member.role');
    try {
      if (input.skipped !== true) {
        if (step === 'profile') {
          await onboarding.saveOnboardingProfile(memoryDeps(ctx.tx), actor, input.payload);
        } else if (step === 'courts') {
          await onboarding.saveOnboardingCourts(memoryDeps(ctx.tx), actor, input.payload);
        } else if (step === 'delegation') {
          await onboarding.saveChamberDelegation(ctx.tx, actor, input.payload);
        } else if (step === 'brief-format') {
          await onboarding.saveChamberBriefFormat(memoryDeps(ctx.tx), actor, input.payload);
        }
      }
      const done = await onboarding.completeOnboardingStep(ctx.tx, actor, {
        step,
        ...(input.skipped === undefined ? {} : { skipped: input.skipped }),
      });
      // Names only: the validated event holds the path, the step and whether it was skipped.
      logger.info({ ...done.event }, done.event.name);
      return { path, next: done.next };
    } catch (error) {
      throw toActionError(error);
    }
  },
  {},
);

export async function completeOnboardingStepAction(
  raw: unknown,
): Promise<Result<CompletedOnboardingStep>> {
  return completeStep(raw);
}
