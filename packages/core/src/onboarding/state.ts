// Onboarding wizard state (#92): where one member is in the solo or chamber wizard of one
// workspace. One `onboarding_state` row per (workspace, user) under FORCE RLS; it holds step names
// only. Every call is idempotent: starting twice keeps the first row, completing a step twice keeps
// the first completion, and a return later resumes at `step`. A member of two workspaces cannot
// read or advance the other's state: each call opens the workspace scope as that member and refuses
// a non-member before any read.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import {
  isSkippable,
  isStepOf,
  nextStepOf,
  OnboardingStepEvent,
  stepsOf,
  type OnboardingPath,
  type OnboardingStep,
} from '@causedeck/validators/onboarding';
import { and, eq } from 'drizzle-orm';

import { invalid, notFound } from '../shared/errors.ts';
import { listMemberships, memberRole } from '../workspaces/index.ts';

const { onboardingState } = schema;

type Db = Database | Transaction;

export interface OnboardingActor {
  userId: string;
  workspaceId: string;
}

export interface OnboardingStateView {
  path: OnboardingPath;
  /** The step to resume at. */
  step: OnboardingStep;
  completed: OnboardingStep[];
  skipped: OnboardingStep[];
  /** True once the last step (`done`) is completed. */
  finished: boolean;
  updatedAt: Date;
}

export interface CompletedStep {
  /** The step to open next; `null` after the last one. */
  next: OnboardingStep | null;
  state: OnboardingStateView;
  /** The telemetry event for this completion: step names only, no content. */
  event: OnboardingStepEvent;
}

type Row = typeof onboardingState.$inferSelect;

async function requireMember(db: Db, actor: OnboardingActor): Promise<void> {
  if ((await memberRole(db, actor.userId, actor.workspaceId)) === null) {
    throw notFound('Workspace not found');
  }
}

function toView(row: Row): OnboardingStateView {
  const path = row.path as OnboardingPath;
  const steps = stepsOf(path);
  const known = (list: string[]) =>
    list.filter((name): name is OnboardingStep => isStepOf(path, name));
  const completed = known(row.completed);
  const last = steps.at(-1);
  return {
    path,
    step: isStepOf(path, row.step) ? row.step : (steps[0] as OnboardingStep),
    completed,
    skipped: known(row.skipped),
    finished: last !== undefined && completed.includes(last),
    updatedAt: row.updatedAt,
  };
}

async function loadRow(tx: Transaction, actor: OnboardingActor): Promise<Row | undefined> {
  const [row] = await tx
    .select()
    .from(onboardingState)
    .where(
      and(
        eq(onboardingState.workspaceId, actor.workspaceId),
        eq(onboardingState.userId, actor.userId),
      ),
    );
  return row;
}

/** The member's wizard state in this workspace, or `null` before they started. */
export async function getOnboardingState(
  db: Db,
  actor: OnboardingActor,
): Promise<OnboardingStateView | null> {
  await requireMember(db, actor);
  const row = await withWorkspace(db, actor, (tx) => loadRow(tx, actor));
  return row === undefined ? null : toView(row);
}

/**
 * Start the wizard on `path` in this workspace. Idempotent: a second call keeps the existing row
 * (and its path), so a refresh never resets progress. The first step, `workspace`, is the one that
 * created the workspace, so it starts completed.
 */
export async function startOnboarding(
  db: Db,
  actor: OnboardingActor,
  input: { path: OnboardingPath },
): Promise<OnboardingStateView> {
  await requireMember(db, actor);
  const first = stepsOf(input.path)[0] as OnboardingStep;
  const second = nextStepOf(input.path, first) as OnboardingStep;
  const row = await withWorkspace(db, actor, async (tx) => {
    await tx
      .insert(onboardingState)
      .values({
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        path: input.path,
        step: second,
        completed: [first],
      })
      .onConflictDoNothing();
    return loadRow(tx, actor);
  });
  if (row === undefined) throw notFound('Onboarding not found');
  return toView(row);
}

/**
 * Complete (or, for a skippable step, skip) `step`. Only the current step or one already completed
 * may be submitted: a step cannot be jumped to. The resume point moves forward, never back.
 */
export async function completeOnboardingStep(
  db: Db,
  actor: OnboardingActor,
  input: { step: string; skipped?: boolean },
): Promise<CompletedStep> {
  await requireMember(db, actor);
  const skipped = input.skipped === true;
  return withWorkspace(db, actor, async (tx) => {
    const row = await loadRow(tx, actor);
    if (row === undefined) throw notFound('Onboarding not found');
    const path = row.path as OnboardingPath;
    if (!isStepOf(path, input.step)) throw invalid('Unknown onboarding step');
    const step = input.step;
    const steps = stepsOf(path);
    const current = toView(row);
    if (steps.indexOf(step) > steps.indexOf(current.step)) {
      throw invalid('Finish the current step first');
    }
    if (skipped && !isSkippable(path, step)) throw invalid('This step cannot be skipped');
    const next = nextStepOf(path, step);
    const completed = current.completed.includes(step)
      ? current.completed
      : [...current.completed, step];
    const skippedSteps =
      skipped && !current.skipped.includes(step) ? [...current.skipped, step] : current.skipped;
    const moves = next !== null && steps.indexOf(next) > steps.indexOf(current.step);
    const [saved] = await tx
      .update(onboardingState)
      .set({
        step: moves ? next : current.step,
        completed,
        skipped: skippedSteps,
        updatedAt: new Date(),
      })
      .where(
        and(eq(onboardingState.id, row.id), eq(onboardingState.workspaceId, actor.workspaceId)),
      )
      .returning();
    if (saved === undefined) throw notFound('Onboarding not found');
    return {
      next,
      state: toView(saved),
      event: OnboardingStepEvent.parse({
        name: 'onboarding.step.completed',
        path,
        step,
        skipped,
      }),
    };
  });
}

export interface ResumableOnboarding {
  workspaceId: string;
  slug: string;
  state: OnboardingStateView;
}

/**
 * The newest unfinished wizard across the user's own workspaces, or `null`. Each workspace is read
 * in its own scope as the member, so another member's state is never visible.
 */
export async function findResumableOnboarding(
  db: Db,
  userId: string,
): Promise<ResumableOnboarding | null> {
  const memberships = await listMemberships(db, userId);
  let best: ResumableOnboarding | null = null;
  for (const membership of memberships) {
    const actor = { userId, workspaceId: membership.workspaceId };
    const row = await withWorkspace(db, actor, (tx) => loadRow(tx, actor));
    if (row === undefined) continue;
    const state = toView(row);
    if (state.finished) continue;
    if (best === null || state.updatedAt > best.state.updatedAt) {
      best = { workspaceId: membership.workspaceId, slug: membership.slug, state };
    }
  }
  return best;
}
