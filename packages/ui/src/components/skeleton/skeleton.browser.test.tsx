// Skeleton shimmer in a real browser: 1.4 s linear, and static under prefers-reduced-motion.
import '../../styles/globals.css';

import { render } from '@testing-library/react';
import { commands } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';

afterEach(async () => {
  await commands.emulateReducedMotion('no-preference');
});

const block = (container: HTMLElement) => {
  const el = container.querySelector('[data-slot="skeleton"]');
  if (!el) throw new Error('no skeleton');
  return getComputedStyle(el);
};

describe('Skeleton shimmer', () => {
  it('sweeps the --surface-sunken to --line ramp every 1.4 s, linear', async () => {
    await commands.emulateReducedMotion('no-preference');
    const { container } = render(<Skeleton className="h-4 w-40" />);
    const style = block(container);
    expect(style.animationName).toBe('cd-skeleton-shimmer');
    expect(style.animationDuration).toBe('1.4s');
    expect(style.animationTimingFunction).toBe('linear');
    expect(style.backgroundImage).toMatch(/^linear-gradient/);
  });

  it('is a static block under reduced motion', async () => {
    await commands.emulateReducedMotion('reduce');
    const { container } = render(<Skeleton className="h-4 w-40" />);
    const style = block(container);
    expect(style.animationName).toBe('none');
    expect(style.backgroundImage).toBe('none');
  });
});
