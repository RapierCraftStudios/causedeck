'use client';
// `End session` on a staff session page (#314): confirms in an AlertDialog that restates the
// consequence, then ends the session at once through the server action.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@causedeck/ui/alert-dialog';
import { Button } from '@causedeck/ui/button';
import { useTransition } from 'react';

import { endSupportSessionAction } from '../../app/(console)/support/actions.ts';

export function EndSessionButton({
  sessionId,
  pending: isRequest = false,
}: {
  sessionId: string;
  /** A request not yet granted: the button withdraws it. */
  pending?: boolean;
}) {
  const [busy, start] = useTransition();
  const label = isRequest ? 'Withdraw request' : 'End session';

  function end() {
    const form = new FormData();
    form.set('sessionId', sessionId);
    start(async () => {
      await endSupportSessionAction(form);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" loading={busy} data-slot="support-end-session">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRequest ? 'Withdraw this request?' : 'End this session?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRequest
              ? 'The owner can no longer grant it. Asking again needs a new request.'
              : 'Staff access ends now. Seeing this workspace again needs a new request and a new grant from the owner.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={end}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
