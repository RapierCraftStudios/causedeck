'use client';

import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Result } from '../../../../lib/safe-action.ts';

import type { ImportShareOutcome } from './actions.ts';

export interface ImportFormProps {
  token: string;
  action: (input: { token: string }) => Promise<Result<ImportShareOutcome>>;
}

/** `Import this matter`: lands on the new matter, or says why the link no longer works. */
export function ImportForm({ token, action }: ImportFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await action({ token });
      if (result.ok && result.data.status === 'imported') {
        router.push(result.data.next);
        return;
      }
      setError(
        result.ok && result.data.status === 'rejected' && result.data.reason === 'NO_WORKSPACE'
          ? 'Create a workspace first, then open this link again.'
          : 'This link can no longer be imported.',
      );
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="lg" disabled={busy} onClick={() => void run()}>
        Import this matter
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
