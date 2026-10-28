import { Button } from '@causedeck/ui/button';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** The listing does not exist or the matter is restricted from this member: request access. */
export default async function BriefNotFound() {
  const t = await getTranslations('brief.notFound');
  return (
    <div className="grid gap-3">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <div className="flex gap-2">
        <Button asChild variant="secondary">
          <Link href="/inbox">{t('request')}</Link>
        </Button>
      </div>
    </div>
  );
}
