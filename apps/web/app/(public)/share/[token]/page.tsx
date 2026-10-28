import { Button } from '@causedeck/ui/button';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { getSession } from '../../../../lib/auth.ts';
import { signInPathFor } from '../../../../lib/safe-next.ts';

import { importSharedBriefAction } from './actions.ts';
import { ImportForm } from './import-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('share');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

interface SharePageProps {
  params: Promise<{ token: string }>;
}

/**
 * `/share/<token>` (#507). Public: a non-user sees the sanitised brief snapshot only (never a
 * workspace id, private note or document), or why the link is dead, and is invited to sign in or
 * join, which returns here to claim the link.
 */
export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;
  const { db } = await import('@causedeck/core/runtime');
  const { viewBriefShare } = await import('@causedeck/core/shares');
  const view = await viewBriefShare(db, token);
  const t = await getTranslations('share');

  if (view.state !== 'VALID') {
    const why = t(`states.${view.state.toLowerCase() as 'invalid' | 'expired' | 'revoked'}`);
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">{t('unavailable')}</h1>
        <p className="text-muted-foreground mt-2">{why}</p>
      </main>
    );
  }

  const { snapshot } = view;
  const session = await getSession();
  const path = `/share/${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">{snapshot.matterTitle}</h1>
      {snapshot.stage && <p>{t('stage', { stage: snapshot.stage })}</p>}
      {snapshot.synopsis && <p>{snapshot.synopsis}</p>}
      {snapshot.lastOrder.length > 0 && (
        <section>
          <h2 className="font-medium">{t('lastOrder')}</h2>
          <ul className="list-disc pl-5">
            {snapshot.lastOrder.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {snapshot.lastHearing && <p>{t('lastHearing', { date: snapshot.lastHearing })}</p>}
      {snapshot.openObligations.length > 0 && (
        <section>
          <h2 className="font-medium">{t('obligations')}</h2>
          <ul className="list-disc pl-5">
            {snapshot.openObligations.map((o, i) => (
              <li key={i}>{o.dueDate ? t('due', { text: o.text, date: o.dueDate }) : o.text}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-muted-foreground text-sm">
        {t('footer', {
          assembledAt: snapshot.assembledAt,
          expiresAt: view.expiresAt.toDateString(),
        })}
      </p>
      {session ? (
        <ImportForm token={token} action={importSharedBriefAction} />
      ) : (
        <Button asChild size="lg">
          <Link href={signInPathFor(path)}>{t('join')}</Link>
        </Button>
      )}
    </main>
  );
}
