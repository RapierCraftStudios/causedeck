// Toast motion in a real browser: 200 ms slide and fade, none under prefers-reduced-motion.
import '../../styles/globals.css';

import { act, render, screen } from '@testing-library/react';
import { commands } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';

import { toast, Toaster } from './sonner';

afterEach(async () => {
  act(() => {
    toast.dismiss();
  });
  await commands.emulateReducedMotion('no-preference');
});

async function showToast() {
  render(<Toaster />);
  act(() => {
    toast('Draft saved', { duration: Infinity });
  });
  const item = (await screen.findByText('Draft saved')).closest('[data-sonner-toast]');
  if (!item) throw new Error('no toast');
  return item;
}

describe('Toast motion', () => {
  it('transitions over --dur-base (200 ms) and stacks on the toast z-index token', async () => {
    await commands.emulateReducedMotion('no-preference');
    const item = await showToast();
    const durations = getComputedStyle(item)
      .transitionDuration.split(',')
      .map((d) => d.trim());
    expect(new Set(durations)).toEqual(new Set(['0.2s']));
    const toaster = item.closest('[data-sonner-toaster]');
    if (!toaster) throw new Error('no toaster');
    expect(getComputedStyle(toaster).zIndex).toBe('60');
  });

  it('enters and leaves with an 8 px offset, not a full toast height', async () => {
    await commands.emulateReducedMotion('no-preference');
    await showToast();
    // Probe the entry and exit states with the attributes sonner sets on a toast.
    const { container } = render(
      <ol className="cd-toaster" data-sonner-toaster="">
        <li data-sonner-toast="" data-mounted="false" data-y-position="bottom" />
        <li data-sonner-toast="" data-mounted="false" data-y-position="top" />
        <li
          data-sonner-toast=""
          data-mounted="true"
          data-removed="true"
          data-front="true"
          data-swipe-out="false"
          data-y-position="bottom"
        />
      </ol>,
    );
    const [enterBottom, enterTop, exit] = [...container.querySelectorAll('li')].map(
      (li) => getComputedStyle(li).transform,
    );
    expect(enterBottom).toBe('matrix(1, 0, 0, 1, 0, 8)');
    expect(enterTop).toBe('matrix(1, 0, 0, 1, 0, -8)');
    expect(exit).toBe('matrix(1, 0, 0, 1, 0, 8)');
  });

  it('has no transition under reduced motion', async () => {
    await commands.emulateReducedMotion('reduce');
    const item = await showToast();
    const style = getComputedStyle(item);
    expect(
      style.transitionProperty === 'none' || Number.parseFloat(style.transitionDuration) === 0,
    ).toBe(true);
    expect(style.opacity).toBe('1');
  });
});
