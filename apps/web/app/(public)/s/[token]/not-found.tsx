import { getTranslations } from 'next-intl/server';

/** A 404 while `status_links.enabled` is off, and for an unknown token: the same page, no oracle. */
export default async function StatusLinkNotFound() {
  const t = await getTranslations('statusLink');
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">{t('page.unavailable')}</h1>
      <p className="text-muted-foreground mt-2">{t('page.unavailableBody')}</p>
    </main>
  );
}
