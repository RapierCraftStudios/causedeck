'use client';

import { PatternSkeleton } from '@causedeck/ui/patterns';

// A client component: the patterns entry point includes interactive (hook-using) patterns.
/** Route-level loading: a 2 px accent progress bar (150 ms fade, static under reduced motion). */
export default function Loading() {
  return (
    <>
      <div
        aria-hidden="true"
        data-slot="route-progress"
        className="cd-progress-bar bg-accent fixed inset-x-0 top-0 z-50 h-[2px]"
      />
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6 xl:px-8">
        <PatternSkeleton pattern="activity-item" rows={3} />
      </div>
    </>
  );
}
