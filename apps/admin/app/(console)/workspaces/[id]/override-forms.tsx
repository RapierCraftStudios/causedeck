'use client';
// Admin-only forms for a workspace's AI budget overrides (#224): set one (limit in rupees, expiry
// in UTC, reason) or end an active one early (reason). The server actions check the role again.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Textarea } from '@causedeck/ui/textarea';
import { useActionState, type ReactNode } from 'react';

import {
  expireBudgetOverrideAction,
  setBudgetOverrideAction,
  type OverrideFormState,
} from './actions.ts';

const INITIAL: OverrideFormState = {};

function Status({ id, state, done }: { id: string; state: OverrideFormState; done: string }) {
  let message: ReactNode = null;
  if (state.error !== undefined) message = <span className="text-danger">{state.error}</span>;
  else if (state.done === true) message = <span className="text-success">{done}</span>;
  return (
    <p id={id} role="status" aria-live="polite" className="min-h-5 text-sm">
      {message}
    </p>
  );
}

export function SetOverrideForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(setBudgetOverrideAction, INITIAL);
  return (
    <form action={action} className="grid max-w-lg gap-3" aria-labelledby="set-override">
      <h3 id="set-override" className="text-sm font-medium">
        Set an AI budget override
      </h3>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="grid gap-1.5">
        <Label htmlFor="limitRupees">Monthly limit (Rs)</Label>
        <Input
          id="limitRupees"
          name="limitRupees"
          inputMode="decimal"
          pattern="[0-9]+(\.[0-9]{1,2})?"
          required
          aria-describedby="set-override-status"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="expiresAt">Expires at (UTC)</Label>
        <Input id="expiresAt" name="expiresAt" type="datetime-local" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="override-reason">Reason</Label>
        <Textarea id="override-reason" name="reason" maxLength={500} required />
      </div>
      <Button type="submit" loading={pending} className="justify-self-start">
        Set override
      </Button>
      <Status id="set-override-status" state={state} done="Override set." />
    </form>
  );
}

export function ExpireOverrideForm({
  workspaceId,
  overrideId,
}: {
  workspaceId: string;
  overrideId: string;
}) {
  const [state, action, pending] = useActionState(expireBudgetOverrideAction, INITIAL);
  const reasonId = `expire-reason-${overrideId}`;
  const statusId = `expire-status-${overrideId}`;
  return (
    <form action={action} className="grid max-w-lg gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="overrideId" value={overrideId} />
      <div className="grid gap-1.5">
        <Label htmlFor={reasonId}>Reason for expiring</Label>
        <Input id={reasonId} name="reason" maxLength={500} required aria-describedby={statusId} />
      </div>
      <Button type="submit" variant="secondary" loading={pending} className="justify-self-start">
        Expire now
      </Button>
      <Status id={statusId} state={state} done="Override expired." />
    </form>
  );
}
