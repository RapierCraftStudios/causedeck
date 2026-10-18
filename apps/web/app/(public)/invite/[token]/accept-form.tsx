'use client';

import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Result } from '../../../../lib/safe-action.ts';
import { signInPathFor } from '../../../../lib/safe-next.ts';

import type { AcceptOutcome, AcceptRejection } from './actions.ts';

export type AcceptInvitation = (input: { token: string }) => Promise<Result<AcceptOutcome>>;

/** `invite.states.*` key for each typed rejection (the page keeps its own copy: client module). */
const REJECTION_STATE: Record<AcceptRejection, string> = {
  INVALID: 'invalid',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  USED: 'used',
  EMAIL_MISMATCH: 'emailMismatch',
  ALREADY_MEMBER: 'alreadyMember',
};

type FormError = 'offline' | 'signedOut' | 'generic';

export interface AcceptFormProps {
  token: string;
  /** The `acceptInvitationAction` server action; injectable for tests. */
  action: AcceptInvitation;
}

/**
 * `Accept invitation`. Success lands on the workspace's Today; a token that went stale since the
 * page rendered (revoked, used, expired) shows that state's message instead.
 */
export function AcceptForm({ token, action }: AcceptFormProps) {
  const t = useTranslations('invite');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<AcceptRejection | null>(null);
  const [formError, setFormError] = useState<FormError | null>(null);

  async function onAccept() {
    setRejection(null);
    setFormError(null);
    if (!navigator.onLine) {
      setFormError('offline');
      return;
    }
    setPending(true);
    try {
      const result = await action({ token });
      if (!result.ok) {
        setFormError(result.error.code === 'UNAUTHENTICATED' ? 'signedOut' : 'generic');
      } else if (result.data.status === 'accepted') {
        router.push(`/w/${encodeURIComponent(result.data.slug)}/today`);
        router.refresh();
        return;
      } else {
        setRejection(result.data.reason);
      }
    } catch {
      setFormError('generic');
    }
    setPending(false);
  }

  const state = rejection ? REJECTION_STATE[rejection] : null;
  return (
    <div className="flex w-full flex-col gap-4">
      {state ? (
        <Alert tone="danger" data-invite-rejection={state}>
          <strong className="font-medium">{t(`states.${state}.title`)}</strong>
        </Alert>
      ) : null}
      {formError ? <Alert tone="danger">{t(`errors.${formError}`)}</Alert> : null}
      <Button
        type="button"
        size="lg"
        loading={pending}
        labels={{ loading: t('accepting') }}
        onClick={() => void onAccept()}
        className="w-full"
      >
        {t('accept')}
      </Button>
    </div>
  );
}

/**
 * Sign out and go to `/sign-in?next=/invite/<token>`, so the invitee can use the invited email.
 * The auth client loads on click to keep it out of the page's first-load JS.
 */
export function SwitchAccountButton({ next, label }: { next: string; label: string }) {
  const [pending, setPending] = useState(false);
  async function onClick() {
    setPending(true);
    try {
      const { authClient } = await import('../../../../lib/auth-client.ts');
      await authClient.signOut();
    } finally {
      window.location.assign(signInPathFor(next));
    }
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      loading={pending}
      labels={{ loading: label }}
      onClick={() => void onClick()}
      className="w-full"
    >
      {label}
    </Button>
  );
}
