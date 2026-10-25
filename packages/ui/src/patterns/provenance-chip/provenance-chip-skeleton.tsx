import type { ComponentProps } from 'react';

import { Skeleton } from '../../components/skeleton';
import { cn } from '../../lib/cn';

// Its own file so the loading skeletons (the root `loading.tsx`) do not pull the chip's popover and
// drawer into the home route's initial JS.

/** Loading placeholder with the chip's footprint. */
export function ProvenanceChipSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return <Skeleton className={cn('h-6 w-24 rounded-full', className)} {...props} />;
}
