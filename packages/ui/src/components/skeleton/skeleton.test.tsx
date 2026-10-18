// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SKELETON_LABELS, Skeleton, SkeletonGroup } from './skeleton';

const css = readFileSync(path.join(import.meta.dirname, 'skeleton.css'), 'utf8');

describe('Skeleton', () => {
  it('is a hidden shimmer block', () => {
    const { container } = render(<Skeleton className="h-4 w-40" />);
    const block = container.firstElementChild;
    expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(block).toHaveClass('cd-skeleton', 'h-4', 'w-40');
  });

  it('announces one loading status for a group', () => {
    render(
      <SkeletonGroup>
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent(DEFAULT_SKELETON_LABELS.loading);
  });

  it('routes the announcement through the labels prop', () => {
    render(<SkeletonGroup labels={{ loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('ಲೋಡ್ ಆಗುತ್ತಿದೆ');
  });

  it('shimmers 1.4 s linear on the --surface-sunken to --line ramp, off under reduced motion', () => {
    // 7 x --dur-base (200 ms) = 1.4 s.
    expect(css).toMatch(
      /animation: cd-skeleton-shimmer calc\(var\(--dur-base\) \* 7\) linear infinite/,
    );
    expect(css).toMatch(/var\(--surface-sunken\) 0%,\s*var\(--line\) 50%/);
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.cd-skeleton\s*\{\s*animation: none/,
    );
  });
});
