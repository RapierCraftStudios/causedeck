import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import './skeleton.css';

/** Placeholder block for content that is loading. Hidden from assistive tech. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('cd-skeleton rounded-md', className)}
      {...props}
    />
  );
}

export interface SkeletonGroupLabels {
  /** Announced once for the whole group of placeholders. */
  loading: string;
}

export const DEFAULT_SKELETON_LABELS: SkeletonGroupLabels = { loading: 'Loading' };

export interface SkeletonGroupProps extends ComponentProps<'div'> {
  labels?: Partial<SkeletonGroupLabels>;
}

/** Wraps skeletons in a busy status region with one screen-reader announcement. */
export function SkeletonGroup({ labels, className, children, ...props }: SkeletonGroupProps) {
  const text = { ...DEFAULT_SKELETON_LABELS, ...labels };
  return (
    <div
      data-slot="skeleton-group"
      role="status"
      aria-busy="true"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    >
      <span className="sr-only">{text.loading}</span>
      {children}
    </div>
  );
}
