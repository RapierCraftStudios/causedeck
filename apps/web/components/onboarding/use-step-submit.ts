'use client';
// Submitting one step (#92): offline is refused before the request, a failure keeps the form as it
// was (nothing is lost), and success opens the next step, which the server has already saved as the
// resume point. Returns the error code only; each form words it from its own catalog keys.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ActionErrorCode } from '../../lib/safe-action.ts';
import { useOnline } from '../settings/settings-offline-banner.tsx';

import { stepHref, type StepScope } from './steps.ts';

export type StepFailure = 'offline' | 'forbidden' | 'invalid' | 'generic';

function failureFor(code: ActionErrorCode): StepFailure {
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return 'forbidden';
  if (code === 'VALIDATION') return 'invalid';
  return 'generic';
}

export function useStepSubmit(scope: StepScope, finalHref?: string) {
  const router = useRouter();
  const online = useOnline();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<StepFailure | null>(null);

  /** Save `payload` (or skip), then open the next step; resolves to whether it went through. */
  async function submit(step: string, payload?: unknown, skipped = false): Promise<boolean> {
    setFailure(null);
    if (!navigator.onLine) {
      setFailure('offline');
      return false;
    }
    setPending(true);
    try {
      const result = await scope.completeStep({
        workspaceId: scope.workspaceId,
        step,
        ...(skipped ? { skipped } : {}),
        ...(payload === undefined ? {} : { payload }),
      });
      if (result.ok) {
        const { next } = result.data;
        router.push(
          next === null
            ? (finalHref ?? `/w/${encodeURIComponent(scope.slug)}/today`)
            : stepHref(scope.path, next, scope.slug),
        );
        return true;
      }
      setFailure(failureFor(result.error.code));
    } catch {
      setFailure('generic');
    }
    setPending(false);
    return false;
  }

  return { submit, pending, failure, online };
}
