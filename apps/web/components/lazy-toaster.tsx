'use client';

import dynamic from 'next/dynamic';

/**
 * The app-wide Sonner toaster, loaded after hydration. No toast exists on first paint, so its code
 * stays out of the home route's 180 KB initial-JS budget.
 */
export const LazyToaster = dynamic(
  () => import('@causedeck/ui/sonner').then((mod) => mod.Toaster),
  { ssr: false },
);
