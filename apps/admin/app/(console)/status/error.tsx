'use client';

import { Button } from '@causedeck/ui/button';

export default function StatusError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section role="alert" className="grid max-w-md gap-4">
      <h1 className="text-lg font-semibold">Could not load status incidents.</h1>
      {error.digest === undefined ? null : (
        <p className="text-ink-muted font-mono text-sm">Request id: {error.digest}</p>
      )}
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </section>
  );
}
