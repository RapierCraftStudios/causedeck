import { Skeleton } from '@causedeck/ui/skeleton';
import { getTranslations } from 'next-intl/server';

/** The cards' skeleton while the page reads which sample workspaces exist. */
export default async function DemoLoading() {
  const t = await getTranslations('shell.demoEntry');
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6" aria-busy="true">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-8 w-2/3" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    </main>
  );
}
