'use client';

// Usage route error boundary (#223): catches anything the page throws, reports it (never shows its
// message) and offers `Try again`.
import { useEffect } from 'react';

import { reportError } from '../../../../../../lib/report-error.ts';

import { UsageError } from './usage-states.tsx';

interface UsageErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route error boundary: reports the error (never shows its message) and offers `Try again`. */
export default function UsageErrorBoundary({ error, reset }: UsageErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <UsageError onRetry={reset} />;
}
