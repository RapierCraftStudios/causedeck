// Undo toast motion in a real browser: slides in over 200 ms, instant under prefers-reduced-motion.
import '../../styles/globals.css';

import { act, render, screen } from '@testing-library/react';
import { commands, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toast, Toaster } from '../../components/sonner';
import { UndoButton } from './undo-button';

const NOW = new Date('2026-10-18T10:00:00+05:30');
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

afterEach(async () => {
  act(() => {
    toast.dismiss();
  });
  await commands.emulateReducedMotion('no-preference');
});

async function undo() {
  render(
    <>
      <Toaster />
      <UndoButton performedAt={YESTERDAY} now={NOW} />
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  const item = (await screen.findByText('Undone', { selector: '[data-title]' })).closest(
    '[data-sonner-toast]',
  );
  if (!item) throw new Error('no toast');
  return item;
}

describe('Undo toast motion', () => {
  it('slides in over 200 ms with a Redo action', async () => {
    await commands.emulateReducedMotion('no-preference');
    const item = await undo();
    const durations = getComputedStyle(item)
      .transitionDuration.split(',')
      .map((d) => d.trim());
    expect(new Set(durations)).toEqual(new Set(['0.2s']));
    expect(getComputedStyle(item).transitionProperty).toMatch(/transform|translate/);
    // Visible once the slide has finished.
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Redo' })).toBeVisible();
    });
  });

  it('is instant under prefers-reduced-motion', async () => {
    await commands.emulateReducedMotion('reduce');
    const item = await undo();
    const style = getComputedStyle(item);
    expect(
      style.transitionProperty === 'none' || Number.parseFloat(style.transitionDuration) === 0,
    ).toBe(true);
    expect(style.opacity).toBe('1');
  });
});
