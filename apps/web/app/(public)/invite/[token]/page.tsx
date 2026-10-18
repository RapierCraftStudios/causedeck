import type { InvitationPreview } from '@causedeck/core/workspaces';
import { Button } from '@causedeck/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getSession } from '../../../../lib/auth.ts';
import { signInPathFor } from '../../../../lib/safe-next.ts';

import { AcceptForm, SwitchAccountButton } from './accept-form.tsx';
import { acceptInvitationAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invite');
  return { title: t('metaTitle') };
}

/** `invite.states.*` key for the dead-end states. */
const STATE_KEY = {
  INVALID: 'invalid',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  USED: 'used',
} as const;

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

async function preview(userId: string, token: string): Promise<InvitationPreview> {
  const [{ db }, { previewInvitation }] = await Promise.all([
    import('@causedeck/db'),
    import('@causedeck/core/workspaces'),
  ]);
  return previewInvitation(db, { userId, token });
}

/**
 * `/invite/<token>` (#180). Public in the proxy, so a signed-out visitor is sent to sign-in here,
 * with `next` back to this page. Signed in, the invitation is previewed (read-only) and shown in
 * one distinct state: valid with `Accept invitation`, expired, revoked, used, not valid, sent to a
 * different email, or already a member.
 */
export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const path = `/invite/${encodeURIComponent(token)}`;
  const session = await getSession();
  if (!session) redirect(signInPathFor(path));

  const [t, tShell, invitation] = await Promise.all([
    getTranslations('invite'),
    getTranslations('shell'),
    preview(session.user.id, token),
  ]);
  const workspace = invitation.workspaceName ?? '';
  const role = invitation.role ? tShell(`roles.${invitation.role}`) : '';

  let title: string;
  let body: string;
  let actions;
  switch (invitation.state) {
    case 'VALID':
      title = t('valid.title', { workspace });
      body = t('valid.body', { workspace, role });
      actions = <AcceptForm token={token} action={acceptInvitationAction} />;
      break;
    case 'EMAIL_MISMATCH':
      title = t('states.emailMismatch.title');
      body = t('states.emailMismatch.body', { email: session.user.email });
      actions = <SwitchAccountButton next={path} label={t('differentAccount')} />;
      break;
    case 'ALREADY_MEMBER':
      title = t('states.alreadyMember.title');
      body = t('states.alreadyMember.body', { workspace });
      actions = (
        <Button asChild size="lg" className="w-full">
          <Link href={`/w/${encodeURIComponent(invitation.workspaceSlug ?? '')}/today`}>
            {t('openWorkspace', { workspace })}
          </Link>
        </Button>
      );
      break;
    default: {
      const state = STATE_KEY[invitation.state];
      title = t(`states.${state}.title`);
      body = t(`states.${state}.body`);
      actions = (
        <Button asChild variant="secondary" size="lg" className="w-full">
          <Link href="/">{t('goHome')}</Link>
        </Button>
      );
    }
  }

  return (
    <main
      id="main"
      tabIndex={-1}
      data-invite-state={invitation.state.toLowerCase()}
      className="flex min-h-dvh items-center justify-center px-4 py-12 outline-none md:px-6"
    >
      <section
        aria-labelledby="invite-title"
        className="bg-surface border-line flex w-full max-w-md flex-col gap-6 rounded-lg border p-6 shadow-sm md:p-8"
      >
        <header className="flex flex-col gap-1.5">
          <h1 id="invite-title" className="font-serif text-2xl font-medium">
            {title}
          </h1>
          <p className="text-ink-muted text-sm">{body}</p>
          {invitation.state === 'VALID' ? (
            <p className="text-sm">
              <span className="text-ink-muted">{t('valid.roleLabel')}: </span>
              <span data-role={invitation.role} className="font-medium">
                {role}
              </span>
            </p>
          ) : null}
        </header>
        {actions}
      </section>
    </main>
  );
}
