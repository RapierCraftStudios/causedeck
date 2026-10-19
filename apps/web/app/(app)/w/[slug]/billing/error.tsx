'use client';

// Billing route error boundary (#256): catches anything the page throws, reports it (never shows its
// message) and offers `Try again`.
import { useEffect } from 'react';

import { reportError } from '../../../../../lib/report-error.ts';

import { BillingError } from './billing-error.tsx';

interface BillingErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route error boundary: reports the error (never shows its message) and offers `Try again`. */
export default function BillingErrorBoundary({ error, reset }: BillingErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route', digest: error.digest });
  }, [error]);
  return <BillingError onRetry={reset} />;
}
