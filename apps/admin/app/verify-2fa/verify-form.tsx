'use client';

import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { useActionState } from 'react';

import { verifyTwoFactor, type VerifyTwoFactorState } from './actions.ts';

const INITIAL: VerifyTwoFactorState = {};

export function VerifyTwoFactorForm() {
  const [state, action, pending] = useActionState(verifyTwoFactor, INITIAL);
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          aria-describedby="code-error"
        />
      </div>
      <Button type="submit" loading={pending}>
        Verify
      </Button>
      <p id="code-error" role="status" aria-live="polite" className="text-danger min-h-5 text-sm">
        {state.error ?? null}
      </p>
    </form>
  );
}
