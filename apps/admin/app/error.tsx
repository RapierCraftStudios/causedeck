'use client';

import { Button } from '@causedeck/ui/button';

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto grid max-w-md gap-4 px-6 py-24">
      <h1 className="text-lg font-semibold">Could not load.</h1>
      {error.digest === undefined ? null : (
        <p className="text-ink-muted font-mono text-sm">Request id: {error.digest}</p>
      )}
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
