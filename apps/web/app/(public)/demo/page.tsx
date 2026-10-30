// `/demo` (#93): the entry to the two sample workspaces, linked from sign-in. Two cards (Chennai
// solo, Bengaluru chamber), each a form posting to `/demo/enter`. A card shows only when its
// workspace exists (seeded); with none, or after a failed start, the page says so with a way back.
// Public (no session): the sample workspaces are fictional and the session lasts 4 hours.
import { listDemoWorkspaces } from '@causedeck/core/demo';
import { db } from '@causedeck/core/runtime';
import { Alert } from '@causedeck/ui/alert';
import { buttonVariants } from '@causedeck/ui/button';
import { Card } from '@causedeck/ui/card';
import { FlaskConical } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shell.demoEntry');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const ERRORS = { error: 'error', busy: 'busy', unavailable: 'unavailable' } as const;
type DemoError = keyof typeof ERRORS;

const isDemoError = (value: string | undefined): value is DemoError =>
  value !== undefined && Object.hasOwn(ERRORS, value);

interface DemoPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoPage({ searchParams }: DemoPageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.error) ? params.error[0] : params.error;
  const failure = isDemoError(raw) ? raw : null;
  const t = await getTranslations('shell.demoEntry');
  const available = await listDemoWorkspaces(db).catch(() => []);
  const cards = [
    { key: 'chennai-solo', title: t('chennaiTitle'), description: t('chennaiDescription') },
    {
      key: 'bengaluru-chamber',
      title: t('bengaluruTitle'),
      description: t('bengaluruDescription'),
    },
  ].filter((card) => available.some((w) => w.key === card.key));

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 outline-none"
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-base">{t('intro')}</p>
      </div>
      {failure === null ? null : (
        <Alert tone="warning" role="alert">
          {t(failure)}
        </Alert>
      )}
      {cards.length === 0 ? (
        <Alert tone="info" icon={<FlaskConical />}>
          {t('unavailable')}
        </Alert>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <li key={card.key}>
              <Card className="flex h-full flex-col gap-4 p-5">
                <form action="/demo/enter" method="post" className="flex h-full flex-col gap-4">
                  <input type="hidden" name="workspace" value={card.key} />
                  <h2 className="font-serif text-lg font-medium">{card.title}</h2>
                  <p className="text-ink-muted flex-1 text-sm">{card.description}</p>
                  <button type="submit" className={buttonVariants({ variant: 'primary' })}>
                    {t('enter')}
                  </button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/sign-in"
        className="text-accent focus-visible:outline-ring w-fit rounded-sm underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
      >
        {t('back')}
      </Link>
    </main>
  );
}
