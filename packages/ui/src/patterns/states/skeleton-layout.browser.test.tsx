// Loading skeletons in a real browser (#145): each pattern's placeholder has the loaded pattern's
// block size (no layout shift when data arrives), and the shimmer is static under reduced motion.
import '../../styles/globals.css';

import { render } from '@testing-library/react';
import { commands, page } from '@vitest/browser/context';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ACTIVITIES,
  COURT_ITEMS,
  MEMORIES,
  NOW,
  OBLIGATIONS,
  PROPOSALS,
  SOURCES,
} from '../__fixtures__/trust';
import { ActivityItem } from '../activity-item/activity-item';
import { LevelBadge } from '../automation-level/level-badge';
import { CourtItemChip } from '../court-item-chip/court-item-chip';
import { MemoryCard } from '../memory-card/memory-card';
import { ObligationRow } from '../obligation-row/obligation-row';
import { ProposalCard } from '../proposal-card/proposal-card';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import { StageBadge } from '../stage-badge/stage-badge';
import type { Proposal } from '../types';
import { PatternSkeleton, SKELETON_PATTERNS, type SkeletonPattern } from './loading-skeletons';

const noop = () => undefined;

/** Each pattern with its default story content. */
const LOADED: Record<SkeletonPattern, ReactNode> = {
  'provenance-chip': <ProvenanceChip source={SOURCES.confirmed} presentation="popover" />,
  'level-badge': <LevelBadge level="L2" />,
  'stage-badge': <StageBadge stage="listed" />,
  'proposal-card': (
    <ProposalCard
      proposal={PROPOSALS[0] as Proposal<string>}
      onConfirm={noop}
      onEdit={noop}
      onDismiss={noop}
    />
  ),
  'activity-item': <ActivityItem {...ACTIVITIES.attached} now={NOW} onUndo={noop} />,
  'obligation-row': <ObligationRow {...OBLIGATIONS.today} now={NOW} onDone={noop} />,
  'court-item-chip': <CourtItemChip {...COURT_ITEMS.morning} />,
  'memory-card': <MemoryCard {...MEMORIES.M2} onConfirm={noop} onEdit={noop} onDelete={noop} />,
};

const WIDTHS = [360, 768, 1280] as const;

function blockSize(node: ReactNode): number {
  const { container, unmount } = render(<div data-testid="box">{node}</div>);
  const box = container.querySelector<HTMLElement>('[data-testid="box"]');
  if (!box) throw new Error('no box');
  const height = box.getBoundingClientRect().height;
  unmount();
  return height;
}

afterEach(async () => {
  await commands.emulateReducedMotion('no-preference');
});

describe('PatternSkeleton', () => {
  it.each(SKELETON_PATTERNS.flatMap((p) => WIDTHS.map((w) => [p, w] as const)))(
    '%s at %i px has the loaded block size (no layout shift)',
    async (pattern, width) => {
      await page.viewport(width, 900);
      const loaded = blockSize(LOADED[pattern]);
      const skeleton = blockSize(<PatternSkeleton pattern={pattern} />);
      expect(
        Math.abs(skeleton - loaded),
        `${String(skeleton)} vs ${String(loaded)}`,
      ).toBeLessThanOrEqual(2);
    },
  );

  it('announces Loading once and is busy', () => {
    const { container } = render(<PatternSkeleton pattern="proposal-card" />);
    expect(container.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(1);
    expect(container.textContent).toBe('Loading');
  });

  it('shimmers, and is static under reduced motion', async () => {
    const { container, rerender } = render(<PatternSkeleton pattern="memory-card" />);
    const block = () => {
      const el = container.querySelector('[data-slot="skeleton"]');
      if (!el) throw new Error('no skeleton');
      return getComputedStyle(el);
    };
    expect(block().animationName).toBe('cd-skeleton-shimmer');
    await commands.emulateReducedMotion('reduce');
    rerender(<PatternSkeleton pattern="memory-card" />);
    expect(block().animationName).toBe('none');
    expect(block().backgroundImage).toBe('none');
  });
});
