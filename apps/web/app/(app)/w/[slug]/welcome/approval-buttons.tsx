'use client';

// The two one-tap controls of the clerk welcome page (#505): the clerk asks for approval, the
// senior approves. Each calls its server action, then refreshes the server-rendered page.
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import type { Result } from '../../../../../lib/safe-action.ts';

import type { ClerkSetupView } from './actions.ts';

interface ApprovalButtonProps {
  action: (input: unknown) => Promise<Result<ClerkSetupView>>;
  input: Record<string, string>;
  kind: 'request' | 'approve';
}

export function ApprovalButton({ action, input, kind }: ApprovalButtonProps) {
  const t = useTranslations('workspace.welcome');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<'offline' | 'generic' | null>(null);
  const label = kind === 'request' ? t('approval.request') : t('senior.approve');
  const busy = kind === 'request' ? t('approval.requesting') : t('senior.approving');

  function onTap() {
    setError(null);
    if (!navigator.onLine) {
      setError('offline');
      return;
    }
    startTransition(async () => {
      try {
        const result = await action(input);
        if (!result.ok) {
          setError('generic');
          return;
        }
        router.refresh();
      } catch {
        setError('generic');
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={pending}
        aria-busy={pending}
        data-clerk-setup-action={kind}
        onClick={onTap}
      >
        {pending ? busy : label}
      </Button>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}
