// `/w/[slug]/onboarding` (#501, D-048): zero-entry onboarding. The member gives an enrolment number
// or a name spelling and picks courts; the app searches them, stages what carries the advocate as
// proposals and hands over to the one confirm grid. It needs `matter.write` (the import actions do).
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DiscoveryOnboarding } from '../../../../../components/onboarding/discovery-onboarding.tsx';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

interface OnboardingPageProps {
  params: Promise<{ slug: string }>;
}

/** The launch courts with an advocate search; the keys match `DISCOVERY_SOURCES` in core. */
const COURTS = [
  { sourceId: 'in.tn.madras-hc.chennai:advocate_search', labelKey: 'madrasHc' },
  { sourceId: 'in.ka.karnataka-hc.bengaluru:advocate_search', labelKey: 'karnatakaHc' },
  { sourceId: 'in.tn.district:advocate_search', labelKey: 'tnDistrict' },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboardingDiscovery');
  return { title: t('metaTitle') };
}

export default async function OnboardingDiscoveryPage({ params }: OnboardingPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('onboardingDiscovery');
  if (!can(context.role, 'matter.write')) return <PermissionDenied message={t('denied')} />;

  return (
    <div data-route="onboarding-discovery" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <DiscoveryOnboarding workspaceId={context.workspace.id} courts={COURTS} />
    </div>
  );
}
