import type { ComponentProps, ReactNode } from 'react';

import { Skeleton, SkeletonGroup } from '../../components/skeleton';
import { cn } from '../../lib/cn';
import { ProvenanceChipSkeleton } from '../provenance-chip/provenance-chip-skeleton';

// Placeholders that mirror each pattern's layout: the same paddings, gaps, breakpoints and line
// boxes (`h-lh` inside the pattern's text size), so the block size does not change when the data
// arrives. Widths follow the default content.

/** The 20 px level capsule. */
export function LevelBadgeSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <Skeleton
      data-slot="level-badge-skeleton"
      className={cn('h-5 w-14 rounded-full', className)}
      {...props}
    />
  );
}

/** The 22 px stage capsule. */
export function StageBadgeSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <Skeleton
      data-slot="stage-badge-skeleton"
      className={cn('h-5.5 w-20 rounded-full', className)}
      {...props}
    />
  );
}

/** One text line of the surrounding font size. */
function Line({ className }: { className?: string }) {
  return <Skeleton className={cn('h-lh', className)} />;
}

function ProposalSkeleton() {
  return (
    <div
      data-slot="proposal-card-skeleton"
      className={cn(
        'border-line rounded-xl border p-4',
        'grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4',
      )}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="font-serif text-lg leading-snug">
          <Line className="w-1/2" />
        </div>
        <Skeleton className="h-11 w-full rounded-lg" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-26 rounded-full" />
          <Skeleton className="h-4 w-22" />
          <Skeleton className="h-5 w-44 rounded-full" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        <Skeleton className="h-9 w-full md:w-28" />
        <div className="flex flex-1 gap-2 md:flex-none">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="flex gap-3 py-3 ps-1 max-sm:flex-wrap">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* The sentence takes two lines on phones. */}
        <div className="text-base">
          <Line className="w-3/4" />
          <Line className="w-1/2 sm:hidden" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-6 w-26 rounded-full" />
          <Skeleton className="h-5 w-40 rounded-full" />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start max-sm:basis-full max-sm:ps-11">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

function ObligationSkeleton() {
  return (
    <div className="border-line flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm">
          <Line className="w-2/3" />
        </div>
        {/* The matter name takes two lines on phones. */}
        <div className="text-xs">
          <Line className="w-1/2" />
          <Line className="w-1/3 sm:hidden" />
        </div>
        <div className="text-xs">
          <Line className="w-1/3" />
        </div>
      </div>
      <Skeleton className="hidden h-6 w-28 rounded-full sm:block" />
      <Skeleton className="size-8 rounded-full" />
      <Skeleton className="size-8 rounded-md" />
    </div>
  );
}

/** One row on wider screens; the source chip wraps to a second row on phones. */
function CourtItemSkeleton() {
  return (
    <Skeleton
      data-slot="court-item-skeleton"
      className="h-8.5 w-100 max-w-full rounded-full max-sm:h-16 max-sm:rounded-2xl"
    />
  );
}

function MemorySkeleton() {
  return (
    <div className="border-line flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5.5 w-40 rounded-full" />
        <div className="text-sm">
          <Line className="w-24" />
        </div>
      </div>
      <div className="text-base">
        <Line className="w-3/4" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-6 w-29 rounded-full" />
        <Skeleton className="ms-auto h-8 w-67" />
      </div>
    </div>
  );
}

/** Every pattern with a loading placeholder. */
export const SKELETON_PATTERNS = [
  'provenance-chip',
  'level-badge',
  'stage-badge',
  'proposal-card',
  'activity-item',
  'obligation-row',
  'court-item-chip',
  'memory-card',
] as const;

export type SkeletonPattern = (typeof SKELETON_PATTERNS)[number];

/** The shimmer is static under reduced motion (skeleton.css). */
const SKELETONS: Record<SkeletonPattern, (rows: number) => ReactNode> = {
  'provenance-chip': () => <ProvenanceChipSkeleton />,
  'level-badge': () => <LevelBadgeSkeleton />,
  'stage-badge': () => <StageBadgeSkeleton />,
  'proposal-card': () => <ProposalSkeleton />,
  'activity-item': (rows) => Array.from({ length: rows }, (_, i) => <ActivitySkeleton key={i} />),
  'obligation-row': (rows) =>
    Array.from({ length: rows }, (_, i) => <ObligationSkeleton key={i} />),
  'court-item-chip': () => <CourtItemSkeleton />,
  'memory-card': () => <MemorySkeleton />,
};

export interface PatternSkeletonProps {
  pattern: SkeletonPattern;
  /** Rows for list patterns (activity, obligations). */
  rows?: number;
  className?: string | undefined;
}

/** The loading placeholder for `pattern`, announced once as `Loading`. */
export function PatternSkeleton({ pattern, rows = 1, className }: PatternSkeletonProps) {
  const inline = pattern === 'provenance-chip' || pattern.endsWith('-badge');
  return (
    <SkeletonGroup
      data-pattern-state="loading"
      data-pattern={pattern}
      className={cn(inline ? 'items-start' : 'items-stretch', className)}
    >
      {SKELETONS[pattern](rows)}
    </SkeletonGroup>
  );
}
