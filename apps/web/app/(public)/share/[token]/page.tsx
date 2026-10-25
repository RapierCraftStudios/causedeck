import { Button } from '@causedeck/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';

import { getSession } from '../../../../lib/auth.ts';
import { signInPathFor } from '../../../../lib/safe-next.ts';

import { importSharedBriefAction } from './actions.ts';
import { ImportForm } from './import-form.tsx';

export function generateMetadata(): Metadata {
  return { title: 'Shared brief', robots: { index: false, follow: false } };
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

  if (view.state !== 'VALID') {
    const why = {
      INVALID: 'This link is not valid.',
      EXPIRED: 'This link has expired. Ask the sender for a new one.',
      REVOKED: 'The sender has withdrawn this link.',
    }[view.state];
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Shared brief unavailable</h1>
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
      {snapshot.stage && <p>Stage: {snapshot.stage}</p>}
      {snapshot.synopsis && <p>{snapshot.synopsis}</p>}
      {snapshot.lastOrder.length > 0 && (
        <section>
          <h2 className="font-medium">Last order</h2>
          <ul className="list-disc pl-5">
            {snapshot.lastOrder.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {snapshot.lastHearing && <p>Last hearing: {snapshot.lastHearing}</p>}
      {snapshot.openObligations.length > 0 && (
        <section>
          <h2 className="font-medium">Open obligations</h2>
          <ul className="list-disc pl-5">
            {snapshot.openObligations.map((o, i) => (
              <li key={i}>
                {o.text}
                {o.dueDate ? ` (due ${o.dueDate})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-muted-foreground text-sm">
        Shared as of {snapshot.assembledAt}. Link expires {view.expiresAt.toDateString()}.
      </p>
      {session ? (
        <ImportForm token={token} action={importSharedBriefAction} />
      ) : (
        <Button asChild size="lg">
          <Link href={signInPathFor(path)}>Join CauseDeck and import this matter</Link>
        </Button>
      )}
    </main>
  );
}
