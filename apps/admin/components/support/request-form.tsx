'use client';
// The staff request form (#314): which workspace, what support may see, and a required reason the
// owner reads before deciding. The server action validates (a blank reason is refused there, so
// the message is the same with or without browser validation). Workspace slug search arrives with the workspace lookup (#310); until
// then staff paste the workspace ID (or arrive with `?workspace=<id>`).
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Textarea } from '@causedeck/ui/textarea';
import { useActionState } from 'react';

import {
  requestSupportSessionAction,
  type RequestSupportSessionState,
} from '../../app/(console)/support/actions.ts';

const INITIAL: RequestSupportSessionState = {};

export function RequestForm({
  workspaceId = '',
  reasonMaxLength,
}: {
  workspaceId?: string;
  /** `SUPPORT_REASON_MAX_LENGTH`, passed in so this client module never imports core. */
  reasonMaxLength: number;
}) {
  const [state, action, pending] = useActionState(requestSupportSessionAction, INITIAL);
  const values = state.values;
  return (
    <form
      action={action}
      aria-labelledby="request-title"
      data-slot="support-request-form"
      className="border-line bg-surface grid max-w-xl gap-3 rounded-xl border p-4"
    >
      <h2 id="request-title" className="text-base font-semibold">
        Request a support session
      </h2>
      <p className="text-ink-muted text-sm">
        The workspace owner is notified and decides. Nothing is visible until they grant it, and
        everything you view is recorded in their audit log.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="workspaceId">Workspace ID</Label>
        <Input
          id="workspaceId"
          name="workspaceId"
          required
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          defaultValue={values?.workspaceId ?? workspaceId}
          key={`ws-${values?.workspaceId ?? workspaceId}`}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="scope">Access</Label>
        <select
          id="scope"
          name="scope"
          defaultValue={values?.scope ?? 'view'}
          key={`scope-${values?.scope ?? 'view'}`}
          className="border-line bg-surface h-9 rounded-md border px-2 text-sm"
        >
          <option value="view">Read-only view of the workspace</option>
          <option value="metadata">Plan and usage details only</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Textarea
          id="reason"
          name="reason"
          aria-required
          maxLength={reasonMaxLength}
          rows={3}
          defaultValue={values?.reason ?? ''}
          key={`reason-${values?.reason ?? ''}`}
          aria-describedby="request-error"
        />
      </div>
      <p
        id="request-error"
        role="status"
        aria-live="polite"
        className="text-danger min-h-5 text-sm"
      >
        {state.error ?? null}
      </p>
      <Button type="submit" loading={pending} className="justify-self-start">
        Request session
      </Button>
    </form>
  );
}
