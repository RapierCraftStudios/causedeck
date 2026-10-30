// Shared types and paths of the wizard (#92): the injected server actions (so components render in
// stories and tests without a server) and where each step lives.
import type { OnboardingPath, OnboardingStep } from '@causedeck/validators/onboarding';

import type { Result } from '../../lib/safe-action.ts';

export interface CompleteStepInput {
  workspaceId: string;
  step: string;
  skipped?: boolean;
  payload?: unknown;
}

export type CompleteStep = (
  input: CompleteStepInput,
) => Promise<Result<{ path: OnboardingPath; next: OnboardingStep | null }>>;

/** What every step form knows about where it is. */
export interface StepScope {
  workspaceId: string;
  slug: string;
  path: OnboardingPath;
  completeStep: CompleteStep;
}

/** `/onboarding/<path>/<step>?w=<slug>`: the workspace rides in the URL so a refresh resumes it. */
export function stepHref(path: OnboardingPath, step: string, slug: string, batch?: string): string {
  const query = new URLSearchParams({ w: slug });
  if (batch !== undefined) query.set('batch', batch);
  return `/onboarding/${path}/${step}?${query.toString()}`;
}

/** The court-day board for the first day: today, tomorrow, or Today when it is further off. */
export function courtDayHref(slug: string, date: string | null, today: string): string {
  const base = `/w/${encodeURIComponent(slug)}`;
  if (date === null || date <= today) return `${base}/today`;
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return date === next.toISOString().slice(0, 10) ? `${base}/tomorrow` : `${base}/today`;
}
