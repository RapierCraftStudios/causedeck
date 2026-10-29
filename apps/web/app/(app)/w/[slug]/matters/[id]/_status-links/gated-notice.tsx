// Shown in place of the authoring button when `status_links.enabled` is off for a viewer who could
// otherwise see the control (#88). The matter page does not mount it while the flag is off; it
// exists for the stories and for a workspace that wants to explain why.
import { useTranslations } from 'next-intl';

export function StatusLinkGatedNotice() {
  const t = useTranslations('statusLink.gated');
  return (
    <div role="status" className="rounded-md border p-4">
      <p className="font-medium">{t('title')}</p>
      <p className="text-muted-foreground text-sm">{t('body')}</p>
    </div>
  );
}
