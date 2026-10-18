// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid, WithIcon, LongText (a placeholder: not interactive, no visible text)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { INDIC } from '../__fixtures__/labels';
import { Skeleton, SkeletonGroup } from './skeleton';

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
  args: { className: 'h-4 w-64' },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const block = canvasElement.querySelector('[data-slot="skeleton"]');
    if (!block) throw new Error('no skeleton');
    await expect(block).toHaveAttribute('aria-hidden', 'true');
    // Shimmer runs unless the user prefers reduced motion.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await expect(getComputedStyle(block).animationName).toBe(
      reduced ? 'none' : 'cd-skeleton-shimmer',
    );
  },
};

/** A matter row while loading: one status announcement for the whole group. */
export const Loading: Story = {
  render: () => (
    <SkeletonGroup className="w-80">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
    </SkeletonGroup>
  ),
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveTextContent('Loading');
  },
};

export const RtlNeutral: Story = {
  render: () => (
    <div dir="rtl" className="flex w-80 items-center gap-3">
      <Skeleton className="size-8 rounded-full" />
      <Skeleton className="h-4 flex-1" />
    </div>
  ),
};

export const Tamil: Story = {
  render: () => (
    <SkeletonGroup lang="ta" className="w-64" labels={{ loading: INDIC.ta.loading }}>
      <Skeleton className="h-4 w-full" />
    </SkeletonGroup>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent(INDIC.ta.loading);
  },
};

export const Kannada: Story = {
  render: () => (
    <SkeletonGroup lang="kn" className="w-64" labels={{ loading: INDIC.kn.loading }}>
      <Skeleton className="h-4 w-full" />
    </SkeletonGroup>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent(INDIC.kn.loading);
  },
};
