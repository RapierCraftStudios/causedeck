import type { Metadata } from 'next';

import { isNonProduction } from '../../lib/env.ts';

import { SignInForm } from './sign-in-form.tsx';

export const metadata: Metadata = { title: 'Sign in' };

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return (
    <main id="main" className="mx-auto grid max-w-sm gap-6 px-6 py-24">
      <div className="grid gap-1">
        <p className="text-ink-muted text-xs font-medium tracking-wide uppercase">Staff console</p>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-ink-muted text-sm">
          Staff sign in with their CauseDeck email, then a two-factor code.
        </p>
      </div>
      <SignInForm devSignIn={isNonProduction()} />
    </main>
  );
}
