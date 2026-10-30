import { isStepOf, stepsOf } from '@causedeck/validators/onboarding';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PathChooser, type ResumeCard } from '../../../components/onboarding/path-chooser.tsx';
import { stepHref } from '../../../components/onboarding/steps.ts';
import { getSession } from '../../../lib/auth.ts';
import { logger } from '../../../src/health.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('metaTitle') };
}

/** The member's unfinished wizard, if any; a failed read shows the chooser alone. */
async function loadResume(userId: string): Promise<ResumeCard | null> {
  try {
    const runtime = await import('@causedeck/core/runtime');
    const { findResumableOnboarding } = await import('@causedeck/core/onboarding');
    const found = await findResumableOnboarding(runtime.db, userId);
    if (found === null) return null;
    const { path, step } = found.state;
    const steps = stepsOf(path);
    if (!isStepOf(path, step)) return null;
    return {
      href: stepHref(path, step, found.slug),
      workspace: found.slug,
      step: steps.indexOf(step) + 1,
      total: steps.length,
    };
  } catch (error) {
    logger.warn({ err: error }, 'onboarding: could not read the resume state');
    return null;
  }
}

/**
 * `/onboarding` (#92, #179): the path chooser, Solo or Chamber, with a resume card when a set-up is
 * in progress. Signed-in only (proxy and the `(app)` layout); reached from `/` when the user has no
 * workspace and from the switcher's `Create workspace`.
 */
export default async function OnboardingPage() {
  const session = await getSession();
  const resume = session ? await loadResume(session.user.id) : null;
  return <PathChooser resume={resume} />;
}
