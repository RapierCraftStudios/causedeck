// Demo-data banner (#182): every page of the fictional `demo` workspace (seeded by
// `pnpm db:seed:demo`) says so above the content, so nobody mistakes the seeded matters for real
// ones. The slug is reserved (`@causedeck/validators/workspace`), so no real workspace shows it. Not
// dismissible and no client JS.
import { Alert } from '@causedeck/ui/alert';
import { isDemoWorkspaceSlug } from '@causedeck/validators/workspace';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function DemoBanner({ slug }: { slug: string }) {
  const t = useTranslations('shell.demoBanner');
  if (!isDemoWorkspaceSlug(slug)) return null;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 md:px-6">
      <Alert
        tone="info"
        icon={<FlaskConical />}
        data-slot="demo-banner"
        data-demo-banner=""
        className="break-words"
      >
        <span className="font-medium">{t('label')}</span> {t('hint')}
      </Alert>
    </div>
  );
}
