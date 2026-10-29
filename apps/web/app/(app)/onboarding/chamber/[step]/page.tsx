import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { OnboardingStepPage, type StepPageProps } from '../../_components/step-page.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('metaTitle') };
}

/** `/onboarding/chamber/<step>` (#92). */
export default function ChamberOnboardingStep(props: StepPageProps) {
  return OnboardingStepPage('chamber', props);
}
