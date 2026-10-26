'use client';

import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { useState, type SyntheticEvent } from 'react';

type Status = 'idle' | 'sending' | 'sent' | 'error';

function emailOf(form: HTMLFormElement): string {
  const value = new FormData(form).get('email');
  return typeof value === 'string' ? value.trim() : '';
}

/** Magic-link sign-in; the same reply for every address, so it reveals nobody's staff status. */
export function SignInForm({ devSignIn }: { devSignIn: boolean }) {
  const [status, setStatus] = useState<Status>('idle');

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = emailOf(event.currentTarget);
    if (!email) return;
    setStatus('sending');
    try {
      const response = await fetch('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, callbackURL: '/' }),
      });
      setStatus(response.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  }

  async function onDevSignIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = emailOf(event.currentTarget);
    const response = await fetch('/api/auth/dev/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (response.ok) window.location.assign('/');
    else setStatus('error');
  }

  return (
    <div className="grid gap-6">
      <form className="grid gap-3" onSubmit={(e) => void onSubmit(e)}>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <Button type="submit" loading={status === 'sending'}>
          Email me a sign-in link
        </Button>
        <p role="status" aria-live="polite" className="text-ink-muted min-h-5 text-sm">
          {status === 'sent' ? 'If this address can sign in, a link is on its way.' : null}
          {status === 'error' ? 'Could not send. Try again.' : null}
        </p>
      </form>
      {devSignIn ? (
        <form
          className="border-line grid gap-3 border-t pt-6"
          onSubmit={(e) => void onDevSignIn(e)}
          data-testid="dev-sign-in"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="dev-email">Dev sign-in (not in production)</Label>
            <Input id="dev-email" name="email" type="email" required />
          </div>
          <Button type="submit" variant="secondary">
            Sign in without email
          </Button>
        </form>
      ) : null}
    </div>
  );
}
